package com.smartframe.player

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

internal object NotificationClient {
    private val ID_REGEX = Regex("^[A-Za-z0-9_-]{1,128}$")

    fun parse(message: String): String {
        require(message.toByteArray(Charsets.UTF_8).size <= 512)
        // Keep parsing JVM-testable; this exact grammar rejects extra/duplicate
        // fields and the accepted identifier alphabet needs no JSON unescaping.
        val match = Regex("""^[ \t\r\n]*\{[ \t\r\n]*"notificationId"[ \t\r\n]*:[ \t\r\n]*"([A-Za-z0-9_-]{1,128})"[ \t\r\n]*\}[ \t\r\n]*$""")
            .matchEntire(message) ?: throw IllegalArgumentException("Invalid notification payload")
        val id = match.groupValues[1]
        require(id.matches(ID_REGEX))
        return id
    }

    fun dismiss(server: String, token: String, deviceId: String, notificationId: String) {
        require(notificationId.matches(ID_REGEX))
        val deadline = TaskWriteDeadline(timeoutMillis = 5_000L)
        val url = URL("$server/api/player/notifications/dismiss?deviceId=$deviceId")
        val connection = url.openConnection() as HttpURLConnection
        withConnectionDeadline(connection, deadline.remainingMillis()) {
            val remaining = deadline.remainingMillis().coerceAtMost(5_000L).toInt()
            connection.requestMethod = "POST"
            connection.connectTimeout = remaining
            connection.readTimeout = remaining
            connection.instanceFollowRedirects = false
            connection.doOutput = true
            connection.setRequestProperty("Authorization", "Bearer $token")
            connection.setRequestProperty("Content-Type", "application/json")
            connection.outputStream.use {
                it.write(JSONObject().put("notificationId", notificationId).toString().toByteArray(Charsets.UTF_8))
            }
            require(connection.responseCode in 200..299)
        }
    }
}
