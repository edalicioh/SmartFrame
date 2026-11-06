package com.smartframe.player

import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.webkit.*
import android.webkit.ServiceWorkerController
import android.widget.*
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicReference

class MainActivity : Activity() {
    private lateinit var credentials: DeviceCredentials
    private lateinit var root: FrameLayout
    private lateinit var statusView: TextView
    private var webView: WebView? = null
    private val executor = Executors.newSingleThreadScheduledExecutor()
    private val handler = Handler(Looper.getMainLooper())
    @Volatile private var resumed = false
    @Volatile private var closed = false
    private var retryMs = 2_000L
    private var retry: Runnable? = null
    private var load: DashboardLoad? = null
    private var watchdog: Runnable? = null
    private var stable: Runnable? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        credentials = DeviceCredentials(this)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        root = FrameLayout(this)
        statusView = TextView(this).apply { textSize = 18f; gravity = android.view.Gravity.CENTER; setPadding(32, 32, 32, 32) }
        root.addView(statusView, FrameLayout.LayoutParams(-1, -1))
        statusView.setOnClickListener { showConnection() }
        val menu = Button(this).apply { text = "⚙"; contentDescription = "Menu do SmartFrame"; setOnClickListener { showMenu() } }
        val menuSize = (48 * resources.displayMetrics.density).toInt()
        root.addView(menu, FrameLayout.LayoutParams(menuSize, menuSize, android.view.Gravity.TOP or android.view.Gravity.END))
        ServiceWorkerController.getInstance().serviceWorkerWebSettings.blockNetworkLoads = true
        setContentView(root)
        if (Build.VERSION.SDK_INT >= 33) {
            onBackInvokedDispatcher.registerOnBackInvokedCallback(
                android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT,
            ) { showMenu() }
        }
        showStatus("Conecte este tablet pelo código do painel.")
        if (credentials.read() != null) openDashboard()
    }

    private fun showStatus(text: String) {
        statusView.text = text
        statusView.visibility = View.VISIBLE
        webView?.visibility = View.GONE
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun openDashboard() {
        val stored = credentials.read() ?: return showStatus("Dispositivo desconectado. Toque para conectar novamente.")
        val c = try { stored.copy(server = PairingClient.normalizeServer(stored.server, BuildConfig.DEBUG)) } catch (_: Exception) { credentials.clear(); return showStatus("Endereço salvo inválido. Conecte novamente.") }
        if (!resumed || closed) return
        cancelTimers()
        webView?.let { root.removeView(it); it.stopLoading(); it.destroy() }
        val client = OnlinePlayer(c.server, c.token, c.deviceId)
        val dashboardLoad = DashboardLoad(); load = dashboardLoad
        val view = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.allowFileAccess = false; settings.allowContentAccess = false
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            settings.cacheMode = WebSettings.LOAD_NO_CACHE
            settings.safeBrowsingEnabled = true
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(v: WebView, request: WebResourceRequest) = true
                override fun shouldInterceptRequest(v: WebView, request: WebResourceRequest): WebResourceResponse {
                    val path = request.url.encodedPath.orEmpty()
                    val tracked = v === webView && client.allowed(request) && (request.isForMainFrame || DashboardLoad.critical(path))
                    if (tracked) dashboardLoad.begin()
                    return client.intercept(request, { message, critical ->
                        // Falhas da configuração e de fotos pertencem ao retry JavaScript.
                        // Recarregar a página nesses casos perderia a imagem já exibida.
                        if (critical) handler.post {
                            if (v === webView && credentials.read()?.deviceId == c.deviceId) scheduleRetry(message)
                        }
                    }, { success ->
                        if (tracked) { dashboardLoad.complete(path, request.isForMainFrame, success); handler.post { if (v === webView && load === dashboardLoad) updateLoad(v, dashboardLoad) } }
                    })
                }
                override fun onPageFinished(v: WebView, url: String) { if (v === webView && client.dashboardFinished(url)) { dashboardLoad.finish(); updateLoad(v, dashboardLoad) } }
                override fun onReceivedHttpError(v: WebView, request: WebResourceRequest, error: WebResourceResponse) { if (v === webView && (request.isForMainFrame || DashboardLoad.critical(request.url.encodedPath.orEmpty()))) scheduleRetry("Dashboard ou recurso essencial indisponível (HTTP ${error.statusCode}). Tentando novamente…") }
                override fun onReceivedError(v: WebView, request: WebResourceRequest, error: WebResourceError) {
                    if (v === webView && request.isForMainFrame) scheduleRetry("Falha na conexão com o dashboard. Tentando novamente…")
                }
            }
        }
        webView = view
        root.addView(view, 0, FrameLayout.LayoutParams(-1, -1)); statusView.visibility = View.GONE
        view.loadUrl(client.dashboardUrl)
        armWatchdog(view, dashboardLoad)
    }

    private fun cancelTimers() { retry?.let(handler::removeCallbacks); retry = null; watchdog?.let(handler::removeCallbacks); watchdog = null; stable?.let(handler::removeCallbacks); stable = null }
    private fun armWatchdog(view: WebView, state: DashboardLoad) { watchdog?.let(handler::removeCallbacks); watchdog = Runnable { watchdog = null; if (resumed && view === webView && load === state && state.timeout()) updateLoad(view, state) }; handler.postDelayed(watchdog!!, 60_000L) }
    private fun updateLoad(view: WebView, state: DashboardLoad) {
        if (!resumed || view !== webView || load !== state) return
        when (state.state()) {
            DashboardLoad.State.LOADING -> if (watchdog == null) armWatchdog(view, state)
            DashboardLoad.State.FAILED -> scheduleRetry("Falha ao carregar recursos essenciais do dashboard. Tentando novamente…")
            DashboardLoad.State.SUCCEEDED -> { watchdog?.let(handler::removeCallbacks); watchdog = null; if (stable == null) { stable = Runnable { if (resumed && view === webView && load === state && state.state() == DashboardLoad.State.SUCCEEDED) retryMs = 2_000L; stable = null }; handler.postDelayed(stable!!, 60_000L) } }
        }
    }

    private fun scheduleRetry(message: String) {
        if (closed || credentials.read() == null) return
        watchdog?.let(handler::removeCallbacks); watchdog = null
        stable?.let(handler::removeCallbacks); stable = null
        showStatus(message)
        if (!resumed || retry != null) return
        val delay = retryMs; retryMs = (retryMs * 2).coerceAtMost(120_000L)
        retry = Runnable { retry = null; openDashboard() }.also { handler.postDelayed(it, delay) }
    }

    private fun showMenu() {
        if (credentials.read() == null) return showConnection()
        AlertDialog.Builder(this).setTitle("SmartFrame")
            .setItems(arrayOf("Trocar painel", "Configuração da conexão")) { _, which ->
                if (which == 0) showPanels() else showConnection()
            }.setNegativeButton("Fechar", null).show()
    }

    private fun showPanels() {
        val c = credentials.read() ?: return showConnection()
        val progress = AlertDialog.Builder(this).setTitle("Trocar painel").setMessage("Carregando painéis disponíveis…").setNegativeButton("Fechar", null).create()
        progress.show()
        executor.execute {
            try {
                val result = PanelClient.list(c)
                runOnUiThread {
                    if (isDestroyed || !progress.isShowing || credentials.read() != c) return@runOnUiThread
                    progress.dismiss()
                    if (result.isEmpty()) {
                        AlertDialog.Builder(this).setTitle("Trocar painel").setMessage("Nenhum painel disponível. Peça ao administrador para disponibilizar uma publicação.").setPositiveButton("Fechar", null).show()
                    } else {
                        val labels = result.map { panel ->
                            val state = if (!panel.current) "" else if (panel.applied) " — aplicado" else " — aguardando aplicação"
                            panel.name + state + if (panel.updateAvailable) ", nova versão disponível" else ""
                        }.toTypedArray()
                        AlertDialog.Builder(this).setTitle("Trocar painel").setItems(labels) { _, index ->
                            val panel = result[index]
                            if (!panel.current || panel.updateAvailable) switchPanel(c, panel)
                        }.setNegativeButton("Cancelar", null).show()
                    }
                }
            } catch (_: Exception) {
                runOnUiThread {
                    if (isDestroyed || !progress.isShowing || credentials.read() != c) return@runOnUiThread
                    progress.dismiss()
                    AlertDialog.Builder(this).setTitle("Trocar painel").setMessage("Não foi possível consultar os painéis. Verifique a conexão; o painel atual permanece na tela.")
                        .setPositiveButton("Tentar novamente") { _, _ -> showPanels() }.setNegativeButton("Fechar", null).show()
                }
            }
        }
    }

    private fun switchPanel(c: DeviceConnection, panel: AvailablePanel) {
        val progress = AlertDialog.Builder(this).setTitle("Trocar painel").setMessage("Solicitando troca…").setCancelable(false).create()
        progress.show()
        executor.execute {
            val message = try {
                PanelClient.activate(c, panel.id)
                "Troca solicitada. O painel será carregado na próxima sincronização; a aplicação ainda não foi confirmada."
            } catch (_: Exception) {
                "Não foi possível confirmar a troca. A solicitação pode ter sido recebida; consulte novamente os painéis quando a conexão voltar."
            }
            runOnUiThread {
                if (isDestroyed || credentials.read() != c) return@runOnUiThread
                progress.dismiss()
                AlertDialog.Builder(this).setTitle("Trocar painel").setMessage(message).setPositiveButton("Fechar", null).show()
            }
        }
    }

    private fun showConnection() {
        val current = credentials.read()
        val box = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(24, 8, 24, 0) }
        fun field(label: String, text: String, type: Int) = EditText(this).apply {
            hint = label; setText(text); inputType = type; isSingleLine = true; box.addView(this)
        }
        val server = field("Endereço HTTPS do servidor", current?.server ?: if (BuildConfig.DEBUG) "http://localhost:3000" else "https://", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI)
        val code = field("Código do painel", "", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS)
        val name = field("Nome deste tablet", Build.MODEL, InputType.TYPE_CLASS_TEXT)
        AlertDialog.Builder(this).setTitle("Conectar ao SmartFrame").setView(box)
            .setNegativeButton("Fechar", null).setPositiveButton("Conectar", null)
            .apply { if (current != null) setNeutralButton("Desconectar") { _, _ -> credentials.clear(); cancelTimers(); webView?.let { root.removeView(it); it.stopLoading(); it.destroy() }; webView = null; load = null; showStatus("Credencial revogada ou desconectada. Conecte novamente pelo painel.") } }
            .create().also { dialog ->
                dialog.setOnShowListener {
                    dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                        val origin = try { PairingClient.normalizeServer(server.text.toString(), BuildConfig.DEBUG) } catch (e: Exception) { server.error = e.message; return@setOnClickListener }
                        val pairCode = code.text.toString().trim(); val deviceName = name.text.toString().trim()
                        if (!pairCode.matches(Regex("[A-Fa-f0-9-]{10,11}")) || deviceName.isBlank() || deviceName.length > 100) { code.error = "Confira o código e o nome."; return@setOnClickListener }
                        dialog.getButton(AlertDialog.BUTTON_POSITIVE).isEnabled = false
                        executor.execute {
                            try {
                                val data = PairingClient.pair(origin, pairCode, deviceName)
                                credentials.save(data)
                                runOnUiThread { if (!isDestroyed) { dialog.dismiss(); retryMs = 2_000L; showStatus("Conectado. Carregando dashboard online…"); openDashboard() } }
                            } catch (_: Exception) { runOnUiThread { if (!isDestroyed) { dialog.getButton(AlertDialog.BUTTON_POSITIVE).isEnabled = true; code.error = "Falha ao conectar; confira servidor, rede e código." } } }
                        }
                    }
                }
                dialog.show()
            }
    }

    override fun onResume() { super.onResume(); resumed = true; webView?.onResume(); window.decorView.post { hideBars() }; if (credentials.read() != null) { if (webView == null) openDashboard() else load?.let { updateLoad(webView!!, it) } } }
    override fun onPause() { resumed = false; cancelTimers(); webView?.onPause(); super.onPause() }
    @Deprecated("Compatibilidade com Android anterior à API 33")
    @SuppressLint("GestureBackNavigation")
    override fun onBackPressed() { showMenu() }
    override fun onWindowFocusChanged(hasFocus: Boolean) { super.onWindowFocusChanged(hasFocus); if (hasFocus) hideBars() }
    @Suppress("DEPRECATION")
    private fun hideBars() {
        // Alguns firmwares Android 11 do P7 não ocultam a navegação só com InsetsController.
        // O modo sticky legado também deve ser aplicado e restaurado após retomar o app.
        window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or
            View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
            View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
        if (Build.VERSION.SDK_INT >= 30) {
            window.setDecorFitsSystemWindows(false)
            window.insetsController?.apply {
                systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                hide(WindowInsets.Type.systemBars())
            }
        }
    }
    override fun onDestroy() { closed = true; cancelTimers(); handler.removeCallbacksAndMessages(null); executor.shutdownNow(); webView?.destroy(); window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON); super.onDestroy() }
}

internal data class AvailablePanel(val id: String, val name: String, val current: Boolean, val updateAvailable: Boolean, val applied: Boolean)

internal object PanelClient {
    fun list(c: DeviceConnection): List<AvailablePanel> {
        val json = request(c, null)
        val items = json.getJSONArray("panels")
        require(items.length() <= 1000)
        return (0 until items.length()).map { index ->
            val panel = items.getJSONObject(index)
            val id = panel.getString("id"); val name = panel.getString("name")
            require(id.matches(Regex("[A-Za-z0-9_-]{1,128}")) && name.length in 1..80)
            AvailablePanel(id, name, panel.getBoolean("current"), panel.getBoolean("updateAvailable"), panel.getBoolean("applied"))
        }
    }

    fun activate(c: DeviceConnection, panelId: String) {
        require(panelId.matches(Regex("[A-Za-z0-9_-]{1,128}")))
        val revision = request(c, panelId).getString("revision")
        require(revision.matches(Regex("online:[A-Za-z0-9_-]{1,128}")))
    }

    private fun request(c: DeviceConnection, panelId: String?): JSONObject {
        val server = PairingClient.normalizeServer(c.server, BuildConfig.DEBUG)
        val conn = URL("$server/api/player/panels").openConnection() as HttpURLConnection
        return withConnectionDeadline(conn) {
            conn.connectTimeout = 10_000; conn.readTimeout = 15_000; conn.instanceFollowRedirects = false
            conn.setRequestProperty("Authorization", "Bearer ${c.token}")
            conn.setRequestProperty("Accept", "application/json")
            if (panelId != null) {
                conn.requestMethod = "POST"; conn.doOutput = true
                conn.setRequestProperty("Content-Type", "application/json")
                conn.outputStream.use { it.write(JSONObject().put("panelId", panelId).toString().toByteArray(Charsets.UTF_8)) }
            }
            check(conn.responseCode == 200)
            require(conn.contentType?.substringBefore(';')?.trim()?.equals("application/json", true) == true)
            require(conn.contentLengthLong <= 131072)
            val bytes = conn.inputStream.use { input ->
                val output = java.io.ByteArrayOutputStream(); val buffer = ByteArray(4096)
                while (true) { val n = input.read(buffer); if (n < 0) break; require(output.size() + n <= 131072); output.write(buffer, 0, n) }
                output.toByteArray()
            }
            JSONObject(String(bytes, Charsets.UTF_8))
        }
    }
}

internal object PairingClient {
    fun normalizeServer(value: String, debug: Boolean): String {
        val url = URL(value.trim())
        require(url.userInfo == null && url.query == null && url.ref == null && url.path in listOf("", "/"))
        require(url.protocol == "https" || (debug && url.protocol == "http" && url.host in listOf("localhost", "127.0.0.1", "10.0.2.2"))) { "Use HTTPS." }
        return url.toExternalForm().trimEnd('/')
    }
    fun pair(server: String, code: String, name: String): DeviceConnection {
        val conn = URL("$server/api/player/pair").openConnection() as HttpURLConnection
        val active = AtomicReference<HttpURLConnection?>(conn)
        try { return DownloadDeadline.run(20_000, { active.getAndSet(null)?.disconnect() }) {
            conn.connectTimeout = 10_000; conn.readTimeout = 15_000; conn.instanceFollowRedirects = false
            conn.requestMethod = "POST"; conn.doOutput = true; conn.setRequestProperty("Content-Type", "application/json")
            conn.outputStream.use { it.write(JSONObject().put("code", code).put("name", name).toString().toByteArray()) }
            check(conn.responseCode == 200)
            require(conn.contentType?.substringBefore(';')?.trim()?.equals("application/json", true) == true)
            require(conn.contentLengthLong <= 32768)
            val bytes = conn.inputStream.use { input ->
                val out = java.io.ByteArrayOutputStream(); val buf = ByteArray(4096)
                while (true) { val n = input.read(buf); if (n < 0) break; require(out.size() + n <= 32768); out.write(buf, 0, n) }
                out.toByteArray()
            }
            val json = JSONObject(String(bytes, Charsets.UTF_8)); val id = json.getString("deviceId"); val token = json.getString("token")
            require(id.matches(Regex("[A-Za-z0-9_-]{1,128}")) && token.matches(Regex("[A-Za-z0-9_-]{43}")))
            DeviceConnection(server, id, token)
        } } finally { active.getAndSet(null)?.disconnect() }
    }
}
