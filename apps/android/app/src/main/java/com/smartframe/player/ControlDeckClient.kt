package com.smartframe.player

import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.ConnectException
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URL
import java.net.UnknownHostException
import java.time.OffsetDateTime
import java.util.concurrent.ExecutionException
import java.util.concurrent.TimeoutException
import java.util.concurrent.atomic.AtomicBoolean

internal data class ControlDeckCommand(
    val requestId: String,
    val executionId: String,
    val revision: String,
    val bindingId: String,
    val command: String,
    val idempotent: Boolean,
    val value: Int? = null,
    val muted: Boolean? = null,
    val leaseSeconds: Int? = null,
    val leaseId: String? = null,
    val leaseRequestId: String? = null,
)

/**
 * Executa comandos do Control Deck pela rota autenticada do dispositivo sem expor
 * credenciais ao JavaScript e sem reenvio automático em falhas pós-escrita.
 */
internal object ControlDeckClient {
    private const val MAX_MESSAGE_BYTES = 2048
    private const val MAX_RESPONSE_BYTES = 65536
    private val REQUEST_ID_REGEX = Regex("^deck-[1-9][0-9]{0,8}$")
    private val EXECUTION_ID_REGEX = Regex("^[A-Za-z0-9_-]{8,64}$")
    private val REVISION_REGEX = Regex("^online:[A-Za-z0-9_-]{1,128}$")
    private val ID_REGEX = Regex("^[A-Za-z0-9_-]{1,128}$")
    private val ALLOWED_COMMANDS = setOf(
        "trigger",
        "set_level",
        "set_mute",
        "ptt_acquire",
        "ptt_renew",
        "ptt_release",
    )
    private val REQUIRED_KEYS = setOf(
        "requestId",
        "executionId",
        "revision",
        "bindingId",
        "command",
        "idempotent",
    )
    private val OPTIONAL_KEYS =
        setOf("value", "muted", "leaseSeconds", "leaseId", "leaseRequestId")
    private val ALLOWED_KEYS = REQUIRED_KEYS + OPTIONAL_KEYS
    private val ISO_TIMESTAMP_REGEX =
        Regex("^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,9})?(?:Z|[+-]\\d{2}:\\d{2})$")
    private val ALLOWED_RESULT_STATUSES = setOf("ok", "unavailable", "unknown", "rejected", "error")
    private val ALLOWED_PLAYBACK_STATES = setOf("playing", "paused", "stopped", "unknown")

    fun parse(message: String): ControlDeckCommand {
        require(message.toByteArray(Charsets.UTF_8).size <= MAX_MESSAGE_BYTES)
        val json = StrictJson.parseObject(message)
        require(json.keys.containsAll(REQUIRED_KEYS) && ALLOWED_KEYS.containsAll(json.keys))

        val requestId = json["requestId"] as? String
        val executionId = json["executionId"] as? String
        val revision = json["revision"] as? String
        val bindingId = json["bindingId"] as? String
        val command = json["command"] as? String
        val idempotent = json["idempotent"] as? Boolean

        require(requestId != null && requestId.matches(REQUEST_ID_REGEX))
        require(executionId != null && executionId.matches(EXECUTION_ID_REGEX))
        require(revision != null && revision.matches(REVISION_REGEX))
        require(bindingId != null && bindingId.matches(ID_REGEX))
        require(command != null && command in ALLOWED_COMMANDS)
        require(idempotent != null)

        val value = if ("value" in json) {
            val raw = json["value"] as? Long
            require(raw != null && raw in 0L..100L)
            raw.toInt()
        } else {
            null
        }
        val muted = if ("muted" in json) {
            val raw = json["muted"] as? Boolean
            require(raw != null)
            raw
        } else {
            null
        }
        val leaseSeconds = if ("leaseSeconds" in json) {
            val raw = json["leaseSeconds"] as? Long
            require(raw != null && raw in 2L..30L)
            raw.toInt()
        } else {
            null
        }
        val leaseId = if ("leaseId" in json) {
            val raw = json["leaseId"] as? String
            require(raw != null && raw.matches(ID_REGEX))
            raw
        } else {
            null
        }
        val leaseRequestId = if ("leaseRequestId" in json) {
            val raw = json["leaseRequestId"] as? String
            require(raw != null && raw.matches(EXECUTION_ID_REGEX))
            raw
        } else {
            null
        }
        if (command == "ptt_acquire") {
            require(leaseRequestId == executionId)
        }
        if (command == "ptt_release" && leaseId == null) {
            require(leaseRequestId != null)
        }

        return ControlDeckCommand(
            requestId = requestId,
            executionId = executionId,
            revision = revision,
            bindingId = bindingId,
            command = command,
            idempotent = idempotent,
            value = value,
            muted = muted,
            leaseSeconds = leaseSeconds,
            leaseId = leaseId,
            leaseRequestId = leaseRequestId,
        )
    }

    fun execute(
        c: DeviceConnection,
        cmd: ControlDeckCommand,
        deadline: TaskWriteDeadline = TaskWriteDeadline(timeoutMillis = 8_000L),
    ): String {
        val server = try {
            require(c.deviceId.matches(ID_REGEX))
            deadline.remainingMillis()
            PairingClient.normalizeServer(c.server, BuildConfig.DEBUG)
        } catch (_: Exception) {
            return buildResultJson(
                requestId = cmd.requestId,
                status = "unavailable",
                idempotent = cmd.idempotent,
                message = "Host ou servidor inacessível.",
            )
        }

        val bodyBytes = buildExecuteBody(cmd).toByteArray(Charsets.UTF_8)
        val writeStarted = AtomicBoolean(false)

        return try {
            val connection = URL("$server/api/player/control-deck/execute?deviceId=${c.deviceId}")
                .openConnection() as HttpURLConnection
            val response = withConnectionDeadline(connection, deadline.remainingMillis()) {
                val remaining = deadline.remainingMillis().coerceAtMost(8_000L).toInt()
                connection.connectTimeout = remaining
                connection.readTimeout = remaining
                connection.instanceFollowRedirects = false
                connection.requestMethod = "POST"
                connection.doOutput = true
                connection.setFixedLengthStreamingMode(bodyBytes.size)
                connection.setRequestProperty("Authorization", "Bearer ${c.token}")
                connection.setRequestProperty("Content-Type", "application/json")
                connection.setRequestProperty("Accept", "application/json")
                deadline.remainingMillis()
                connection.connect()
                deadline.remainingMillis()
                writeStarted.set(true)
                connection.outputStream.use {
                    it.write(bodyBytes)
                    it.flush()
                }
                val httpStatus = connection.responseCode
                val contentType = connection.contentType?.substringBefore(';')?.trim()?.lowercase()
                val expectedLength = connection.contentLengthLong
                if (expectedLength > MAX_RESPONSE_BYTES) {
                    throw IOException("Resposta excede o limite permitido.")
                }
                val stream = if (httpStatus in 200..299) connection.inputStream else connection.errorStream
                val bytes = if (stream != null) {
                    stream.use { input ->
                        val out = ByteArrayOutputStream()
                        val buf = ByteArray(4096)
                        while (true) {
                            val n = input.read(buf)
                            if (n < 0) break
                            if (out.size() + n > MAX_RESPONSE_BYTES) {
                                throw IOException("Resposta excede o limite permitido.")
                            }
                            out.write(buf, 0, n)
                        }
                        out.toByteArray()
                    }
                } else {
                    ByteArray(0)
                }
                if (expectedLength >= 0 && bytes.size.toLong() != expectedLength) {
                    throw IOException("Resposta truncada.")
                }
                Triple(httpStatus, contentType, String(bytes, Charsets.UTF_8))
            }
            handleHttpResponse(cmd, response.first, response.second, response.third)
        } catch (error: Throwable) {
            val cause = if (error is ExecutionException) error.cause ?: error else error
            mapTransportFailure(cmd, writeStarted.get(), cause)
        }
    }

    internal fun fallbackErrorJson(cmd: ControlDeckCommand): String =
        if (!cmd.idempotent) {
            buildResultJson(
                requestId = cmd.requestId,
                status = "unknown",
                idempotent = false,
                message = "Sem confirmação do servidor; resultado desconhecido (não reenviado).",
            )
        } else {
            buildResultJson(
                requestId = cmd.requestId,
                status = "unavailable",
                idempotent = true,
                message = "Sem resposta do servidor.",
            )
        }

    private fun handleHttpResponse(
        cmd: ControlDeckCommand,
        httpStatus: Int,
        contentType: String?,
        body: String,
    ): String {
        val parsed = if (contentType == "application/json" && body.isNotBlank()) {
            try {
                StrictJson.parseObject(body)
            } catch (_: Exception) {
                null
            }
        } else {
            null
        }

        if (httpStatus == 200 || httpStatus == 503 || httpStatus == 504) {
            if (parsed != null) {
                val forwarded = forwardSafeServerResult(cmd, parsed)
                if (forwarded != null) return forwarded
            }
            return if (!cmd.idempotent) {
                buildResultJson(
                    requestId = cmd.requestId,
                    status = "unknown",
                    idempotent = false,
                    message = "Sem confirmação do servidor; resultado desconhecido (não reenviado).",
                )
            } else {
                buildResultJson(
                    requestId = cmd.requestId,
                    status = if (httpStatus == 503) "error" else "unavailable",
                    idempotent = true,
                    message = when (httpStatus) {
                        504 -> "Tempo limite excedido no servidor."
                        503 -> "Host ou agente indisponível."
                        else -> "Resposta inválida do servidor."
                    },
                )
            }
        }

        if (httpStatus in 300..399) {
            return if (!cmd.idempotent) {
                buildResultJson(
                    requestId = cmd.requestId,
                    status = "unknown",
                    idempotent = false,
                    message = "Redirecionamento inesperado; resultado desconhecido (não reenviado).",
                )
            } else {
                buildResultJson(
                    requestId = cmd.requestId,
                    status = "unavailable",
                    idempotent = true,
                    message = "Redirecionamento inesperado do servidor.",
                )
            }
        }

        if (httpStatus in 400..499) {
            val fixedMsg = when (httpStatus) {
                401, 403 -> "Acesso negado pelo servidor."
                404 -> "Vínculo do Control Deck não encontrado."
                409 -> "Painel atualizado; tente novamente."
                429 -> "Muitos comandos em sequência; aguarde."
                else -> "Comando rejeitado pelo servidor."
            }
            return buildResultJson(
                requestId = cmd.requestId,
                status = "rejected",
                idempotent = cmd.idempotent,
                message = fixedMsg,
            )
        }

        return if (!cmd.idempotent) {
            buildResultJson(
                requestId = cmd.requestId,
                status = "unknown",
                idempotent = false,
                message = "Sem confirmação do servidor; resultado desconhecido (não reenviado).",
            )
        } else {
            buildResultJson(
                requestId = cmd.requestId,
                status = "unavailable",
                idempotent = true,
                message = "Servidor temporariamente indisponível.",
            )
        }
    }

    private fun forwardSafeServerResult(
        cmd: ControlDeckCommand,
        parsed: Map<String, Any?>,
    ): String? {
        val status = parsed["status"] as? String ?: return null
        if (status !in ALLOWED_RESULT_STATUSES) return null

        val idempotent = if (!cmd.idempotent && status == "unknown") {
            false
        } else {
            (parsed["idempotent"] as? Boolean) ?: cmd.idempotent
        }
        val message = when (status) {
            "ok" -> "Comando executado."
            "unknown" -> "Sem confirmação do servidor; resultado desconhecido (não reenviado)."
            "unavailable" -> "Host indisponível."
            "rejected" -> "Comando rejeitado pelo host."
            else -> "Falha ao executar comando."
        }
        val state = sanitizeState(parsed["state"])
        val lease = sanitizeLease(parsed["lease"])

        return buildResultJson(
            requestId = cmd.requestId,
            status = status,
            idempotent = idempotent,
            message = message,
            state = state,
            lease = lease,
        )
    }

    private fun sanitizeState(raw: Any?): Map<String, Any?>? {
        val map = raw as? Map<*, *> ?: return null
        val out = linkedMapOf<String, Any?>()
        if ("level" in map) {
            val level = map["level"]
            if (level == null) {
                out["level"] = null
            } else if (level is Long && level in 0L..100L) {
                out["level"] = level.toInt()
            }
        }
        if ("muted" in map) {
            val muted = map["muted"]
            if (muted == null || muted is Boolean) {
                out["muted"] = muted
            }
        }
        if ("playbackState" in map) {
            val playback = map["playbackState"] as? String
            if (playback != null && playback in ALLOWED_PLAYBACK_STATES) {
                out["playbackState"] = playback
            }
        }
        return if (out.isEmpty()) null else out
    }

    private fun sanitizeLease(raw: Any?): Map<String, Any?>? {
        val map = raw as? Map<*, *> ?: return null
        val leaseId = map["leaseId"] as? String ?: return null
        val expiresAt = map["expiresAt"] as? String ?: return null
        val leaseSeconds = map["leaseSeconds"] as? Long ?: return null
        if (
            !leaseId.matches(ID_REGEX) ||
            expiresAt.length > 64 ||
            !expiresAt.matches(ISO_TIMESTAMP_REGEX) ||
            leaseSeconds !in 2L..30L
        ) {
            return null
        }
        try {
            OffsetDateTime.parse(expiresAt)
        } catch (_: Exception) {
            return null
        }
        return linkedMapOf(
            "leaseId" to leaseId,
            "expiresAt" to expiresAt,
            "leaseSeconds" to leaseSeconds.toInt(),
        )
    }

    private fun mapTransportFailure(
        cmd: ControlDeckCommand,
        writeStarted: Boolean,
        cause: Throwable,
    ): String {
        if (cause is ConnectException || cause is UnknownHostException || !writeStarted) {
            return buildResultJson(
                requestId = cmd.requestId,
                status = "unavailable",
                idempotent = cmd.idempotent,
                message = "Host ou servidor inacessível.",
            )
        }
        if (!cmd.idempotent) {
            return buildResultJson(
                requestId = cmd.requestId,
                status = "unknown",
                idempotent = false,
                message = "Sem confirmação do servidor; resultado desconhecido (não reenviado).",
            )
        }
        return buildResultJson(
            requestId = cmd.requestId,
            status = "unavailable",
            idempotent = cmd.idempotent,
            message = "Sem resposta do servidor.",
        )
    }

    private fun buildExecuteBody(cmd: ControlDeckCommand): String {
        val map = linkedMapOf<String, Any?>(
            "executionId" to cmd.executionId,
            "revision" to cmd.revision,
            "bindingId" to cmd.bindingId,
            "command" to cmd.command,
        )
        if (cmd.value != null) map["value"] = cmd.value
        if (cmd.muted != null) map["muted"] = cmd.muted
        if (cmd.leaseSeconds != null) map["leaseSeconds"] = cmd.leaseSeconds
        if (cmd.leaseId != null) map["leaseId"] = cmd.leaseId
        if (cmd.leaseRequestId != null) map["leaseRequestId"] = cmd.leaseRequestId
        return StrictJson.stringify(map)
    }

    private fun buildResultJson(
        requestId: String,
        status: String,
        idempotent: Boolean,
        message: String,
        state: Map<String, Any?>? = null,
        lease: Map<String, Any?>? = null,
    ): String {
        val map = linkedMapOf<String, Any?>(
            "requestId" to requestId,
            "status" to status,
            "idempotent" to idempotent,
            "message" to message,
        )
        if (state != null) map["state"] = state
        if (lease != null) map["lease"] = lease
        return StrictJson.stringify(map)
    }
}

/**
 * Parser e serializador JSON RFC 8259 sem dependências externas ou stubs do Android SDK,
 * garantindo comportamento idêntico no dispositivo e em testes unitários na JVM.
 */
private object StrictJson {
    private const val MAX_DEPTH = 16

    fun parseObject(text: String): Map<String, Any?> {
        val parser = Parser(text)
        val value = parser.readValue(0)
        parser.skipWhitespace()
        require(parser.isEnd()) { "Trailing characters after JSON object." }
        @Suppress("UNCHECKED_CAST")
        return value as? Map<String, Any?> ?: throw IllegalArgumentException("Expected JSON object.")
    }

    fun stringify(value: Any?): String {
        val sb = StringBuilder()
        writeValue(sb, value)
        return sb.toString()
    }

    private fun writeValue(sb: StringBuilder, value: Any?) {
        when (value) {
            null -> sb.append("null")
            is Boolean -> sb.append(value)
            is Int, is Long -> sb.append(value.toString())
            is String -> writeString(sb, value)
            is Map<*, *> -> {
                sb.append('{')
                var first = true
                for ((k, v) in value) {
                    if (k !is String) continue
                    if (!first) sb.append(',')
                    first = false
                    writeString(sb, k)
                    sb.append(':')
                    writeValue(sb, v)
                }
                sb.append('}')
            }
            is Iterable<*> -> {
                sb.append('[')
                var first = true
                for (item in value) {
                    if (!first) sb.append(',')
                    first = false
                    writeValue(sb, item)
                }
                sb.append(']')
            }
            else -> throw IllegalArgumentException("Unsupported JSON type: ${value::class.java}")
        }
    }

    private fun writeString(sb: StringBuilder, value: String) {
        sb.append('"')
        for (ch in value) {
            when (ch) {
                '"' -> sb.append("\\\"")
                '\\' -> sb.append("\\\\")
                '\b' -> sb.append("\\b")
                '\u000C' -> sb.append("\\f")
                '\n' -> sb.append("\\n")
                '\r' -> sb.append("\\r")
                '\t' -> sb.append("\\t")
                else -> if (ch.code < 0x20) {
                    sb.append("\\u")
                    sb.append(ch.code.toString(16).padStart(4, '0'))
                } else {
                    sb.append(ch)
                }
            }
        }
        sb.append('"')
    }

    private class Parser(private val src: String) {
        private var pos = 0

        fun isEnd(): Boolean = pos >= src.length

        fun skipWhitespace() {
            while (pos < src.length && src[pos] in charArrayOf(' ', '\t', '\r', '\n')) {
                pos++
            }
        }

        fun readValue(depth: Int): Any? {
            require(depth <= MAX_DEPTH) { "JSON nesting exceeds maximum depth." }
            skipWhitespace()
            require(pos < src.length) { "Unexpected end of JSON." }
            return when (val ch = src[pos]) {
                '{' -> readObject(depth + 1)
                '[' -> readArray(depth + 1)
                '"' -> readString()
                't' -> readLiteral("true", true)
                'f' -> readLiteral("false", false)
                'n' -> readLiteral("null", null)
                '-', in '0'..'9' -> readNumber()
                else -> throw IllegalArgumentException("Unexpected character '$ch' at $pos")
            }
        }

        private fun readObject(depth: Int): Map<String, Any?> {
            pos++ // '{'
            skipWhitespace()
            val map = linkedMapOf<String, Any?>()
            if (pos < src.length && src[pos] == '}') {
                pos++
                return map
            }
            while (true) {
                skipWhitespace()
                require(pos < src.length && src[pos] == '"') { "Expected string key at $pos" }
                val key = readString()
                require(!map.containsKey(key)) { "Duplicate key: $key" }
                skipWhitespace()
                require(pos < src.length && src[pos] == ':') { "Expected ':' at $pos" }
                pos++
                map[key] = readValue(depth)
                skipWhitespace()
                require(pos < src.length) { "Unterminated JSON object." }
                when (src[pos]) {
                    ',' -> pos++
                    '}' -> {
                        pos++
                        return map
                    }
                    else -> throw IllegalArgumentException("Expected ',' or '}' at $pos")
                }
            }
        }

        private fun readArray(depth: Int): List<Any?> {
            pos++ // '['
            skipWhitespace()
            val list = mutableListOf<Any?>()
            if (pos < src.length && src[pos] == ']') {
                pos++
                return list
            }
            while (true) {
                list.add(readValue(depth))
                skipWhitespace()
                require(pos < src.length) { "Unterminated JSON array." }
                when (src[pos]) {
                    ',' -> pos++
                    ']' -> {
                        pos++
                        return list
                    }
                    else -> throw IllegalArgumentException("Expected ',' or ']' at $pos")
                }
            }
        }

        private fun readString(): String {
            pos++ // '"'
            val sb = StringBuilder()
            while (pos < src.length) {
                val ch = src[pos++]
                when {
                    ch == '"' -> return sb.toString()
                    ch.code < 0x20 -> throw IllegalArgumentException("Unescaped control character in string.")
                    ch == '\\' -> {
                        require(pos < src.length) { "Unterminated escape sequence." }
                        when (val esc = src[pos++]) {
                            '"' -> sb.append('"')
                            '\\' -> sb.append('\\')
                            '/' -> sb.append('/')
                            'b' -> sb.append('\b')
                            'f' -> sb.append('\u000C')
                            'n' -> sb.append('\n')
                            'r' -> sb.append('\r')
                            't' -> sb.append('\t')
                            'u' -> {
                                require(pos + 4 <= src.length) { "Invalid unicode escape." }
                                val hex = src.substring(pos, pos + 4)
                                val code = hex.toIntOrNull(16)
                                    ?: throw IllegalArgumentException("Invalid hex escape: $hex")
                                pos += 4
                                sb.append(code.toChar())
                            }
                            else -> throw IllegalArgumentException("Invalid escape '\\$esc'.")
                        }
                    }
                    else -> sb.append(ch)
                }
            }
            throw IllegalArgumentException("Unterminated string.")
        }

        private fun <T> readLiteral(literal: String, value: T): T {
            require(src.startsWith(literal, pos)) { "Expected '$literal' at $pos" }
            pos += literal.length
            return value
        }

        private fun readNumber(): Number {
            val start = pos
            if (src[pos] == '-') pos++
            require(pos < src.length) { "Invalid number at $start" }
            if (src[pos] == '0') {
                pos++
                require(pos >= src.length || src[pos] !in '0'..'9') { "Leading zero in number at $start" }
            } else {
                require(src[pos] in '1'..'9') { "Invalid digit at $pos" }
                while (pos < src.length && src[pos] in '0'..'9') pos++
            }
            var isFloat = false
            if (pos < src.length && src[pos] == '.') {
                isFloat = true
                pos++
                require(pos < src.length && src[pos] in '0'..'9') { "Expected fraction digit at $pos" }
                while (pos < src.length && src[pos] in '0'..'9') pos++
            }
            if (pos < src.length && (src[pos] == 'e' || src[pos] == 'E')) {
                isFloat = true
                pos++
                if (pos < src.length && (src[pos] == '+' || src[pos] == '-')) pos++
                require(pos < src.length && src[pos] in '0'..'9') { "Expected exponent digit at $pos" }
                while (pos < src.length && src[pos] in '0'..'9') pos++
            }
            val raw = src.substring(start, pos)
            return if (isFloat) {
                raw.toDouble()
            } else {
                raw.toLongOrNull() ?: throw IllegalArgumentException("Number out of Long range: $raw")
            }
        }
    }
}
