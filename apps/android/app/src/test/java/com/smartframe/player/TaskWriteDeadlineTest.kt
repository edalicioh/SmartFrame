package com.smartframe.player

import org.junit.Assert.*
import org.junit.Test

class TaskWriteDeadlineTest {
    @Test fun queueTimeReducesTheNetworkBudget() {
        var now = 100L
        val deadline = TaskWriteDeadline(nowMillis = { now })
        now += 15_000
        assertEquals(5_000L, deadline.remainingMillis())
        now += 4_999
        assertEquals(1L, deadline.remainingMillis())
    }

    @Test fun aQueuedWriteCannotStartAtOrAfterItsDeadline() {
        var now = 0L
        val deadline = TaskWriteDeadline(nowMillis = { now })
        now = 20_000
        assertTrue(runCatching { deadline.remainingMillis() }.isFailure)
        now = 30_000
        assertTrue(runCatching { deadline.remainingMillis() }.isFailure)
    }
}
