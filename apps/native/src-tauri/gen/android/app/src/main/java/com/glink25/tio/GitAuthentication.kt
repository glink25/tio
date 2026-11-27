package com.glink25.tio

import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.activity.result.contract.ActivityResultContracts
import androidx.browser.auth.AuthTabIntent
import androidx.browser.customtabs.CustomTabsClient
import androidx.browser.customtabs.CustomTabsIntent
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject

internal class GitAuthentication(private val activity: MainActivity) {
    private class Attempt(
        val invoke: Invoke,
        val owner: String,
        val redirect: String,
        val state: String,
        val authTab: Boolean,
    )

    private var pending: Attempt? = null
    private var authTabAttempt: Attempt? = null
    private var customTabAttempt: Attempt? = null
    private val handler = Handler(Looper.getMainLooper())
    private val expire = Runnable { pending?.let { finish(it, "failed") } }

    private val authTab = AuthTabIntent.registerActivityResultLauncher(activity) { result ->
        val attempt = authTabAttempt
        authTabAttempt = null
        if (attempt != null) {
            when (result.resultCode) {
                AuthTabIntent.RESULT_OK -> {
                    val callback = result.resultUri
                    if (matches(attempt, callback)) finish(attempt, "completed", callback)
                    else finish(attempt, "failed")
                }
                AuthTabIntent.RESULT_CANCELED -> finish(attempt, "cancelled")
                else -> finish(attempt, "failed")
            }
        }
    }

    private val customTab = activity.registerForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) {
        val attempt = customTabAttempt
        customTabAttempt = null
        // A callback intent can arrive as the tab is returning its activity result.
        if (attempt != null) handler.post { finish(attempt, "cancelled") }
    }

    fun start(invoke: Invoke) {
        val args = invoke.getArgs()
        if (pending != null || authTabAttempt != null || customTabAttempt != null) {
            invoke.reject("busy")
            return
        }
        val browser = CustomTabsClient.getPackageName(activity, null)
        if (browser == null) {
            invoke.reject("unavailable")
            return
        }
        val supported = CustomTabsClient.isAuthTabSupported(activity, browser)
        val attempt = Attempt(
            invoke,
            args.getString("owner"),
            args.getString("redirect"),
            args.getString("state"),
            supported,
        )
        val url = Uri.parse(args.getString("url"))
        pending = attempt
        handler.postDelayed(expire, 35 * 60 * 1000L)
        try {
            if (supported) {
                authTabAttempt = attempt
                val tab = AuthTabIntent.Builder().build()
                tab.intent.setPackage(browser)
                tab.launch(authTab, url, "tio")
            } else {
                customTabAttempt = attempt
                val intent = CustomTabsIntent.Builder().build().intent
                intent.setPackage(browser)
                intent.data = url
                customTab.launch(intent)
            }
        } catch (_: RuntimeException) {
            authTabAttempt = null
            customTabAttempt = null
            finish(attempt, "failed")
        }
    }

    private fun matches(attempt: Attempt, callback: Uri?): Boolean =
        callback != null && callback.isHierarchical &&
            callback.fragment == null &&
            callback.buildUpon().clearQuery().build().toString() == attempt.redirect &&
            callback.getQueryParameters("state") == listOf(attempt.state)

    fun onCallback(callback: Uri?): Boolean {
        val attempt = pending ?: return false
        if (attempt.authTab || !matches(attempt, callback)) return false
        finish(attempt, "completed", callback)
        return true
    }

    fun cancel(owner: String) {
        pending?.takeIf { it.owner == owner }?.let { finish(it, "cancelled") }
    }

    fun dispose() {
        pending?.let { finish(it, "cancelled") }
    }

    private fun finish(attempt: Attempt, status: String, callback: Uri? = null) {
        if (pending !== attempt) return
        pending = null
        handler.removeCallbacks(expire)
        attempt.invoke.resolve(JSObject().apply {
            put("status", status)
            if (callback != null) put("callback", callback.toString())
        })
    }
}
