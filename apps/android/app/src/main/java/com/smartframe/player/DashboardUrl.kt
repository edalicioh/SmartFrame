package com.smartframe.player

import java.net.URI

/** Comparação estrita da origem e do caminho, sem aceitar credenciais, consulta ou fragmento. */
internal object DashboardUrl {
    fun sameOrigin(server: String, address: String): Boolean = try {
        val origin = URI(server).parseServerAuthority()
        val url = URI(address).parseServerAuthority()
        fun port(uri: URI): Int = if (uri.port != -1) uri.port else when (uri.scheme?.lowercase()) {
            "https" -> 443
            "http" -> 80
            else -> -1
        }
        origin.scheme != null && url.scheme != null && origin.host != null && url.host != null &&
            origin.scheme.equals(url.scheme, ignoreCase = true) && port(origin) != -1 && port(origin) == port(url) &&
            origin.host.equals(url.host, ignoreCase = true) && url.rawUserInfo == null
    } catch (_: Exception) { false }

    fun matches(server: String, address: String): Boolean = try {
        val url = URI(address).parseServerAuthority()
        sameOrigin(server, address) && url.rawQuery == null && url.rawFragment == null &&
            url.rawPath == "/player-dashboard/index.html"
    } catch (_: Exception) { false }
}
