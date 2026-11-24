package com.glink25.tio

import android.app.Activity
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin

@TauriPlugin
class HostUiPlugin(private val activity: Activity) : Plugin(activity) {
    @Command
    fun startup(invoke: Invoke) {
        val ready = when (invoke.getArgs().optString("status")) {
            "ready" -> true
            "failed" -> false
            else -> {
                invoke.reject("invalid")
                return
            }
        }
        activity.runOnUiThread {
            (activity as MainActivity).finishStartup(ready)
            invoke.resolve()
        }
    }

    @Command
    fun setOverlayBack(invoke: Invoke) {
        val available = invoke.getArgs().optBoolean("available")
        activity.runOnUiThread {
            (activity as MainActivity).setOverlayBack(available)
            invoke.resolve()
        }
    }
}
