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
import android.widget.*
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

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
    private val watchdog = Runnable { if (resumed && credentials.read() != null) openDashboard() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        credentials = DeviceCredentials(this)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        root = FrameLayout(this)
        statusView = TextView(this).apply { textSize = 18f; gravity = android.view.Gravity.CENTER; setPadding(32, 32, 32, 32) }
        root.addView(statusView, FrameLayout.LayoutParams(-1, -1))
        statusView.setOnClickListener { showConnection() }
        setContentView(root)
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
        val c = credentials.read() ?: return showStatus("Dispositivo desconectado. Toque para conectar novamente.")
        if (!resumed || closed) return
        retry?.let(handler::removeCallbacks); retry = null
        webView?.let { root.removeView(it); it.stopLoading(); it.destroy() }
        val client = OnlinePlayer(c.server, c.token, c.deviceId)
        val view = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.allowFileAccess = false; settings.allowContentAccess = false
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            settings.cacheMode = WebSettings.LOAD_NO_CACHE
            settings.safeBrowsingEnabled = true
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(v: WebView, request: WebResourceRequest) = true
                override fun shouldInterceptRequest(v: WebView, request: WebResourceRequest): WebResourceResponse = client.intercept(request)
                override fun onPageFinished(v: WebView, url: String) { if (v === webView) { handler.removeCallbacks(watchdog); retryMs = 2_000L } }
                override fun onReceivedError(v: WebView, request: WebResourceRequest, error: WebResourceError) {
                    if (request.isForMainFrame) scheduleRetry("Falha na conexão com o dashboard. Tentando novamente…")
                }
            }
        }
        webView = view
        root.addView(view, 0, FrameLayout.LayoutParams(-1, -1)); statusView.visibility = View.GONE
        view.loadUrl(client.dashboardUrl)
        handler.removeCallbacks(watchdog); handler.postDelayed(watchdog, 60_000L)
    }

    private fun scheduleRetry(message: String) {
        showStatus(message)
        if (!resumed || retry != null) return
        val delay = retryMs; retryMs = (retryMs * 2).coerceAtMost(120_000L)
        retry = Runnable { retry = null; openDashboard() }.also { handler.postDelayed(it, delay) }
    }

    private fun showConnection() {
        val current = credentials.read()
        val box = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(24, 8, 24, 0) }
        fun field(label: String, text: String, type: Int) = EditText(this).apply {
            hint = label; setText(text); inputType = type; isSingleLine = true; box.addView(this)
        }
        val server = field("Endereço HTTPS do servidor", current?.server ?: if (BuildConfig.DEBUG) "http://localhost:3030" else "https://", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI)
        val code = field("Código do painel", "", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS)
        val name = field("Nome deste tablet", Build.MODEL, InputType.TYPE_CLASS_TEXT)
        AlertDialog.Builder(this).setTitle("Conectar ao SmartFrame").setView(box)
            .setNegativeButton("Fechar", null).setPositiveButton("Conectar", null)
            .apply { if (current != null) setNeutralButton("Desconectar") { _, _ -> credentials.clear(); showStatus("Credencial revogada ou desconectada. Conecte novamente pelo painel.") } }
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

    override fun onResume() { super.onResume(); resumed = true; if (credentials.read() != null && webView == null) openDashboard() }
    override fun onPause() { resumed = false; retry?.let(handler::removeCallbacks); retry = null; super.onPause() }
    override fun onBackPressed() { showConnection() }
    override fun onWindowFocusChanged(hasFocus: Boolean) { super.onWindowFocusChanged(hasFocus); if (hasFocus) hideBars() }
    private fun hideBars() { if (Build.VERSION.SDK_INT >= 30) window.insetsController?.hide(WindowInsets.Type.systemBars()) else @Suppress("DEPRECATION") run { window.decorView.systemUiVisibility = 5894 or 512 or 1024 } }
    override fun onDestroy() { closed = true; handler.removeCallbacksAndMessages(null); executor.shutdownNow(); webView?.destroy(); window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON); super.onDestroy() }
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
        try {
            conn.connectTimeout = 10_000; conn.readTimeout = 15_000; conn.instanceFollowRedirects = false
            conn.requestMethod = "POST"; conn.doOutput = true; conn.setRequestProperty("Content-Type", "application/json")
            conn.outputStream.use { it.write(JSONObject().put("code", code).put("name", name).toString().toByteArray()) }
            check(conn.responseCode == 200)
            check(conn.contentLengthLong in 0..32768)
            val bytes = conn.inputStream.use { it.readBytes() }; require(bytes.size <= 32768)
            val json = JSONObject(String(bytes, Charsets.UTF_8)); val id = json.getString("deviceId"); val token = json.getString("token")
            require(id.matches(Regex("[A-Za-z0-9_-]{1,128}")) && token.matches(Regex("[A-Za-z0-9_-]{43}")))
            return DeviceConnection(server, id, token)
        } finally { conn.disconnect() }
    }
}
