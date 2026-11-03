package com.smartframe.player

import java.util.concurrent.Callable
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.SynchronousQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

/** Isola I/O que pode ignorar interrupção, inclusive durante a leitura dos cabeçalhos. */
internal object DownloadDeadline {
    private val workers = ThreadPoolExecutor(0, 16, 30, TimeUnit.SECONDS, SynchronousQueue(), { task ->
        Thread(task, "dashboard-download").apply { isDaemon = true }
    })
    // Disconnect can block in platform networking code. Never run cancellation cleanup on
    // the waiting/caller thread; both worker count and queued cleanup are deliberately bounded.
    private val cleanup = ThreadPoolExecutor(0, 2, 30, TimeUnit.SECONDS, ArrayBlockingQueue(32), { task ->
        Thread(task, "dashboard-download-cleanup").apply { isDaemon = true }
    })

    /** onCancel is invoked asynchronously after a timeout; it must be safe to run later. */
    fun <T> run(timeoutMillis: Long, onCancel: () -> Unit = {}, block: () -> T): T {
        val future = workers.submit(Callable { block() })
        try {
            return future.get(timeoutMillis, TimeUnit.MILLISECONDS)
        } finally {
            if (!future.isDone) {
                future.cancel(true)
                try { cleanup.execute(onCancel) } catch (_: RejectedExecutionException) {
                    // Cleanup is best-effort if its bounded queue is saturated; the worker
                    // interruption above still happens synchronously with the deadline.
                }
            }
        }
    }
}

/** Data requests must finish before the corresponding JavaScript watchdog expires. */
internal fun onlineDownloadTimeout(path: String): Long = when {
    path == "/api/player/config" -> 9_000L
    path.startsWith("/api/player/online-media/") -> 7_500L
    else -> 30_000L
}
