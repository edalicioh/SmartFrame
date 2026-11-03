package com.smartframe.player

import android.net.Uri
import android.graphics.BitmapFactory
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

/** Credencial só é usada nativamente nas duas rotas de leitura do player online. */
class OnlinePlayer(private val server: String, private val token: String, private val deviceId: String) {
    private val origin = Uri.parse(server)
    val dashboardUrl = "$server/player/$deviceId"
    private val reportedConfigFailure = AtomicBoolean(false)

    private fun photoPath(path: String) = path.matches(Regex("/api/player/online-media/[A-Za-z0-9_-]+"))

    internal fun allowed(request: WebResourceRequest): Boolean {
        val url = request.url
        if (request.method != "GET" || !DashboardUrl.sameOrigin(server, url.toString()) || url.scheme != origin.scheme ||
            !url.host.equals(origin.host, ignoreCase = true) || effectivePort(url) != effectivePort(origin) ||
            url.userInfo != null || url.fragment != null) return false
        val path = url.encodedPath ?: return false
        // Não aceitar codificações, barras invertidas ou segmentos relativos ambíguos.
        if (!path.matches(Regex("/[A-Za-z0-9_./-]*")) || path.split('/').any { it == "." || it == ".." }) return false
        if (request.isForMainFrame) return url.encodedQuery == null && path == "/player/$deviceId"
        if (path == "/api/player/config") return validConfigQuery(url.encodedQuery)
        if (photoPath(path)) return url.encodedQuery?.matches(Regex("v=[a-f0-9]{64}")) == true
        if (url.encodedQuery != null) return false
        return path.startsWith("/player-dashboard/") && path != "/player-dashboard/" && !path.endsWith(".html")
    }

    private fun validConfigQuery(query: String?): Boolean {
        if (query == null) return true
        val parts = query.split('&')
        if (parts.size !in 1..2 || parts.toSet().size != parts.size) return false
        return parts.all { part ->
            when {
                part.startsWith("deviceId=") -> part.substringAfter('=').matches(Regex("[A-Za-z0-9_-]{1,128}")) && part.substringAfter('=') == deviceId
                part.startsWith("appliedRevision=") -> part.substringAfter('=').matches(Regex("online%3A[A-Za-z0-9_-]{1,128}"))
                else -> false
            }
        }
    }

    private fun effectivePort(uri: Uri): Int = if (uri.port != -1) uri.port else if (uri.scheme == "https") 443 else 80

    fun navigationAllowed(request: WebResourceRequest) = request.isForMainFrame && allowed(request)

    internal fun dashboardFinished(url: String) = try { android.net.Uri.parse(url).encodedPath == "/player/$deviceId" && DashboardUrl.sameOrigin(server, url) } catch (_: Exception) { false }

    fun intercept(request: WebResourceRequest, onFailure: (String, Boolean) -> Unit = { _, _ -> }, onResult: (Boolean) -> Unit = {}): WebResourceResponse {
        if (!allowed(request)) return forbidden()
        val critical = request.isForMainFrame || DashboardLoad.critical(request.url.encodedPath.orEmpty())
        val path = request.url.encodedPath.orEmpty()
        val cancelled = AtomicBoolean(false)
        val connection = AtomicReference<HttpURLConnection?>()
        return try {
            // Não executar callbacks no worker: uma resposta tardia não pode alterar a navegação.
            val result = DownloadDeadline.run(onlineDownloadTimeout(path), onCancel = {
                cancelled.set(true)
                connection.getAndSet(null)?.disconnect()
            }) {
                var failure: Pair<String, Boolean>? = null
                var success = false
                val response = fetch(request, { message, isCritical -> failure = message to isCritical }, { success = it }, connection, cancelled)
                Triple(response, failure, success)
            }
            result.second?.let { onFailure(it.first, it.second) }
            onResult(result.third)
            result.first
        } catch (_: Exception) {
            if (critical) onFailure(if (request.isForMainFrame) "Não foi possível carregar o dashboard online. Confira a rede e o servidor."
                else "Não foi possível carregar um recurso do dashboard online.", true)
            else if (path == "/api/player/config" && reportedConfigFailure.compareAndSet(false, true))
                onFailure("Não foi possível carregar a configuração online. Confira a rede e o servidor.", false)
            onResult(false)
            forbidden()
        }
    }

    private fun fetch(request: WebResourceRequest, onFailure: (String, Boolean) -> Unit, onResult: (Boolean) -> Unit,
                      reference: AtomicReference<HttpURLConnection?>, cancelled: AtomicBoolean): WebResourceResponse {
        var connection: HttpURLConnection? = null
        val critical = request.isForMainFrame || DashboardLoad.critical(request.url.encodedPath.orEmpty())
        try {
            connection = URL(request.url.toString()).openConnection() as HttpURLConnection
            reference.set(connection)
            if (cancelled.get()) throw InterruptedException()
            connection.instanceFollowRedirects = false
            connection.connectTimeout = 10000
            connection.readTimeout = 15000
            connection.setRequestProperty("Accept", "*/*")
            val path = request.url.encodedPath.orEmpty()
            if (path == "/api/player/config" || photoPath(path)) connection.setRequestProperty("Authorization", "Bearer $token")
            val status = connection.responseCode
            if (status != 200) {
                if (request.isForMainFrame) onFailure("Dashboard indisponível (HTTP $status). Verifique a publicação e a autenticação da rota.", true)
                else if (critical) onFailure("Recurso do dashboard indisponível (HTTP $status).", true)
                if (path == "/api/player/config" && reportedConfigFailure.compareAndSet(false, true)) {
                    onFailure("Configuração online indisponível (HTTP $status). Verifique a autorização do dispositivo e da residência no servidor.", false)
                }
                onResult(false)
                return forbidden()
            }
            val limit = if (photoPath(path)) 16 * 1024 * 1024 else 1024 * 1024
            require(connection.contentLengthLong <= limit)
            val output = ByteArrayOutputStream()
            connection.inputStream.use { input ->
                val buffer = ByteArray(8192)
                while (true) {
                    if (cancelled.get() || Thread.currentThread().isInterrupted) throw InterruptedException()
                    val count = input.read(buffer)
                    if (count < 0) break
                    require(output.size() + count <= limit)
                    output.write(buffer, 0, count)
                }
            }
            val contentType = connection.contentType?.substringBefore(';')?.trim()?.lowercase() ?: "application/octet-stream"
            if (request.isForMainFrame) require(contentType == "text/html")
            if (path == "/api/player/config") require(contentType == "application/json")
            if (critical && !request.isForMainFrame) {
                if (path.endsWith(".css", ignoreCase = true)) require(contentType == "text/css")
                else require(contentType in listOf("text/javascript", "application/javascript", "application/x-javascript"))
            }
            val bytes = output.toByteArray()
            if (photoPath(path)) require(validOnlineImage(bytes, contentType))
            val headers = mutableMapOf("Cache-Control" to "no-store", "X-Content-Type-Options" to "nosniff")
            if (request.isForMainFrame) headers["Content-Security-Policy"] = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'; worker-src 'none'"
            val response = WebResourceResponse(contentType, if (contentType.startsWith("text/") || contentType.contains("javascript") || contentType.contains("json")) "UTF-8" else null,
                200, "OK", headers, ByteArrayInputStream(bytes))
            if (path == "/api/player/config") reportedConfigFailure.set(false)
            onResult(true)
            return response
        } catch (_: Exception) {
            if (request.isForMainFrame) onFailure("Não foi possível carregar o dashboard online. Confira a rede e o servidor.", true)
            else if (critical) onFailure("Não foi possível carregar um recurso do dashboard online.", true)
            else if (request.url.encodedPath == "/api/player/config" && reportedConfigFailure.compareAndSet(false, true)) {
                onFailure("Não foi possível carregar a configuração online. Confira a rede e o servidor.", false)
            }
            onResult(false)
            return forbidden()
        } finally {
            reference.compareAndSet(connection, null)
            connection?.disconnect()
        }
    }

    private fun forbidden() = WebResourceResponse("text/plain", "UTF-8", 403, "Forbidden", mapOf("Cache-Control" to "no-store"), ByteArrayInputStream(ByteArray(0)))
}

/** Inspeciona apenas o cabeçalho: duas imagens decodificadas devem caber em tablets modestos. */
internal fun validOnlineImage(bytes: ByteArray, contentType: String): Boolean {
    if (contentType !in listOf("image/jpeg", "image/png", "image/webp")) return false
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    return bounds.outMimeType == contentType && bounds.outWidth in 1..4096 && bounds.outHeight in 1..4096 &&
        bounds.outWidth.toLong() * bounds.outHeight <= 2_097_152L
}
