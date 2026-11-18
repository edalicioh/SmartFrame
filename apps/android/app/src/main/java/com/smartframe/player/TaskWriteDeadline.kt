package com.smartframe.player

/** One monotonic budget covers both the executor queue and network I/O. */
internal class TaskWriteDeadline(
    private val nowMillis: () -> Long = { System.nanoTime() / 1_000_000 },
    timeoutMillis: Long = 20_000,
) {
    private val expiresAtMillis = nowMillis() + timeoutMillis

    fun remainingMillis(): Long {
        val remaining = expiresAtMillis - nowMillis()
        check(remaining > 0) { "Task write expired before completion." }
        return remaining
    }
}
