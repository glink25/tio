package com.glink25.tio

import android.os.Bundle
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  // Intercept only while Tio has a page or overlay to close. At the root,
  // Android owns Back, including its predictive back-to-home animation.
  override val handleBackNavigation: Boolean = false
  private var webBack: OnBackPressedCallback? = null
  private var historyRevision = 0

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    webBack?.remove()
    val callback = object : OnBackPressedCallback(webView.canGoBack()) {
      override fun handleOnBackPressed() {
        // WebView's native list omits same-URL pushState entries. HTML history
        // still contains them, so use it for both overlay and page traversal.
        webView.evaluateJavascript("history.back()", null)
      }
    }
    webBack = callback
    onBackPressedDispatcher.addCallback(this, callback)
  }

  override fun onWebViewHistoryChanged(webView: WebView) {
    super.onWebViewHistoryChanged(webView)
    val revision = ++historyRevision
    webView.evaluateJavascript("Boolean(history.state && history.state.tioOverlay)") { overlay ->
      if (revision == historyRevision)
        webBack?.isEnabled = overlay == "true" || webView.canGoBack()
    }
  }

  override fun onStop() {
    super.onStop()
    SyncWorker.request(applicationContext)
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    SyncWorker.schedule(applicationContext)
  }
}
