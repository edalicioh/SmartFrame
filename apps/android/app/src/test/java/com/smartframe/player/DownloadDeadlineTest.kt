package com.smartframe.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.assertFalse
import org.junit.Test
import java.net.HttpURLConnection
import java.net.ServerSocket
import java.net.URL
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import java.util.concurrent.atomic.AtomicReference
import kotlin.concurrent.thread

class DownloadDeadlineTest {
    @Test fun successIsReturned() {
        var cancelled = false
        assertEquals("ok", DownloadDeadline.run(1_000, onCancel = { cancelled = true }) { "ok" })
        assertFalse(cancelled)
    }

    @Test fun dataRoutesExpireBeforeTheirJavascriptWatchdogs() {
        assertTrue(onlineDownloadTimeout("/api/player/config") < 10_000L)
        assertTrue(onlineDownloadTimeout("/api/player/online-media/photo") < 8_000L)
        assertEquals(30_000L, onlineDownloadTimeout("/player-dashboard/js/app.js"))
    }

    @Test fun slowHeadersAndSlowBodyHaveTotalDeadlines() {
        for (slowHeaders in listOf(true, false)) {
            ServerSocket(0).use { server ->
                val connected = CountDownLatch(1)
                val worker = thread(isDaemon = true) {
                    try {
                        server.accept().use { socket ->
                            connected.countDown()
                            val input = socket.getInputStream().bufferedReader()
                            while (!input.readLine().isNullOrEmpty()) { }
                            val out = socket.getOutputStream()
                            val headers = "HTTP/1.1 200 OK\r\nContent-Length: 1000\r\nConnection: close\r\n\r\n"
                            if (slowHeaders) {
                                for (byte in headers.toByteArray()) { out.write(byte.toInt()); out.flush(); Thread.sleep(30) }
                            } else {
                                out.write(headers.toByteArray()); out.flush()
                                repeat(1000) { out.write(65); out.flush(); Thread.sleep(30) }
                            }
                        }
                    } catch (_: Exception) { /* Cliente encerrou a conexão. */ }
                }
                val start = System.nanoTime()
                val connection = AtomicReference<HttpURLConnection?>()
                val finished = CountDownLatch(1)
                var cancelled = false
                try {
                    DownloadDeadline.run(500, onCancel = {
                        cancelled = true
                        connection.get()?.disconnect()
                    }) {
                        val client = URL("http://127.0.0.1:${server.localPort}/").openConnection() as HttpURLConnection
                        connection.set(client)
                        try {
                            client.connectTimeout = 1000
                            client.readTimeout = 1000
                            client.inputStream.use { it.readBytes() }
                        } finally { client.disconnect(); finished.countDown() }
                    }
                    throw AssertionError("Download deveria expirar")
                } catch (_: TimeoutException) { }
                assertTrue(connected.await(1, TimeUnit.SECONDS))
                assertTrue(TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start) < 2500)
                assertTrue(cancelled)
                assertTrue(finished.await(2, TimeUnit.SECONDS))
                worker.interrupt()
                worker.join(2000)
            }
        }
    }
}
