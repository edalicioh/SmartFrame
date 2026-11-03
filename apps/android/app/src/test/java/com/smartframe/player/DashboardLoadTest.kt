package com.smartframe.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.CountDownLatch
import kotlin.concurrent.thread

class DashboardLoadTest {
    private val assets = listOf("css/base.css", "css/layout.css", "css/widgets.css", "css/themes.css",
        "js/config.js", "js/carousel.js", "js/clock.js", "js/calendar.js", "js/weather.js",
        "js/currencies.js", "js/app.js").map { "/player-dashboard/$it" }

    private fun DashboardLoad.main() { begin(); complete("/player-dashboard/index.html", true, true) }
    private fun DashboardLoad.asset(path: String, ok: Boolean = true) { begin(); complete(path, false, ok) }

    @Test fun htmlAloneIsNotSuccessAndMissingAssetsFailOnFinish() {
        val load = DashboardLoad()
        load.main()
        assertEquals(DashboardLoad.State.LOADING, load.state())
        load.finish()
        assertEquals(DashboardLoad.State.FAILED, load.state())
    }

    @Test fun finishWaitsForPendingAndFailureCannotBeOverwritten() {
        val load = DashboardLoad()
        load.main()
        assets.forEach { load.begin() }
        load.finish()
        assertEquals(DashboardLoad.State.LOADING, load.state())
        assets.forEach { load.complete(it, false, !it.endsWith("config.js")) }
        assertEquals(DashboardLoad.State.FAILED, load.state())
        load.asset(assets.first())
        assertEquals(DashboardLoad.State.FAILED, load.state())
    }

    @Test fun parallelResponsesAndFinishedMustAllSucceed() {
        val load = DashboardLoad()
        load.main()
        assets.forEach { load.begin() }
        val start = CountDownLatch(1)
        val threads = assets.map { path -> thread { start.await(); load.complete(path, false, true) } }
        load.finish()
        start.countDown()
        threads.forEach { it.join() }
        assertEquals(DashboardLoad.State.SUCCEEDED, load.state())
        load.asset("/player-dashboard/js/later.js", false)
        assertEquals(DashboardLoad.State.FAILED, load.state())
    }

    @Test fun repeatedHtmlSuccessDoesNotResetRetryAfterAssetFailure() {
        val retry = DashboardRetry()
        for (delay in listOf(2_000L, 4_000L, 8_000L, 16_000L, 32_000L, 60_000L, 60_000L)) {
            val load = DashboardLoad()
            load.main()
            load.asset("/player-dashboard/js/config.js", false)
            load.finish()
            if (load.state() == DashboardLoad.State.FAILED) retry.failure()
            assertEquals(delay, retry.nextDelay())
            retry.attempted()
        }
        val recovered = DashboardLoad()
        recovered.main()
        assets.forEach { recovered.asset(it) }
        recovered.finish()
        assertEquals(DashboardLoad.State.SUCCEEDED, recovered.state())
        retry.success()
        retry.failure()
        assertEquals(2_000L, retry.nextDelay())
    }

    @Test fun onlyDashboardScriptsAndStylesAreCritical() {
        assertTrue(DashboardLoad.critical("/player-dashboard/js/config.js"))
        assertTrue(DashboardLoad.critical("/player-dashboard/css/base.css"))
        assertFalse(DashboardLoad.critical("/api/player/config"))
        assertFalse(DashboardLoad.critical("/api/player/online-photos/photo"))
        assertFalse(DashboardLoad.critical("/player-dashboard/assets/icons/weather.svg"))
    }

    @Test fun stalledLoadTimesOutWithoutLosingBackoffOrAcceptingLateSuccess() {
        val retry = DashboardRetry()
        retry.failure()
        retry.attempted()
        val load = DashboardLoad()
        load.begin()
        assertEquals(DashboardLoad.State.LOADING, load.state())
        // O backoff anterior existe, mas não deve provocar retry durante LOADING.
        assertEquals(4_000L, retry.nextDelay())
        assertTrue(load.timeout())
        load.complete("/player-dashboard/index.html", true, true)
        assets.forEach { load.asset(it) }
        load.finish()
        assertEquals(DashboardLoad.State.FAILED, load.state())
        assertFalse(load.timeout())
        assertEquals(4_000L, retry.nextDelay())
    }

    @Test fun watchdogDoesNotTurnFinishedSuccessIntoFailure() {
        val load = DashboardLoad()
        load.main()
        assets.forEach { load.asset(it) }
        load.finish()
        assertEquals(DashboardLoad.State.SUCCEEDED, load.state())
        assertFalse(load.timeout())
    }
}
