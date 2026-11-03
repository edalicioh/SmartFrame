package com.smartframe.player

/** Estado de uma única navegação; interceptações podem terminar em threads diferentes. */
internal class DashboardLoad {
    private val required = setOf(
        "/player-dashboard/css/base.css", "/player-dashboard/css/layout.css",
        "/player-dashboard/css/widgets.css", "/player-dashboard/css/themes.css",
        "/player-dashboard/js/config.js", "/player-dashboard/js/carousel.js",
        "/player-dashboard/js/clock.js", "/player-dashboard/js/calendar.js",
        "/player-dashboard/js/weather.js", "/player-dashboard/js/currencies.js",
        "/player-dashboard/js/app.js"
    )
    private var pending = 0
    private var mainOk = false
    private var finished = false
    private var failed = false
    private val loaded = mutableSetOf<String>()

    enum class State { LOADING, FAILED, SUCCEEDED }

    @Synchronized fun begin() { pending++ }

    @Synchronized fun complete(path: String, main: Boolean, success: Boolean) {
        pending--
        if (!success) failed = true
        else if (main) mainOk = true else loaded.add(path)
    }

    @Synchronized fun finish() { finished = true }

    @Synchronized fun timeout(): Boolean {
        if (state() != State.LOADING) return false
        failed = true
        return true
    }

    @Synchronized fun state(): State = when {
        failed -> State.FAILED
        !finished || pending != 0 -> State.LOADING
        mainOk && loaded.containsAll(required) -> State.SUCCEEDED
        else -> State.FAILED
    }

    companion object {
        fun critical(path: String): Boolean = path.startsWith("/player-dashboard/") &&
            (path.endsWith(".js", ignoreCase = true) || path.endsWith(".css", ignoreCase = true))
    }
}
