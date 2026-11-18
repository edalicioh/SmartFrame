package com.smartframe.player

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.net.ServerSocket
import java.util.concurrent.atomic.AtomicReference
import kotlin.concurrent.thread

@RunWith(AndroidJUnit4::class)
class TaskClientTest {
    @Test fun acceptsOnlyTheTaskWriteContract() {
        val task = TaskClient.parse("""{"requestId":"task-1","revision":"online:v1","taskId":"t1","completed":true}""")
        assertEquals(TaskToggle("task-1", "online:v1", "t1", true), task)
        for (message in listOf(
            """{"requestId":"task-1","revision":"online:v1","taskId":"t1","completed":true,"url":"https://other.test"}""",
            """{"requestId":"task-1","revision":"online:v1","taskId":"t1","completed":"true"}""",
            """{"requestId":"task-1","revision":"online:v1","taskId":"","completed":true}""",
            """{"requestId":"other","revision":"online:v1","taskId":"t1","completed":true}""",
            """{"requestId":"task-1","revision":"online:v1","taskId":"${"x".repeat(129)}","completed":true}""",
            """{"requestId":"task-1","taskId":"t1","completed":true}""",
            """{"requestId":"task-1","revision":"v1","taskId":"t1","completed":true}""",
            """{"requestId":"task-1","revision":"online:${"x".repeat(129)}","taskId":"t1","completed":true}"""
        )) assertTrue(message, runCatching { TaskClient.parse(message) }.isFailure)
    }

    @Test fun writesOnlyTheFixedTaskRouteWithNativeAuthorizationAndNoRedirects() {
        fun write(status: Int): Triple<String, Map<String, String>, JSONObject> {
            ServerSocket(0).use { server ->
                server.soTimeout = 5000
                val captured = AtomicReference<Triple<String, Map<String, String>, JSONObject>>()
                val worker = thread {
                    server.accept().use { socket ->
                        socket.soTimeout = 5000
                        val input = socket.getInputStream().bufferedReader()
                        val requestLine = input.readLine()
                        val headers = mutableMapOf<String, String>()
                        while (true) {
                            val line = input.readLine()
                            if (line.isNullOrEmpty()) break
                            headers[line.substringBefore(':').lowercase()] = line.substringAfter(':').trim()
                        }
                        val body = CharArray(headers.getValue("content-length").toInt())
                        var offset = 0
                        while (offset < body.size) {
                            val count = input.read(body, offset, body.size - offset)
                            check(count > 0)
                            offset += count
                        }
                        captured.set(Triple(requestLine, headers, JSONObject(String(body))))
                        socket.getOutputStream().apply {
                            write("HTTP/1.1 $status Test\r\nLocation: https://other.test/\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".toByteArray())
                            flush()
                        }
                    }
                }
                val connection = DeviceConnection("http://127.0.0.1:${server.localPort}", "device-1", "native-secret")
                val result = runCatching { TaskClient.toggle(connection, TaskToggle("task-1", "online:v1", "t1", true)) }
                worker.join(5000)
                assertFalse(worker.isAlive)
                assertEquals(status == 200, result.isSuccess)
                return captured.get()
            }
        }
        for (status in listOf(200, 401, 302)) {
            val (requestLine, headers, body) = write(status)
            assertEquals("POST /api/player/tasks?deviceId=device-1 HTTP/1.1", requestLine)
            assertEquals("Bearer native-secret", headers["authorization"])
            assertEquals("application/json", headers["content-type"])
            assertEquals(setOf("revision", "taskId", "completed"), body.keys().asSequence().toSet())
            assertEquals("online:v1", body.getString("revision"))
            assertEquals("t1", body.getString("taskId"))
            assertTrue(body.getBoolean("completed"))
        }
    }

    @Test fun expiredQueuedWriteNeverOpensANetworkConnection() {
        ServerSocket(0).use { server ->
            server.soTimeout = 100
            var now = 0L
            val deadline = TaskWriteDeadline(nowMillis = { now })
            // Simulate time spent behind other slow writes in MainActivity's executor.
            now = 25_000
            val connection = DeviceConnection("http://127.0.0.1:${server.localPort}", "device-1", "native-secret")
            val result = runCatching {
                TaskClient.toggle(connection, TaskToggle("task-1", "online:v1", "t1", true), deadline)
            }
            assertTrue(result.exceptionOrNull() is IllegalStateException)
            assertThrows(java.net.SocketTimeoutException::class.java) { server.accept().close() }
        }
    }
}
