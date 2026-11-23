package com.smartframe.player

import org.junit.Assert.*
import org.junit.Test
import java.io.BufferedInputStream
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.InetAddress
import java.net.ServerSocket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import kotlin.concurrent.thread

class ControlDeckClientTest {
    private val validBase =
        """{"requestId":"deck-1","executionId":"exec_12345678","revision":"online:rev_1","bindingId":"bind_1","command":"trigger","idempotent":false}"""

    @Test fun parseAcceptsValidRequiredAndOptionalFields() {
        val trigger = ControlDeckClient.parse(validBase)
        assertEquals("deck-1", trigger.requestId)
        assertEquals("exec_12345678", trigger.executionId)
        assertEquals("online:rev_1", trigger.revision)
        assertEquals("bind_1", trigger.bindingId)
        assertEquals("trigger", trigger.command)
        assertFalse(trigger.idempotent)
        assertNull(trigger.value)
        assertNull(trigger.muted)
        assertNull(trigger.leaseSeconds)
        assertNull(trigger.leaseId)

        val full = ControlDeckClient.parse(
            """{"requestId":"deck-42","executionId":"exec-ptt-0001","revision":"online:v99","bindingId":"mic-1","command":"ptt_renew","idempotent":true,"value":100,"muted":false,"leaseSeconds":30,"leaseId":"lease_abc-9"}""",
        )
        assertEquals("deck-42", full.requestId)
        assertEquals("ptt_renew", full.command)
        assertTrue(full.idempotent)
        assertEquals(100, full.value)
        assertEquals(false, full.muted)
        assertEquals(30, full.leaseSeconds)
        assertEquals("lease_abc-9", full.leaseId)
    }

    @Test fun parseRejectsExtraFieldsInvalidRangesAndOversizedPayloads() {
        val invalidPayloads = listOf(
            // Mais de 2048 bytes UTF-8
            """{"requestId":"deck-1","executionId":"exec_12345678","revision":"online:rev_1","bindingId":"${"a".repeat(2000)}","command":"trigger","idempotent":false}""",
            // Campo extra
            """{"requestId":"deck-1","executionId":"exec_12345678","revision":"online:rev_1","bindingId":"bind_1","command":"trigger","idempotent":false,"extra":"nope"}""",
            """{"requestId":"deck-1","executionId":"exec_12345678","revision":"online:rev_1","bindingId":"bind_1","command":"trigger","idempotent":false,"token":"secret"}""",
            // Campo obrigatório ausente
            """{"requestId":"deck-1","executionId":"exec_12345678","revision":"online:rev_1","bindingId":"bind_1","command":"trigger"}""",
            // requestId inválido
            """{"requestId":"task-1","executionId":"exec_12345678","revision":"online:rev_1","bindingId":"bind_1","command":"trigger","idempotent":false}""",
            """{"requestId":"deck-0","executionId":"exec_12345678","revision":"online:rev_1","bindingId":"bind_1","command":"trigger","idempotent":false}""",
            """{"requestId":"deck-01","executionId":"exec_12345678","revision":"online:rev_1","bindingId":"bind_1","command":"trigger","idempotent":false}""",
            // executionId curto ou inválido
            """{"requestId":"deck-1","executionId":"short","revision":"online:rev_1","bindingId":"bind_1","command":"trigger","idempotent":false}""",
            """{"requestId":"deck-1","executionId":"exec bad!","revision":"online:rev_1","bindingId":"bind_1","command":"trigger","idempotent":false}""",
            // revision inválida
            """{"requestId":"deck-1","executionId":"exec_12345678","revision":"offline:rev_1","bindingId":"bind_1","command":"trigger","idempotent":false}""",
            // bindingId inválido
            """{"requestId":"deck-1","executionId":"exec_12345678","revision":"online:rev_1","bindingId":"bad/id","command":"trigger","idempotent":false}""",
            // command inválido
            """{"requestId":"deck-1","executionId":"exec_12345678","revision":"online:rev_1","bindingId":"bind_1","command":"shell","idempotent":false}""",
            // idempotent não booleano
            """{"requestId":"deck-1","executionId":"exec_12345678","revision":"online:rev_1","bindingId":"bind_1","command":"trigger","idempotent":"false"}""",
            // value fora de 0..100 ou não inteiro
            """{"requestId":"deck-1","executionId":"exec_12345678","revision":"online:rev_1","bindingId":"bind_1","command":"set_level","idempotent":true,"value":-1}""",
            """{"requestId":"deck-1","executionId":"exec_12345678","revision":"online:rev_1","bindingId":"bind_1","command":"set_level","idempotent":true,"value":101}""",
            """{"requestId":"deck-1","executionId":"exec_12345678","revision":"online:rev_1","bindingId":"bind_1","command":"set_level","idempotent":true,"value":50.5}""",
            """{"requestId":"deck-1","executionId":"exec_12345678","revision":"online:rev_1","bindingId":"bind_1","command":"set_level","idempotent":true,"value":null}""",
            // muted não booleano
            """{"requestId":"deck-1","executionId":"exec_12345678","revision":"online:rev_1","bindingId":"bind_1","command":"set_mute","idempotent":true,"muted":"true"}""",
            // leaseSeconds fora de 2..30
            """{"requestId":"deck-1","executionId":"exec_12345678","revision":"online:rev_1","bindingId":"bind_1","command":"ptt_acquire","idempotent":true,"leaseSeconds":1}""",
            """{"requestId":"deck-1","executionId":"exec_12345678","revision":"online:rev_1","bindingId":"bind_1","command":"ptt_acquire","idempotent":true,"leaseSeconds":31}""",
            // leaseId inválido
            """{"requestId":"deck-1","executionId":"exec_12345678","revision":"online:rev_1","bindingId":"bind_1","command":"ptt_release","idempotent":true,"leaseId":"../bad"}""",
            // Chave duplicada ou lixo após JSON
            """{"requestId":"deck-1","requestId":"deck-2","executionId":"exec_12345678","revision":"online:rev_1","bindingId":"bind_1","command":"trigger","idempotent":false}""",
            """$validBase extra""",
        )

        for (payload in invalidPayloads) {
            assertTrue(
                "Esperava rejeição para: $payload",
                runCatching { ControlDeckClient.parse(payload) }.isFailure,
            )
        }
    }

    @Test fun executeSendsSingleAuthenticatedPostAndForwardsSafeFields() {
        val requests = AtomicInteger(0)
        val capturedTarget = AtomicReference<String>()
        val capturedAuth = AtomicReference<String>()
        val capturedBody = AtomicReference<String>()

        withMiniHttpServer({ req ->
            requests.incrementAndGet()
            capturedTarget.set(req.target)
            capturedAuth.set(req.headers["authorization"])
            capturedBody.set(req.body)
            val responseJson =
                """{"status":"ok","bindingId":"b-vol","executionId":"exec_vol_1234","idempotent":true,"message":"Volume atualizado","state":{"level":68,"muted":false,"ignored":"x"},"lease":{"leaseId":"lease-9","expiresAt":"2026-11-20T09:05:00Z","leaseSeconds":10},"secret":"never-forward","requestId":"spoofed"}"""
            MiniResponse(200, "application/json; charset=utf-8", responseJson)
        }) { port ->
            val conn = DeviceConnection(
                server = "http://127.0.0.1:$port",
                deviceId = "dev_123",
                token = "tok_secret_token_01234567890123456789012345",
            )
            val cmd = ControlDeckCommand(
                requestId = "deck-7",
                executionId = "exec_vol_1234",
                revision = "online:v12",
                bindingId = "b-vol",
                command = "set_level",
                idempotent = true,
                value = 68,
            )
            val rawReply = ControlDeckClient.execute(conn, cmd, TaskWriteDeadline(timeoutMillis = 5_000L))
            assertEquals(1, requests.get())
            assertEquals("/api/player/control-deck/execute?deviceId=dev_123", capturedTarget.get())
            assertEquals("Bearer tok_secret_token_01234567890123456789012345", capturedAuth.get())

            val sentMap = parseJsonObject(capturedBody.get())
            assertEquals(setOf("executionId", "revision", "bindingId", "command", "value"), sentMap.keys)
            assertEquals("exec_vol_1234", sentMap["executionId"])
            assertEquals("online:v12", sentMap["revision"])
            assertEquals("b-vol", sentMap["bindingId"])
            assertEquals("set_level", sentMap["command"])
            assertEquals(68L, sentMap["value"])

            val replyMap = parseJsonObject(rawReply)
            assertEquals("deck-7", replyMap["requestId"])
            assertEquals("ok", replyMap["status"])
            assertEquals(true, replyMap["idempotent"])
            assertEquals("Comando executado.", replyMap["message"])
            assertFalse(replyMap.containsKey("secret"))
            @Suppress("UNCHECKED_CAST")
            val stateMap = replyMap["state"] as Map<String, Any?>
            assertEquals(68L, stateMap["level"])
            assertEquals(false, stateMap["muted"])
            assertFalse(stateMap.containsKey("ignored"))
            @Suppress("UNCHECKED_CAST")
            val leaseMap = replyMap["lease"] as Map<String, Any?>
            assertEquals("lease-9", leaseMap["leaseId"])
            assertEquals(10L, leaseMap["leaseSeconds"])
        }
    }

    @Test fun connectFailureBeforeSendMapsToUnavailableWithZeroRetries() {
        val closedSocket = ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))
        val unusedPort = closedSocket.localPort
        closedSocket.close()

        val conn = DeviceConnection(
            server = "http://127.0.0.1:$unusedPort",
            deviceId = "dev_123",
            token = "tok_secret_token_01234567890123456789012345",
        )
        val nonIdemp = ControlDeckClient.parse(validBase)
        val connectReply = parseJsonObject(
            ControlDeckClient.execute(conn, nonIdemp, TaskWriteDeadline(timeoutMillis = 3_000L)),
        )
        assertEquals("deck-1", connectReply["requestId"])
        assertEquals("unavailable", connectReply["status"])
        assertEquals(false, connectReply["idempotent"])
        assertEquals("Host ou servidor inacessível.", connectReply["message"])

        val unknownHostConn = DeviceConnection(
            server = "https://nonexistent.smartframe.invalid",
            deviceId = "dev_123",
            token = "tok_secret_token_01234567890123456789012345",
        )
        val dnsReply = parseJsonObject(
            ControlDeckClient.execute(unknownHostConn, nonIdemp, TaskWriteDeadline(timeoutMillis = 3_000L)),
        )
        assertEquals("unavailable", dnsReply["status"])
        assertEquals(false, dnsReply["idempotent"])
        assertEquals("Host ou servidor inacessível.", dnsReply["message"])
    }

    @Test fun postWriteTimeoutMapsNonIdempotentToUnknownAndIdempotentToUnavailableWithoutRetry() {
        val connections = AtomicInteger(0)
        val releaseServer = CountDownLatch(1)
        val server = ServerSocket(0, 4, InetAddress.getByName("127.0.0.1"))
        val acceptThread = thread {
            while (!server.isClosed) {
                try {
                    val client = server.accept()
                    connections.incrementAndGet()
                    thread {
                        client.use { socket ->
                            val reader = BufferedReader(InputStreamReader(socket.getInputStream()))
                            while (true) {
                                val line = reader.readLine() ?: break
                                if (line.isEmpty()) break
                            }
                            releaseServer.await(5, TimeUnit.SECONDS)
                        }
                    }
                } catch (_: Exception) {
                    break
                }
            }
        }

        try {
            val conn = DeviceConnection(
                server = "http://127.0.0.1:${server.localPort}",
                deviceId = "dev_123",
                token = "tok_secret_token_01234567890123456789012345",
            )
            val nonIdemp = ControlDeckCommand(
                requestId = "deck-2",
                executionId = "exec_timeout_nonidemp",
                revision = "online:v1",
                bindingId = "b-short",
                command = "trigger",
                idempotent = false,
            )
            val replyNonIdemp = parseJsonObject(
                ControlDeckClient.execute(conn, nonIdemp, TaskWriteDeadline(timeoutMillis = 250L)),
            )
            assertEquals(1, connections.get())
            assertEquals("deck-2", replyNonIdemp["requestId"])
            assertEquals("unknown", replyNonIdemp["status"])
            assertEquals(false, replyNonIdemp["idempotent"])
            assertEquals(
                "Sem confirmação do servidor; resultado desconhecido (não reenviado).",
                replyNonIdemp["message"],
            )

            val idemp = nonIdemp.copy(
                requestId = "deck-3",
                executionId = "exec_timeout_idemp",
                command = "set_level",
                value = 50,
                idempotent = true,
            )
            val replyIdemp = parseJsonObject(
                ControlDeckClient.execute(conn, idemp, TaskWriteDeadline(timeoutMillis = 250L)),
            )
            assertEquals(2, connections.get())
            assertEquals("deck-3", replyIdemp["requestId"])
            assertEquals("unavailable", replyIdemp["status"])
            assertEquals(true, replyIdemp["idempotent"])
        } finally {
            releaseServer.countDown()
            server.close()
            acceptThread.join(1000)
        }
    }

    @Test fun http504AndTruncatedPostWriteResponsesMapSafely() {
        val mode = AtomicReference("504_json")
        val calls = AtomicInteger(0)
        withMiniHttpServer({
            calls.incrementAndGet()
            when (mode.get()) {
                "504_json" -> MiniResponse(
                    504,
                    "application/json",
                    """{"status":"unknown","bindingId":"b1","executionId":"exec_12345678","idempotent":false,"message":"Agente expirou durante execução."}""",
                )
                "504_html" -> MiniResponse(504, "text/html", "<html>504 Gateway Timeout</html>")
                else -> MiniResponse(200, "application/json", "{\"status\":\"ok\"", declaredLength = 200)
            }
        }) { port ->
            val conn = DeviceConnection(
                server = "http://127.0.0.1:$port",
                deviceId = "dev_123",
                token = "tok_secret_token_01234567890123456789012345",
            )
            val nonIdemp = ControlDeckClient.parse(validBase)

            val r504Json = parseJsonObject(ControlDeckClient.execute(conn, nonIdemp))
            assertEquals("unknown", r504Json["status"])
            assertEquals(false, r504Json["idempotent"])
            assertEquals(
                "Sem confirmação do servidor; resultado desconhecido (não reenviado).",
                r504Json["message"],
            )

            mode.set("504_html")
            val r504Html = parseJsonObject(ControlDeckClient.execute(conn, nonIdemp))
            assertEquals("unknown", r504Html["status"])
            assertEquals(false, r504Html["idempotent"])

            val idemp = nonIdemp.copy(requestId = "deck-9", idempotent = true)
            val r504HtmlIdemp = parseJsonObject(ControlDeckClient.execute(conn, idemp))
            assertEquals("unavailable", r504HtmlIdemp["status"])
            assertEquals(true, r504HtmlIdemp["idempotent"])

            mode.set("truncated")
            val rTruncated = parseJsonObject(ControlDeckClient.execute(conn, nonIdemp))
            assertEquals("unknown", rTruncated["status"])
            assertEquals(false, rTruncated["idempotent"])
            assertEquals(4, calls.get())
        }
    }

    @Test fun rejects4xxDoesNotForward302AndDropsInvalidLease() {
        val mode = AtomicReference("403")
        val calls = AtomicInteger(0)
        withMiniHttpServer({
            calls.incrementAndGet()
            when (mode.get()) {
                "403" -> MiniResponse(403, "application/json", """{"error":"C:\\Secret\\deny"}""")
                "302" -> MiniResponse(302, "application/json", """{"status":"ok","idempotent":true}""")
                "503_html" -> MiniResponse(503, "text/html", "<html>503</html>")
                "bad_lease" -> MiniResponse(
                    200,
                    "application/json",
                    """{"status":"ok","idempotent":true,"lease":{"leaseId":"bad!","expiresAt":"x","leaseSeconds":99}}""",
                )
                "bad_lease_ts" -> MiniResponse(
                    200,
                    "application/json",
                    """{"status":"ok","idempotent":true,"lease":{"leaseId":"lease-ok-1","expiresAt":"not-a-timestamp","leaseSeconds":10}}""",
                )
                else -> MiniResponse(200, "application/json", "x".repeat(70_000))
            }
        }) { port ->
            val conn = DeviceConnection(
                server = "http://127.0.0.1:$port",
                deviceId = "dev_123",
                token = "tok_secret_token_01234567890123456789012345",
            )
            val nonIdemp = ControlDeckClient.parse(validBase)

            val r403 = parseJsonObject(ControlDeckClient.execute(conn, nonIdemp))
            assertEquals("rejected", r403["status"])
            assertEquals("Acesso negado pelo servidor.", r403["message"])

            mode.set("302")
            val r302 = parseJsonObject(ControlDeckClient.execute(conn, nonIdemp))
            assertEquals("unknown", r302["status"])
            assertEquals(false, r302["idempotent"])

            mode.set("503_html")
            val r503NonIdemp = parseJsonObject(ControlDeckClient.execute(conn, nonIdemp))
            assertEquals("unknown", r503NonIdemp["status"])
            val r503Idemp = parseJsonObject(ControlDeckClient.execute(conn, nonIdemp.copy(idempotent = true)))
            assertEquals("error", r503Idemp["status"])

            mode.set("bad_lease")
            val rBadLease = parseJsonObject(ControlDeckClient.execute(conn, nonIdemp.copy(idempotent = true)))
            assertEquals("ok", rBadLease["status"])
            assertFalse(rBadLease.containsKey("lease"))

            mode.set("bad_lease_ts")
            val rBadLeaseTs = parseJsonObject(ControlDeckClient.execute(conn, nonIdemp.copy(idempotent = true)))
            assertEquals("ok", rBadLeaseTs["status"])
            assertFalse(rBadLeaseTs.containsKey("lease"))

            mode.set("oversized")
            val rOver = parseJsonObject(ControlDeckClient.execute(conn, nonIdemp))
            assertEquals("unknown", rOver["status"])
            assertEquals(7, calls.get())
        }
    }

    private data class MiniRequest(val target: String, val headers: Map<String, String>, val body: String)
    private data class MiniResponse(
        val status: Int,
        val contentType: String,
        val body: String,
        val declaredLength: Int? = null,
    )

    private fun withMiniHttpServer(handler: (MiniRequest) -> MiniResponse, block: (Int) -> Unit) {
        val server = ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"))
        val loop = thread {
            while (!server.isClosed) {
                try {
                    val socket = server.accept()
                    thread {
                        socket.use { s ->
                            val input = BufferedInputStream(s.getInputStream())
                            val headerBytes = readUntilCrlfCrlf(input)
                            val lines = String(headerBytes, Charsets.ISO_8859_1).split("\r\n")
                            val requestLine = lines.firstOrNull().orEmpty().split(" ")
                            val target = requestLine.getOrNull(1).orEmpty()
                            val headers = mutableMapOf<String, String>()
                            for (line in lines.drop(1)) {
                                val colon = line.indexOf(':')
                                if (colon > 0) {
                                    headers[line.substring(0, colon).trim().lowercase()] =
                                        line.substring(colon + 1).trim()
                                }
                            }
                            val contentLength = headers["content-length"]?.toIntOrNull() ?: 0
                            val bodyBytes = ByteArray(contentLength)
                            var offset = 0
                            while (offset < contentLength) {
                                val read = input.read(bodyBytes, offset, contentLength - offset)
                                if (read < 0) break
                                offset += read
                            }
                            val resp = handler(MiniRequest(target, headers, String(bodyBytes, Charsets.UTF_8)))
                            val respBytes = resp.body.toByteArray(Charsets.UTF_8)
                            val len = resp.declaredLength ?: respBytes.size
                            val head = "HTTP/1.1 ${resp.status} OK\r\n" +
                                "Content-Type: ${resp.contentType}\r\n" +
                                "Content-Length: $len\r\n" +
                                "Connection: close\r\n\r\n"
                            val out = s.getOutputStream()
                            out.write(head.toByteArray(Charsets.ISO_8859_1))
                            out.write(respBytes)
                            out.flush()
                        }
                    }
                } catch (_: Exception) {
                    break
                }
            }
        }
        try {
            block(server.localPort)
        } finally {
            server.close()
            loop.join(1000)
        }
    }

    private fun readUntilCrlfCrlf(input: BufferedInputStream): ByteArray {
        val out = java.io.ByteArrayOutputStream()
        var state = 0
        while (true) {
            val b = input.read()
            if (b < 0) break
            out.write(b)
            state = when {
                state == 0 && b == '\r'.code -> 1
                state == 1 && b == '\n'.code -> 2
                state == 2 && b == '\r'.code -> 3
                state == 3 && b == '\n'.code -> return out.toByteArray()
                b == '\r'.code -> 1
                else -> 0
            }
        }
        return out.toByteArray()
    }

    private fun parseJsonObject(src: String): Map<String, Any?> {
        var pos = 0
        fun skipWs() {
            while (pos < src.length && src[pos] in charArrayOf(' ', '\t', '\r', '\n')) pos++
        }
        fun readStr(): String {
            pos++
            val sb = StringBuilder()
            while (pos < src.length) {
                val c = src[pos++]
                if (c == '"') return sb.toString()
                if (c == '\\') {
                    when (val e = src[pos++]) {
                        '"', '\\', '/' -> sb.append(e)
                        'b' -> sb.append('\b')
                        'f' -> sb.append('\u000C')
                        'n' -> sb.append('\n')
                        'r' -> sb.append('\r')
                        't' -> sb.append('\t')
                        'u' -> {
                            sb.append(src.substring(pos, pos + 4).toInt(16).toChar())
                            pos += 4
                        }
                    }
                } else {
                    sb.append(c)
                }
            }
            error("Unterminated JSON string")
        }
        fun readVal(): Any? {
            skipWs()
            return when (src[pos]) {
                '{' -> {
                    pos++
                    val m = linkedMapOf<String, Any?>()
                    skipWs()
                    if (src[pos] == '}') {
                        pos++
                        return m
                    }
                    while (true) {
                        skipWs()
                        val k = readStr()
                        skipWs()
                        pos++
                        m[k] = readVal()
                        skipWs()
                        if (src[pos] == '}') {
                            pos++
                            return m
                        }
                        pos++
                    }
                }
                '"' -> readStr()
                't' -> {
                    pos += 4
                    true
                }
                'f' -> {
                    pos += 5
                    false
                }
                'n' -> {
                    pos += 4
                    null
                }
                else -> {
                    val start = pos
                    if (src[pos] == '-') pos++
                    while (pos < src.length && src[pos] in '0'..'9') pos++
                    src.substring(start, pos).toLong()
                }
            }
        }
        @Suppress("UNCHECKED_CAST")
        return readVal() as Map<String, Any?>
    }
}
