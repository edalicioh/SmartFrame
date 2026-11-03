package com.smartframe.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DashboardRetryTest {
    @Test fun boundedBackoffAndResetOnlyAfterSuccess() {
        val retry = DashboardRetry()
        assertNull(retry.nextDelay())
        retry.failure()
        for (delay in listOf(2_000L, 4_000L, 8_000L, 16_000L, 32_000L, 60_000L)) {
            assertEquals(delay, retry.nextDelay())
            // Repeated scheduling or a pause must not consume an attempt.
            assertEquals(delay, retry.nextDelay())
            retry.attempted()
            retry.failure()
        }
        repeat(10) {
            assertEquals(60_000L, retry.nextDelay())
            retry.attempted()
            retry.failure()
        }
        retry.success()
        assertNull(retry.nextDelay())
        retry.failure()
        assertEquals(2_000L, retry.nextDelay())
    }

    @Test fun resumeDoesNotRetryLoadingOrSuccessfulNavigation() {
        val retry = DashboardRetry()
        retry.failure()
        retry.attempted()
        assertFalse(retry.canRetry(DashboardLoad.State.LOADING))
        assertFalse(retry.canRetry(DashboardLoad.State.SUCCEEDED))
        assertFalse(retry.canRetry(null))
        assertTrue(retry.canRetry(DashboardLoad.State.FAILED))
        assertEquals(4_000L, retry.nextDelay())
        retry.success()
        assertFalse(retry.canRetry(DashboardLoad.State.FAILED))
    }
}
