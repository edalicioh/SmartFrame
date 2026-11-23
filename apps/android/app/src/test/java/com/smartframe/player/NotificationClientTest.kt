package com.smartframe.player

import org.junit.Assert.assertEquals
import org.junit.Assert.fail
import org.junit.Test

class NotificationClientTest {
    @Test fun parsesOnlyBoundedNotificationIds() {
        assertEquals(
            "notice_1",
            NotificationClient.parse("""{"notificationId":"notice_1"}"""),
        )
        listOf(
            """{"notificationId":"bad/id"}""",
            """{"notificationId":"valid","token":"secret"}""",
            """{"notificationId":"valid","notificationId":"other"}""",
            """{"notificationId":"valid\n"}""",
            """{"notificationId":""}""",
        ).forEach { input ->
            try {
                NotificationClient.parse(input)
                fail("invalid notification message accepted")
            } catch (_: IllegalArgumentException) {
                // Expected: reject malformed IDs and extra properties.
            }
        }
    }
}
