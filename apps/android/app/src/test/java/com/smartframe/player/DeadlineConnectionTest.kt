package com.smartframe.player

import org.junit.Assert.*
import org.junit.Test
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.CountDownLatch
import java.util.concurrent.ExecutionException
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference

class DeadlineConnectionTest {
    private class Connection(private val cleanup: () -> Unit) : HttpURLConnection(URL("https://example.test")) {
        override fun connect() {}
        override fun usingProxy() = false
        override fun disconnect() = cleanup()
    }

    private fun awaitUninterruptibly(latch: CountDownLatch) {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
        while (latch.count > 0) {
            val remaining = deadline - System.nanoTime()
            if (remaining <= 0) return
            try { if (latch.await(remaining, TimeUnit.NANOSECONDS)) return } catch (_: InterruptedException) { }
        }
    }

    @Test fun successAndFailureCloseTheConnectionInTheIoWorker() {
        for (fail in listOf(false, true)) {
            val calls = AtomicInteger()
            val cleanupThread = AtomicReference<Thread?>()
            val connection = Connection { calls.incrementAndGet(); cleanupThread.set(Thread.currentThread()) }
            try {
                assertEquals("ok", withConnectionDeadline(connection) {
                    if (fail) throw IllegalStateException("response failure")
                    "ok"
                })
                assertFalse(fail)
            } catch (error: ExecutionException) {
                assertTrue(fail)
                assertTrue(error.cause is IllegalStateException)
            }
            assertEquals(1, calls.get())
            assertNotSame(Thread.currentThread(), cleanupThread.get())
        }
    }

    @Test fun blockingNormalDisconnectDoesNotExtendCallerDeadline() {
        val started = CountDownLatch(1)
        val release = CountDownLatch(1)
        val finished = CountDownLatch(1)
        val cleanupThread = AtomicReference<Thread?>()
        val connection = Connection {
            cleanupThread.set(Thread.currentThread())
            started.countDown()
            awaitUninterruptibly(release)
            finished.countDown()
        }
        val start = System.nanoTime()
        try {
            try {
                withConnectionDeadline(connection, 150) { "ok" }
                fail("Blocking disconnect must expire")
            } catch (_: TimeoutException) { }
            assertTrue(TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start) < 1000)
            assertTrue(started.await(1, TimeUnit.SECONDS))
            assertNotSame(Thread.currentThread(), cleanupThread.get())
        } finally {
            release.countDown()
            assertTrue(finished.await(2, TimeUnit.SECONDS))
        }
    }

    @Test fun blockingTimeoutDisconnectDoesNotExtendCallerDeadline() {
        val reading = CountDownLatch(1)
        val cleanupStarted = CountDownLatch(1)
        val releaseRead = CountDownLatch(1)
        val releaseCleanup = CountDownLatch(1)
        val finished = CountDownLatch(2)
        val calls = AtomicInteger()
        val connection = Connection {
            calls.incrementAndGet()
            cleanupStarted.countDown()
            awaitUninterruptibly(releaseCleanup)
            finished.countDown()
        }
        val start = System.nanoTime()
        try {
            try {
                withConnectionDeadline(connection, 150) {
                    reading.countDown()
                    awaitUninterruptibly(releaseRead)
                    finished.countDown()
                }
                fail("Blocked read must expire")
            } catch (_: TimeoutException) { }
            assertTrue(TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start) < 1000)
            assertTrue(reading.await(1, TimeUnit.SECONDS))
            assertTrue(cleanupStarted.await(1, TimeUnit.SECONDS))
            assertEquals("next request", DownloadDeadline.run(1000) { "next request" })
        } finally {
            releaseRead.countDown()
            releaseCleanup.countDown()
            assertTrue(finished.await(2, TimeUnit.SECONDS))
        }
        assertEquals(1, calls.get())
    }
}
