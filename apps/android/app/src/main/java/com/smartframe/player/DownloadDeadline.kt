package com.smartframe.player

import java.util.concurrent.Callable
import java.util.concurrent.SynchronousQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

/** Isola I/O que pode ignorar interrupção, inclusive durante a leitura dos cabeçalhos. */
internal object DownloadDeadline {
    private val workers = ThreadPoolExecutor(0, 16, 30, TimeUnit.SECONDS, SynchronousQueue(), { task ->
        Thread(task, "dashboard-download").apply { isDaemon = true }
    })

    fun <T> run(timeoutMillis: Long, onCancel: () -> Unit = {}, block: () -> T): T {
        val future = workers.submit(Callable { block() })
        try {
            return future.get(timeoutMillis, TimeUnit.MILLISECONDS)
        } finally {
            if (!future.isDone) {
                future.cancel(true)
                onCancel()
            }
        }
    }
}

/** Data requests must finish before the corresponding JavaScript watchdog expires. */
internal fun onlineDownloadTimeout(path: String): Long = when {
    path == "/api/player/config" -> 9_000L
    path.startsWith("/api/player/online-photos/") -> 7_500L
    else -> 30_000L
}
