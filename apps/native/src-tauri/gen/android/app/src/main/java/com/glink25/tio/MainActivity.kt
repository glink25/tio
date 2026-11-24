package com.glink25.tio

import android.os.Bundle
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  private val startup = StartupOverlay(this)

  // Intercept only while Tio has a modal to close. At the root,
  // Android owns Back, including its predictive back-to-home animation.
  override val handleBackNavigation: Boolean = false
  private var webBack: OnBackPressedCallback? = null

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    webView.setBackgroundColor(getColor(R.color.tio_startup_background))
    startup.attach(webView)
    webView.settings.setSupportZoom(false)
    webBack?.remove()
    val callback = object : OnBackPressedCallback(false) {
      override fun handleOnBackPressed() {
        webView.evaluateJavascript(
          "window.dispatchEvent(new Event('tio:request-overlay-back'))",
          null
        )
      }
    }
    webBack = callback
    onBackPressedDispatcher.addCallback(this, callback)
  }

  fun setOverlayBack(available: Boolean) {
    runOnUiThread {
      webBack?.isEnabled = available
    }
  }

  override fun onStop() {
    super.onStop()
    SyncWorker.request(applicationContext)
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    startup.show()
    SyncWorker.schedule(applicationContext)
  }

  override fun onDestroy() {
    startup.dispose()
    super.onDestroy()
  }

  fun finishStartup(ready: Boolean, dark: Boolean?) = startup.finish(ready, dark)
}
