package com.smartframe.player

import org.junit.Assert.*
import org.junit.Test

class OnlineOnlyFlowTest {
    @Test fun configQueryIsStrictAndAllowsEncodedRevisionColon() {
        assertTrue(OnlinePlayer.ConfigQuery.valid("deviceId=device_1&appliedRevision=online%3Av12", "device_1"))
        assertTrue(OnlinePlayer.ConfigQuery.valid("appliedRevision=online%3av12", "device_1"))
        assertFalse(OnlinePlayer.ConfigQuery.valid("deviceId=device_1&deviceId=other", "device_1"))
        assertFalse(OnlinePlayer.ConfigQuery.valid("deviceId=device_1&unknown=x", "device_1"))
        assertFalse(OnlinePlayer.ConfigQuery.valid("appliedRevision=online%253Av12", "device_1"))
        assertFalse(OnlinePlayer.ConfigQuery.valid("x".repeat(181), "device_1"))
    }

    @Test fun dashboardRetryWaitsForFullCriticalSetAndOnlyStableSuccessResets() {
        val load = DashboardLoad()
        load.begin(); load.complete("/player/device_1", true, true)
        load.finish()
        assertEquals(DashboardLoad.State.FAILED, load.state())
        assertTrue(DashboardLoad.critical("/player-dashboard/js/app.js"))
        assertFalse(DashboardLoad.critical("/api/player/online-media/photo"))
    }
}
