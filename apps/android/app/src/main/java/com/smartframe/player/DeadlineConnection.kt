package com.smartframe.player

import java.net.HttpURLConnection
import java.util.concurrent.atomic.AtomicReference

/** Normal cleanup runs in the I/O worker; timeout cleanup must never block the caller. */
internal fun <T> withConnectionDeadline(
    connection: HttpURLConnection,
    timeoutMillis: Long = 20_000,
    block: (HttpURLConnection) -> T,
): T {
    val active = AtomicReference<HttpURLConnection?>(connection)
    return DownloadDeadline.run(timeoutMillis, onCancel = { active.getAndSet(null)?.disconnect() }) {
        try {
            block(connection)
        } finally {
            active.getAndSet(null)?.disconnect()
        }
    }
}
