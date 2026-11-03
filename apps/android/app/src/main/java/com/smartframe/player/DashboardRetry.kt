package com.smartframe.player

/** Política de tentativas do documento principal, usada somente na thread da UI. */
internal class DashboardRetry {
    private var failures = 0
    var failed = false
        private set

    fun failure() { failed = true }
    fun success() { failed = false; failures = 0 }
    fun nextDelay(): Long? = if (!failed) null else minOf(2_000L shl failures, 60_000L)
    fun canRetry(state: DashboardLoad.State?): Boolean = state == DashboardLoad.State.FAILED && nextDelay() != null
    fun attempted() { if (failed && failures < 5) failures++ }
}
