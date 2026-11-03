package com.smartframe.player

import android.graphics.BitmapFactory
import android.util.AtomicFile
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.time.ZoneId
import java.time.Instant

class FrameHttpError(val status: Int) : Exception("Falha de comunicação: HTTP $status")

class FrameSync(private val directory: File) {
    init { directory.mkdirs() }
    private val active = AtomicFile(File(directory, "active.json"))
    private val previous = AtomicFile(File(directory, "previous.json"))

    fun normalizeServer(value: String): String {
        val url = URL(value.trim())
        require(url.userInfo == null && url.query == null && url.ref == null && url.path in listOf("", "/")) { "Informe somente a origem do servidor, sem caminhos." }
        require(url.protocol == "https" || (BuildConfig.DEBUG && url.protocol == "http" && url.host in listOf("localhost", "127.0.0.1", "10.0.2.2"))) {
            "Use HTTPS. HTTP de teste é permitido apenas em localhost no APK de debug."
        }
        return url.toExternalForm().trimEnd('/')
    }

    fun request(server: String, path: String, token: String? = null, body: JSONObject? = null, limit: Int = 32768): ByteArray? {
        require(path.startsWith("/api/") && !path.contains(".."))
        val connection = URL(normalizeServer(server) + path).openConnection() as HttpURLConnection
        try {
            connection.connectTimeout = 10000
            connection.readTimeout = 15000
            connection.instanceFollowRedirects = false
            connection.setRequestProperty("Accept", "application/json, image/webp")
            if (token != null) connection.setRequestProperty("Authorization", "Bearer $token")
            if (body != null) {
                connection.requestMethod = "POST"
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")
                connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            }
            val status = connection.responseCode
            if (status == 204) return null
            if (status != 200) throw FrameHttpError(status)
            require(connection.contentLengthLong <= limit) { "Conteúdo excede o limite permitido." }
            val result = ByteArrayOutputStream()
            connection.inputStream.use { input ->
                val buffer = ByteArray(8192)
                while (true) {
                    val count = input.read(buffer)
                    if (count < 0) break
                    require(result.size() + count <= limit) { "Conteúdo excede o limite permitido." }
                    result.write(buffer, 0, count)
                }
            }
            return result.toByteArray()
        } finally { connection.disconnect() }
    }

    fun validate(manifest: JSONObject) {
        require(manifest.getInt("schemaVersion") == 1)
        require(manifest.getString("revision").matches(Regex("[A-Za-z0-9_-]{1,128}")))
        val layout = manifest.getJSONObject("layout")
        val frame = layout.getJSONObject("photoFrame")
        require(frame.getInt("schemaVersion") == 1)
        val portrait = frame.getString("orientation") == "portrait"
        require(frame.getString("orientation") in listOf("portrait", "landscape"))
        require(layout.getInt("width") == (if (portrait) 600 else 1024) && layout.getInt("height") == (if (portrait) 1024 else 600))
        ZoneId.of(frame.getString("timezone"))
        require(frame.getString("caption").length <= 120)
        val background = frame.getJSONObject("background")
        val clock = frame.getJSONObject("clock")
        require(background.getString("color").matches(Regex("#[a-fA-F0-9]{6}")))
        require(clock.getString("color").matches(Regex("#[a-fA-F0-9]{6}")))
        require(background.getDouble("shade").isFinite() && background.getDouble("shade") in 0.0..0.85)
        require(background.getString("fit") in listOf("cover", "contain"))
        background.getBoolean("gradient")
        clock.getBoolean("enabled"); clock.getBoolean("showDate")
        require(clock.getString("font") in listOf("system", "serif"))
        require(clock.getString("hourFormat") in listOf("12", "24"))
        require(clock.getInt("fontSize") in 32..128)
        require(clock.getString("position") in listOf("top-left", "top-right", "bottom-left", "bottom-right", "center"))
        frame.optJSONObject("widgets")?.let { widgets ->
            require(widgets.getString("position") in listOf("top-left", "top-right", "bottom-left", "bottom-right"))
            val weather = widgets.getJSONObject("weather")
            weather.getBoolean("enabled")
            require(weather.getString("city").length in 1..100)
            require(weather.getDouble("latitude").isFinite() && weather.getDouble("latitude") in -90.0..90.0)
            require(weather.getDouble("longitude").isFinite() && weather.getDouble("longitude") in -180.0..180.0)
            widgets.getJSONObject("currencies").getBoolean("enabled")
        }
        manifest.optJSONObject("widgetData")?.let { widgets ->
            widgets.optJSONObject("weather")?.let { weather ->
                for (field in listOf("temperature", "minimum", "maximum")) require(weather.getDouble(field).isFinite() && weather.getDouble(field) in -100.0..100.0)
                require(weather.getInt("weatherCode") in 0..99)
                Instant.parse(weather.getString("updatedAt"))
                weather.getBoolean("stale")
            }
            widgets.optJSONObject("currencies")?.let { currencies ->
                for (field in listOf("usdBrl", "eurBrl", "btcUsd")) if (!currencies.isNull(field)) require(currencies.getDouble(field).isFinite() && currencies.getDouble(field) > 0 && currencies.getDouble(field) <= 1e10)
                for (field in listOf("fiatUpdatedAt", "btcUpdatedAt")) if (!currencies.isNull(field)) Instant.parse(currencies.getString(field))
                if (!currencies.isNull("fiatDate")) require(currencies.getString("fiatDate").length <= 30)
                currencies.getBoolean("stale")
            }
        }
        val media = manifest.getJSONArray("media")
        require(media.length() <= 1)
        if (background.isNull("photoId")) require(media.length() == 0) else {
            require(media.length() == 1)
            val photo = media.getJSONObject(0)
            val id = photo.getString("id")
            require(id.matches(Regex("[A-Za-z0-9_-]{1,128}")) && id == background.getString("photoId"))
            require(photo.getString("path") == "/api/player/media/$id")
            require(photo.getString("sha256").matches(Regex("[a-f0-9]{64}")))
            require(photo.getInt("bytes") in 1..4 * 1024 * 1024)
        }
    }

    private fun hash(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
    private fun imageFile(hash: String) = File(directory, "$hash.webp")
    private fun validImages(manifest: JSONObject): Boolean {
        val media = manifest.getJSONArray("media")
        if (media.length() == 0) return true
        val photo = media.getJSONObject(0)
        val file = imageFile(photo.getString("sha256"))
        return file.exists() && file.length() == photo.getLong("bytes") && hash(file.readBytes()) == photo.getString("sha256")
    }

    private fun write(file: AtomicFile, bytes: ByteArray) {
        val output = file.startWrite()
        try { output.write(bytes); file.finishWrite(output) }
        catch (failure: Exception) { file.failWrite(output); throw failure }
    }

    private fun read(file: AtomicFile): JSONObject? = try {
        val json = JSONObject(file.openRead().use { String(it.readBytes(), Charsets.UTF_8) })
        validate(json)
        if (validImages(json)) json else null
    } catch (_: Exception) { null }

    fun cached(): JSONObject? = read(active) ?: read(previous)
    fun rollback(): JSONObject? = read(previous)?.also { write(active, it.toString().toByteArray(Charsets.UTF_8)) }

    fun update(connection: DeviceConnection, manifest: JSONObject) {
        validate(manifest)
        require(manifest.getString("deviceId") == connection.deviceId)
        val media = manifest.getJSONArray("media")
        if (media.length() == 1 && !validImages(manifest)) {
            val photo = media.getJSONObject(0)
            val bytes = request(connection.server, photo.getString("path"), connection.token, limit = 4 * 1024 * 1024) ?: error("Foto ausente.")
            require(bytes.size == photo.getInt("bytes") && hash(bytes) == photo.getString("sha256")) { "Falha de integridade na foto." }
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
            require(bounds.outWidth in 1..1600 && bounds.outHeight in 1..1600) { "Foto inválida." }
            write(AtomicFile(imageFile(photo.getString("sha256"))), bytes)
        }
        read(active)?.let { old ->
            if (old.getString("revision") != manifest.getString("revision")) write(previous, old.toString().toByteArray(Charsets.UTF_8))
        }
        write(active, manifest.toString().toByteArray(Charsets.UTF_8))
    }

    fun photo(manifest: JSONObject): String? = manifest.getJSONArray("media").let { media ->
        if (media.length() == 0) null else "/photos/${media.getJSONObject(0).getString("sha256")}.webp"
    }

    fun localPhoto(path: String): File? {
        if (!path.matches(Regex("[a-f0-9]{64}\\.webp"))) return null
        return File(directory, path).takeIf { it.isFile }
    }

    fun cleanup() {
        val keep = mutableSetOf<String>()
        listOfNotNull(read(active), read(previous)).forEach { manifest ->
            val media = manifest.getJSONArray("media")
            if (media.length() == 1) keep.add(media.getJSONObject(0).getString("sha256") + ".webp")
        }
        directory.listFiles()?.filter { it.name.matches(Regex("[a-f0-9]{64}\\.webp")) && it.name !in keep }?.forEach { it.delete() }
    }
}
