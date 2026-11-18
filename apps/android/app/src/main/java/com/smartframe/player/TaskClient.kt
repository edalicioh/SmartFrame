package com.smartframe.player

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

internal data class TaskToggle(val requestId: String, val revision: String, val taskId: String, val completed: Boolean)

/** Only task state can be written. Neither the URL nor the bearer comes from JavaScript. */
internal object TaskClient {
    fun parse(message: String): TaskToggle {
        require(message.length <= 2048)
        val json = JSONObject(message)
        require(json.keys().asSequence().toSet() == setOf("requestId", "revision", "taskId", "completed"))
        val requestId = json.get("requestId")
        val revision = json.get("revision")
        val taskId = json.get("taskId")
        val completed = json.get("completed")
        require(requestId is String && requestId.matches(Regex("task-[1-9][0-9]{0,8}")))
        require(revision is String && revision.matches(Regex("online:[A-Za-z0-9_-]{1,128}")))
        require(taskId is String && taskId.length in 1..128)
        require(completed is Boolean)
        return TaskToggle(requestId, revision, taskId, completed)
    }

    fun toggle(c: DeviceConnection, task: TaskToggle, deadline: TaskWriteDeadline = TaskWriteDeadline()) {
        deadline.remainingMillis() // Do not open a connection for an expired queued write.
        val server = PairingClient.normalizeServer(c.server, BuildConfig.DEBUG)
        val connection = URL("$server/api/player/tasks?deviceId=${c.deviceId}").openConnection() as HttpURLConnection
        withConnectionDeadline(connection, deadline.remainingMillis()) {
            val remaining = deadline.remainingMillis().coerceAtMost(10_000).toInt()
            connection.connectTimeout = remaining
            connection.readTimeout = remaining
            connection.instanceFollowRedirects = false
            connection.requestMethod = "POST"
            connection.doOutput = true
            connection.setRequestProperty("Authorization", "Bearer ${c.token}")
            connection.setRequestProperty("Content-Type", "application/json")
            deadline.remainingMillis()
            connection.outputStream.use {
                deadline.remainingMillis()
                it.write(JSONObject().put("revision", task.revision)
                    .put("taskId", task.taskId).put("completed", task.completed)
                    .toString().toByteArray(Charsets.UTF_8))
            }
            check(connection.responseCode == 200)
        }
    }
}
