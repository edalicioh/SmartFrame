package com.smartframe.player

import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.content.pm.ActivityInfo
import android.content.res.Configuration
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.ServiceWorkerController
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.webkit.WebViewAssetLoader
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.File
import java.io.FileInputStream
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

class MainActivity : Activity() {
    private lateinit var webView: WebView
    private lateinit var connectButton: Button
    private lateinit var credentials: DeviceCredentials
    private lateinit var sync: FrameSync
    private lateinit var root: FrameLayout
    private var online = false
    private val executor = Executors.newSingleThreadScheduledExecutor()
    private var polling: ScheduledFuture<*>? = null
    @Volatile private var active: JSONObject? = null
    @Volatile private var status = "Conecte este tablet pelo código do painel."
    private var ready = false
    private var recovering = false
    private var resumed = false
    private val retryHandler = Handler(Looper.getMainLooper())
    private var dashboardRetry = DashboardRetry()
    private var retryScheduled = false
    private var successReset: Runnable? = null
    private var loadingWatchdog: Runnable? = null
    private var currentDashboardLoad: DashboardLoad? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        credentials = DeviceCredentials(this)
        sync = FrameSync(File(filesDir, "frames"))
        active = sync.cached()
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        root = FrameLayout(this)
        connectButton = Button(this).apply {
            contentDescription = "Configurar conexão SmartFrame"
            setTextColor(0xffe4ebda.toInt())
            setBackgroundColor(0x44233e31)
            textSize = 12f
            setOnClickListener { showConnection() }
        }
        root.addView(connectButton, FrameLayout.LayoutParams(-2, 48.dp(), Gravity.TOP or Gravity.END).apply { topMargin = 8.dp(); rightMargin = 8.dp() })
        setContentView(root)
        // Service workers não participam do shouldInterceptRequest do WebView.
        ServiceWorkerController.getInstance().serviceWorkerWebSettings.blockNetworkLoads = true
        val savedOnline = getSharedPreferences("smartframe.player", MODE_PRIVATE).getBoolean("online", false)
        openPlayer(savedOnline && credentials.read() != null)
        updateButton()
        hideSystemBars()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun openPlayer(useOnline: Boolean, retrying: Boolean = false) {
        val connection = if (useOnline) credentials.read() else null
        val server = connection?.let { try { sync.normalizeServer(it.server) } catch (_: Exception) { null } }
        online = useOnline && server != null
        getSharedPreferences("smartframe.player", MODE_PRIVATE).edit().putBoolean("online", online).apply()
        ready = false
        recovering = false
        cancelDashboardRetry()
        if (!retrying) dashboardRetry = DashboardRetry()
        if (::webView.isInitialized) {
            root.removeView(webView)
            webView.stopLoading()
            webView.destroy()
        }
        val onlinePlayer = if (online) OnlinePlayer(server!!, connection!!.token) else null
        val dashboardLoad = DashboardLoad()
        currentDashboardLoad = if (onlinePlayer != null) dashboardLoad else null
        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .addPathHandler("/photos/", WebViewAssetLoader.PathHandler { path ->
                try { sync.localPhoto(path)?.let { WebResourceResponse("image/webp", null, FileInputStream(it)) } }
                catch (_: Exception) { null }
            }).build()

        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.domStorageEnabled = false
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            if (onlinePlayer != null) settings.cacheMode = WebSettings.LOAD_NO_CACHE
            settings.safeBrowsingEnabled = true
            settings.setSupportMultipleWindows(false)
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                    // Cada WebView online representa uma única navegação iniciada pelo app.
                    if (onlinePlayer != null) true
                    else !local(request) || request.url.path != "/assets/player/index.html"

                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse {
                    if (onlinePlayer != null) {
                        val tracked = onlinePlayer.allowed(request) &&
                            (request.isForMainFrame || DashboardLoad.critical(request.url.encodedPath.orEmpty()))
                        if (tracked) dashboardLoad.begin()
                        return onlinePlayer.intercept(request, { message, critical ->
                            runOnUiThread {
                                if (!isDestroyed && webView === view && online) {
                                    status = message
                                    if (!critical) Toast.makeText(this@MainActivity, message, Toast.LENGTH_LONG).show()
                                }
                            }
                        }, { success ->
                            if (tracked) {
                                dashboardLoad.complete(request.url.encodedPath.orEmpty(), request.isForMainFrame, success)
                                runOnUiThread { updateDashboardLoad(view, dashboardLoad) }
                            }
                        })
                    }
                    if (local(request)) loader.shouldInterceptRequest(request.url)?.let { return it }
                    return WebResourceResponse("text/plain", "UTF-8", 403, "Forbidden", emptyMap(), ByteArrayInputStream(ByteArray(0)))
                }

                override fun onPageFinished(view: WebView, url: String) {
                    if (view !== webView) return
                    if (onlinePlayer != null) {
                        if (onlinePlayer.dashboardFinished(url)) {
                            dashboardLoad.finish()
                            updateDashboardLoad(view, dashboardLoad)
                        }
                        return
                    }
                    if (url != "https://appassets.androidplatform.net/assets/player/index.html") return
                    ready = true
                    active?.let { render(it) }
                }
            }
        }
        root.addView(webView, 0, FrameLayout.LayoutParams(-1, -1))
        if (online) requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
        webView.loadUrl(onlinePlayer?.dashboardUrl ?: "https://appassets.androidplatform.net/assets/player/index.html")
        if (onlinePlayer != null) updateDashboardLoad(webView, dashboardLoad)
    }

    private fun cancelDashboardRetry() {
        retryHandler.removeCallbacksAndMessages(null)
        retryScheduled = false
        successReset = null
        loadingWatchdog = null
    }

    private fun cancelLoadingWatchdog() {
        loadingWatchdog?.let { retryHandler.removeCallbacks(it) }
        loadingWatchdog = null
    }

    private fun watchDashboardLoad(view: WebView, load: DashboardLoad) {
        if (!resumed || loadingWatchdog != null) return
        val watchdog = Runnable {
            loadingWatchdog = null
            if (resumed && !isDestroyed && online && view === webView && currentDashboardLoad === load && load.timeout()) {
                status = "Tempo esgotado ao carregar o dashboard online. Confira a rede e o servidor."
                updateDashboardLoad(view, load)
            }
        }
        loadingWatchdog = watchdog
        retryHandler.postDelayed(watchdog, 60_000L)
    }

    private fun updateDashboardLoad(view: WebView, load: DashboardLoad) {
        if (isDestroyed || view !== webView || !online) return
        when (load.state()) {
            DashboardLoad.State.LOADING -> watchDashboardLoad(view, load)
            DashboardLoad.State.FAILED -> {
                cancelLoadingWatchdog()
                successReset?.let { retryHandler.removeCallbacks(it) }
                successReset = null
                dashboardRetry.failure()
                scheduleDashboardRetry(view)
            }
            DashboardLoad.State.SUCCEEDED -> {
                cancelLoadingWatchdog()
                // Só reinicia o backoff depois de um período estável: recursos tardios
                // que falham em toda navegação não devem provocar ciclos de 2 segundos.
                if (resumed && dashboardRetry.failed && successReset == null) {
                    cancelDashboardRetry()
                    val reset = Runnable {
                        successReset = null
                        if (resumed && !isDestroyed && online && view === webView && load.state() == DashboardLoad.State.SUCCEEDED) {
                            dashboardRetry.success()
                        }
                    }
                    successReset = reset
                    retryHandler.postDelayed(reset, 60_000L)
                }
            }
        }
    }

    private fun scheduleDashboardRetry(view: WebView) {
        if (!resumed || !online || isDestroyed || view !== webView || retryScheduled || successReset != null ||
            !dashboardRetry.canRetry(currentDashboardLoad?.state())) return
        val delay = dashboardRetry.nextDelay() ?: return
        retryScheduled = true
        retryHandler.postDelayed({
            retryScheduled = false
            if (resumed && online && !isDestroyed && view === webView &&
                dashboardRetry.canRetry(currentDashboardLoad?.state())) {
                dashboardRetry.attempted()
                openPlayer(true, retrying = true)
            }
        }, delay)
    }

    private fun local(request: WebResourceRequest): Boolean = request.method == "GET" &&
        request.url.scheme == "https" && request.url.host == "appassets.androidplatform.net" &&
        request.url.port in listOf(-1, 443) &&
        (request.url.path.orEmpty().startsWith("/assets/player/") || request.url.path.orEmpty().matches(Regex("/photos/[a-f0-9]{64}\\.webp")))

    private fun Int.dp() = (this * resources.displayMetrics.density).toInt()
    private fun updateButton() {
        val linked = credentials.read() != null
        connectButton.text = if (linked) "⋮" else "Conectar"
        connectButton.textSize = if (linked) 22f else 12f
        connectButton.minimumWidth = 48.dp()
        connectButton.minWidth = 48.dp()
    }
    private fun submit(action: () -> Unit) { if (!executor.isShutdown) executor.execute { if (!isDestroyed) action() } }

    private fun render(manifest: JSONObject) {
        if (!ready || isDestroyed || online) return
        val frame = manifest.getJSONObject("layout").getJSONObject("photoFrame")
        val occupied = mutableSetOf(frame.getJSONObject("clock").getString("position"))
        frame.optJSONObject("widgets")?.let { settings ->
            if (settings.getJSONObject("weather").getBoolean("enabled") || settings.getJSONObject("currencies").getBoolean("enabled")) occupied.add(settings.getString("position"))
        }
        val corner = listOf("top-right", "bottom-right", "top-left", "bottom-left").first { it !in occupied }
        (connectButton.layoutParams as FrameLayout.LayoutParams).apply {
            gravity = (if (corner.startsWith("top")) Gravity.TOP else Gravity.BOTTOM) or (if (corner.endsWith("right")) Gravity.END else Gravity.START)
            bottomMargin = 8.dp()
            leftMargin = 8.dp()
            connectButton.layoutParams = this
        }
        requestedOrientation = if (frame.getString("orientation") == "portrait") ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT else ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        val json = frame.toString().replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
        val photo = sync.photo(manifest)?.let { JSONObject.quote(it) } ?: "null"
        val widgets = manifest.optJSONObject("widgetData")?.toString() ?: "null"
        val renderer = webView
        renderer.evaluateJavascript("window.SmartFrame && window.SmartFrame.apply($json, $photo, $widgets)") { result ->
            if (online || renderer !== webView || isDestroyed) return@evaluateJavascript
            if (result == "true") {
              recovering = false
              submit {
                sync.cleanup()
                credentials.read()?.let { connection ->
                    if (connection.deviceId == manifest.getString("deviceId")) try {
                        sync.request(connection.server, "/api/player/heartbeat", connection.token, JSONObject().put("revision", manifest.getString("revision")))
                    } catch (_: Exception) { /* Conteúdo aplicado continua disponível offline. */ }
                }
              }
            } else if (!recovering) {
              recovering = true
              submit {
                sync.rollback()?.let { old ->
                    active = old
                    if (old.getString("revision") != manifest.getString("revision")) runOnUiThread { render(old) }
                }
              }
            }
        }
    }

    private fun synchronize() {
        val connection = credentials.read() ?: return
        try {
            val bytes = sync.request(connection.server, "/api/player/manifest", connection.token)
            if (bytes == null) { status = "Conectado. Publique um layout no painel."; return }
            val manifest = JSONObject(String(bytes, Charsets.UTF_8))
            sync.validate(manifest)
            require(manifest.getString("deviceId") == connection.deviceId)
            if (active?.optString("revision") != manifest.getString("revision") || active?.optJSONObject("widgetData")?.toString() != manifest.optJSONObject("widgetData")?.toString()) {
                sync.update(connection, manifest)
                active = manifest
            }
            status = "Conectado. Última revisão recebida: ${manifest.getString("revision")}"
            runOnUiThread { if (!isDestroyed) { active?.let { render(it) }; updateButton() } }
        } catch (failure: Exception) {
            if (failure is FrameHttpError && failure.status == 401) {
                credentials.clear()
                status = "Credencial revogada. Gere outro código no painel para reconectar."
                runOnUiThread { if (!isDestroyed) { if (online) openPlayer(false); updateButton() } }
            } else status = "Sem sincronização no momento. O último layout salvo continua em exibição."
        }
    }

    private fun showConnection() {
        val current = credentials.read()
        val panel = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(24.dp(), 8.dp(), 24.dp(), 0) }
        panel.addView(TextView(this).apply { text = status; textSize = 13f })
        panel.addView(Button(this).apply {
            text = if (online) "Usar player offline" else "Usar dashboard online"
            isEnabled = current != null
            setOnClickListener {
                openPlayer(!online)
                Toast.makeText(this@MainActivity, if (online) "Dashboard online ativado." else "Player offline ativado.", Toast.LENGTH_LONG).show()
                text = if (online) "Usar player offline" else "Usar dashboard online"
            }
        })
        fun input(label: String, value: String, type: Int): EditText {
            panel.addView(TextView(this).apply { text = label; setPadding(0, 14.dp(), 0, 2.dp()) })
            return EditText(this).apply { setText(value); inputType = type; isSingleLine = true; panel.addView(this) }
        }
        val server = input("Endereço do servidor", current?.server ?: if (BuildConfig.DEBUG) "http://localhost:3030" else "https://", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI)
        val code = input("Código gerado no painel", "", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS)
        val name = input("Nome deste tablet", Build.MODEL, InputType.TYPE_CLASS_TEXT)
        val dialog = AlertDialog.Builder(this).setTitle("Conectar ao SmartFrame").setView(panel)
            .setNegativeButton("Fechar", null).setPositiveButton("Conectar", null)
            .apply {
                if (current != null) setNeutralButton("Desconectar") { _, _ ->
                    credentials.clear(); if (online) openPlayer(false); updateButton(); status = "Desconectado. O último conteúdo local foi preservado."
                }
            }.create()
        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val origin = try { sync.normalizeServer(server.text.toString()) }
                catch (failure: Exception) { server.error = failure.message ?: "Endereço inválido"; return@setOnClickListener }
                val pairingCode = code.text.toString().trim()
                val deviceName = name.text.toString().trim()
                if (deviceName.isEmpty() || deviceName.length > 100 || !pairingCode.matches(Regex("[A-Fa-f0-9-]{10,11}"))) {
                    code.error = "Confira o código e o nome do tablet."; return@setOnClickListener
                }
                dialog.getButton(AlertDialog.BUTTON_POSITIVE).isEnabled = false
                submit {
                    try {
                        val response = sync.request(origin, "/api/player/pair", body = JSONObject().put("code", pairingCode).put("name", deviceName)) ?: error("Resposta ausente")
                        val data = JSONObject(String(response, Charsets.UTF_8))
                        require(data.getString("token").matches(Regex("[A-Za-z0-9_-]{43}")))
                        require(data.getString("deviceId").matches(Regex("[A-Za-z0-9_-]{1,128}")))
                        credentials.save(DeviceConnection(origin, data.getString("deviceId"), data.getString("token")))
                        runOnUiThread { if (!isDestroyed) { if (online) openPlayer(true); dialog.dismiss(); updateButton(); Toast.makeText(this, "Tablet conectado. Buscando publicação…", Toast.LENGTH_LONG).show() } }
                        synchronize()
                    } catch (failure: Exception) {
                        runOnUiThread { if (!isDestroyed) {
                            dialog.getButton(AlertDialog.BUTTON_POSITIVE).isEnabled = true
                            code.error = if (failure is FrameHttpError && failure.status == 400) "Código inválido, usado ou expirado." else "Não foi possível conectar. Confira endereço, rede/USB e tente novamente."
                        } }
                    }
                }
            }
        }
        dialog.show()
    }

    override fun onResume() {
        super.onResume()
        resumed = true
        if (::webView.isInitialized) webView.onResume()
        if (online && ::webView.isInitialized) currentDashboardLoad?.let { load ->
            updateDashboardLoad(webView, load)
        }
        if (polling == null && !executor.isShutdown) polling = executor.scheduleWithFixedDelay({ synchronize() }, 0, 30, TimeUnit.SECONDS)
        hideSystemBars()
    }

    override fun onPause() {
        resumed = false
        cancelDashboardRetry()
        polling?.cancel(false); polling = null
        if (::webView.isInitialized) webView.onPause()
        super.onPause()
    }

    override fun onConfigurationChanged(newConfig: Configuration) { super.onConfigurationChanged(newConfig); hideSystemBars() }
    override fun onWindowFocusChanged(hasFocus: Boolean) { super.onWindowFocusChanged(hasFocus); if (hasFocus) hideSystemBars() }

    @Suppress("DEPRECATION")
    private fun hideSystemBars() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) window.insetsController?.apply {
            hide(WindowInsets.Type.systemBars())
            systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        } else window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or View.SYSTEM_UI_FLAG_LAYOUT_STABLE or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
    }

    override fun onDestroy() {
        resumed = false
        cancelDashboardRetry()
        polling?.cancel(false); executor.shutdownNow()
        webView.stopLoading(); webView.destroy()
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        super.onDestroy()
    }
}
