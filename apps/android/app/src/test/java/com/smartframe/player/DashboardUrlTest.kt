package com.smartframe.player

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DashboardUrlTest {
    @Test fun canonicalHostSchemeAndDefaultPortAreAccepted() {
        assertTrue(DashboardUrl.matches("https://FRAME.example:443", "https://frame.example/player-dashboard/index.html"))
        assertTrue(DashboardUrl.matches("https://frame.example", "HTTPS://FRAME.EXAMPLE:443/player-dashboard/index.html"))
        assertTrue(DashboardUrl.matches("http://localhost:80", "http://LOCALHOST/player-dashboard/index.html"))
        assertTrue(DashboardUrl.matches("https://frame.example:8443", "https://FRAME.example:8443/player-dashboard/index.html"))
    }

    @Test fun wrongOriginAndAmbiguousUrlsAreRejected() {
        val server = "https://frame.example"
        for (address in listOf(
            "http://frame.example/player-dashboard/index.html", "https://frame.example:444/player-dashboard/index.html",
            "https://frame.example.evil/player-dashboard/index.html", "https://user@frame.example/player-dashboard/index.html",
            "https://frame.example/player-dashboard/", "https://frame.example/player-dashboard/./index.html",
            "https://frame.example/player-dashboard/%69ndex.html", "https://frame.example/player-dashboard/index.html?x=1",
            "https://frame.example/player-dashboard/index.html#fragment", "https://frame.example:bad/player-dashboard/index.html"
        )) assertFalse(address, DashboardUrl.matches(server, address))
    }
}
