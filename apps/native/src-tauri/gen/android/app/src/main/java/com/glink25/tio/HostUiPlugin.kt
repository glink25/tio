package com.glink25.tio

import android.app.Activity
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin

@TauriPlugin
class HostUiPlugin(private val activity: Activity) : Plugin(activity) {
    @Command
    fun authenticateGit(invoke: Invoke) {
        activity.runOnUiThread { (activity as MainActivity).gitAuthentication.start(invoke) }
    }

    @Command
    fun cancelGitAuthentication(invoke: Invoke) {
        val owner = invoke.getArgs().optString("owner")
        activity.runOnUiThread {
            (activity as MainActivity).gitAuthentication.cancel(owner)
            invoke.resolve()
        }
    }

    @Command
    fun startup(invoke: Invoke) {
        val args = invoke.getArgs()
        val ready = when (args.optString("status")) {
            "ready" -> true
            "failed" -> false
            else -> {
                invoke.reject("invalid")
                return
            }
        }
        val dark = if (args.isNull("dark")) null else args.optBoolean("dark")
        activity.runOnUiThread {
            (activity as MainActivity).finishStartup(ready, dark)
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
