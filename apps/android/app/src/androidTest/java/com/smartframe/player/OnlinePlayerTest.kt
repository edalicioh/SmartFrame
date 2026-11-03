package com.smartframe.player

import android.net.Uri
import android.graphics.Bitmap
import android.webkit.WebResourceRequest
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import java.io.ByteArrayOutputStream
import java.net.ServerSocket
import kotlin.concurrent.thread
import java.util.zip.CRC32

@RunWith(AndroidJUnit4::class)
class OnlinePlayerTest {
    private val player = OnlinePlayer("https://frame.example:8443", "private-token")

    private fun request(address: String, main: Boolean = false, method: String = "GET") = object : WebResourceRequest {
        override fun getUrl() = Uri.parse(address)
        override fun isForMainFrame() = main
        override fun isRedirect() = false
        override fun hasGesture() = false
        override fun getMethod() = method
        override fun getRequestHeaders() = emptyMap<String, String>()
    }

    @Test fun testOnlyDashboardNavigation() {
        assertEquals("https://frame.example:8443/player-dashboard/index.html", player.dashboardUrl)
        assertTrue(player.navigationAllowed(request("https://frame.example:8443/player-dashboard/", true)))
        assertTrue(player.navigationAllowed(request("https://frame.example:8443/player-dashboard/index.html", true)))
        assertFalse(player.navigationAllowed(request("https://frame.example:8443/api/player/config", true)))
        assertFalse(player.navigationAllowed(request("https://frame.example:8443/player-dashboard/css/base.css", true)))
        assertFalse(player.navigationAllowed(request("https://frame.example:8443/player-dashboard/", true, "POST")))
    }

    @Suppress("DEPRECATION")
    @Test fun imageBoundsAndMimeAreCheckedBeforeWebView() {
        val bitmap = Bitmap.createBitmap(2, 2, Bitmap.Config.ARGB_8888)
        try {
            for ((format, mime) in listOf(Bitmap.CompressFormat.JPEG to "image/jpeg", Bitmap.CompressFormat.PNG to "image/png", Bitmap.CompressFormat.WEBP to "image/webp")) {
                val output = ByteArrayOutputStream()
                assertTrue(bitmap.compress(format, 90, output))
                val bytes = output.toByteArray()
                assertTrue(mime, validOnlineImage(bytes, mime))
                assertFalse(validOnlineImage(bytes, "image/gif"))
                assertFalse(validOnlineImage(bytes, if (mime == "image/png") "image/jpeg" else "image/png"))
            }
            val output = ByteArrayOutputStream()
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, output)
            val png = output.toByteArray()
            // Substitui apenas o IHDR e seu CRC: a leitura de limites não decodifica pixels.
            fun dimension(offset: Int, value: Int) {
                for (i in 0..3) png[offset + i] = (value ushr (24 - i * 8)).toByte()
            }
            dimension(16, 2048); dimension(20, 1025)
            val crc = CRC32().apply { update(png, 12, 17) }.value
            for (i in 0..3) png[29 + i] = (crc ushr (24 - i * 8)).toByte()
            assertFalse(validOnlineImage(png, "image/png"))
            assertFalse(validOnlineImage(ByteArray(0), "image/png"))
        } finally { bitmap.recycle() }
    }

    @Test fun testOnlySameOriginAndContract() {
        assertTrue(player.allowed(request("https://frame.example:8443/player-dashboard/js/app.js")))
        assertTrue(player.allowed(request("https://frame.example:8443/api/player/config")))
        assertTrue(player.allowed(request("https://frame.example:8443/api/player/online-photos/YWJj?v=${"a".repeat(64)}")))
        for (url in listOf(
            "http://frame.example:8443/api/player/config",
            "https://frame.example/api/player/config",
            "https://frame.example.evil:8443/api/player/config",
            "https://user@frame.example:8443/api/player/config",
            "https://frame.example:8443/api/player/manifest",
            "https://frame.example:8443/api/player/online-photos/x?token=secret",
            "https://frame.example:8443/player-dashboard/../other.js",
            "https://frame.example:8443/player-dashboard/%2e%2e/other.js",
            "https://frame.example:8443/player-dashboard/nested.html"
        )) assertFalse(url, player.allowed(request(url)))
        assertFalse(player.allowed(request("https://frame.example:8443/api/player/config", method = "POST")))
    }

    @Test fun httpResponsesDistinguishCriticalAssetsFromConfigAndPhotos() {
        fun check(path: String, status: Int, mime: String, body: String, expectedCritical: Boolean?, success: Boolean) {
            ServerSocket(0).use { server ->
                server.soTimeout = 5000
                val worker = thread {
                    server.accept().use { socket ->
                        val input = socket.getInputStream().bufferedReader()
                        while (!input.readLine().isNullOrEmpty()) { /* Consome os cabeçalhos. */ }
                        val bytes = body.toByteArray(Charsets.UTF_8)
                        val headers = "HTTP/1.1 $status Test\r\nContent-Type: $mime\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n"
                        socket.getOutputStream().apply { write(headers.toByteArray(Charsets.US_ASCII)); write(bytes); flush() }
                    }
                }
                val local = OnlinePlayer("http://127.0.0.1:${server.localPort}", "private-token")
                val failures = mutableListOf<Boolean>()
                val results = mutableListOf<Boolean>()
                val response = local.intercept(request("http://127.0.0.1:${server.localPort}$path"),
                    { _, critical -> failures.add(critical) }, { results.add(it) })
                worker.join(5000)
                assertFalse(worker.isAlive)
                assertEquals(listOf(success), results)
                assertEquals(expectedCritical?.let { listOf(it) } ?: emptyList<Boolean>(), failures)
                assertEquals(if (success) 200 else 403, response.statusCode)
            }
        }
        check("/player-dashboard/js/config.js", 503, "text/javascript", "", true, false)
        check("/player-dashboard/js/config.js", 200, "text/html", "error", true, false)
        check("/player-dashboard/js/config.js", 200, "application/javascript", "// ok", null, true)
        check("/player-dashboard/css/base.css", 200, "text/css", "body {}", null, true)
        check("/api/player/config", 403, "application/json", "{}", false, false)
        check("/api/player/online-photos/abc", 404, "image/png", "", null, false)
    }
}
