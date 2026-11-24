package com.glink25.tio

import android.animation.ObjectAnimator
import android.animation.ValueAnimator
import android.app.Activity
import android.content.res.Configuration
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.animation.AccelerateDecelerateInterpolator
import android.webkit.WebView
import android.widget.Button
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.view.doOnAttach

internal class StartupOverlay(private val activity: Activity) {
    private val handler = Handler(Looper.getMainLooper())
    private val timedOut = Runnable { showFailure() }
    private val reduceMotion: Boolean
        get() = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            !ValueAnimator.areAnimatorsEnabled()
        } else {
            Settings.Global.getFloat(
                activity.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f
            ) == 0f
        }
    private var webView: WebView? = null
    private var webAccessibility: Int = View.IMPORTANT_FOR_ACCESSIBILITY_AUTO
    private var overlay: FrameLayout? = null
    private var dot: ImageView? = null
    private var failureActions: LinearLayout? = null
    private var bounce: ObjectAnimator? = null
    private var revision = 0L
    private var ready = false

    fun attach(view: WebView) {
        if (ready || webView === view) return
        webView?.importantForAccessibility = webAccessibility
        webView = view
        webAccessibility = view.importantForAccessibility
        view.importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
        view.doOnAttach {
            // Wry installs the WebView as the Activity's content view just after onWebViewCreate.
            view.post { if (webView === view && !ready) show() }
        }
    }

    fun show() {
        val content = activity.findViewById<ViewGroup>(android.R.id.content) ?: return
        val existing = overlay
        if (existing?.parent === content) return
        if (existing != null) {
            (existing.parent as? ViewGroup)?.removeView(existing)
            content.addView(existing, FrameLayout.LayoutParams(-1, -1))
            return
        }

        val surface = FrameLayout(activity).apply {
            setBackgroundColor(activity.getColor(R.color.tio_startup_background))
            isClickable = true
            isFocusable = true
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_YES
            contentDescription = context.getString(R.string.tio_startup_loading)
        }
        val size = activity.dp(72f).toInt()
        fun addMarkPart(drawable: Int): ImageView {
            val image = ImageView(activity).apply {
                setImageResource(drawable)
                importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
            }
            surface.addView(image, FrameLayout.LayoutParams(size, size, Gravity.CENTER))
            return image
        }
        addMarkPart(R.drawable.tio_startup_symbol)
        dot = addMarkPart(R.drawable.tio_startup_dot)
        val failure = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            translationY = activity.dp(86f)
            visibility = View.GONE
            addView(TextView(context).apply {
                setText(R.string.tio_startup_failed)
                setTextColor(activity.getColor(R.color.tio_startup_ink))
            })
            addView(Button(context).apply {
                setText(R.string.tio_startup_retry)
                setOnClickListener { retry() }
            })
        }
        surface.addView(failure, FrameLayout.LayoutParams(-2, -2, Gravity.CENTER))
        failureActions = failure
        overlay = surface
        content.addView(surface, FrameLayout.LayoutParams(-1, -1))
        animateDot()
        armTimeout()
    }

    fun finish(success: Boolean, dark: Boolean?) {
        val surface = overlay ?: return
        if (ready) return
        if (!success) {
            showFailure()
            return
        }
        val view = webView ?: return
        val request = ++revision
        view.postVisualStateCallback(request, object : WebView.VisualStateCallback() {
            override fun onComplete(requestId: Long) {
                if (requestId != revision || overlay !== surface) return
                ready = true
                handler.removeCallbacks(timedOut)
                stopDot()
                val nightMode = activity.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK
                val changesAppearance = dark != null && dark != (nightMode == Configuration.UI_MODE_NIGHT_YES)
                if (reduceMotion || changesAppearance) {
                    remove(surface)
                } else {
                    surface.animate().alpha(0f).setDuration(160).withEndAction { remove(surface) }
                }
            }
        })
    }

    fun dispose() {
        revision++
        handler.removeCallbacks(timedOut)
        stopDot()
        overlay?.let(::remove)
        webView = null
    }

    private fun armTimeout() {
        handler.removeCallbacks(timedOut)
        handler.postDelayed(timedOut, 15_000)
    }

    private fun retry() {
        revision++
        overlay?.contentDescription = activity.getString(R.string.tio_startup_loading)
        failureActions?.visibility = View.GONE
        animateDot()
        armTimeout()
        webView?.reload() ?: activity.recreate()
    }

    private fun animateDot() {
        stopDot()
        if (reduceMotion) return
        val dot = dot ?: return
        bounce = ObjectAnimator.ofFloat(dot, View.TRANSLATION_Y, 0f, -activity.dp(8f)).apply {
            duration = 800
            repeatMode = ValueAnimator.REVERSE
            repeatCount = ValueAnimator.INFINITE
            interpolator = AccelerateDecelerateInterpolator()
            addUpdateListener { dot.alpha = 1f - animatedFraction * 0.55f }
            start()
        }
    }

    private fun stopDot() {
        bounce?.cancel()
        bounce = null
        dot?.apply {
            translationY = 0f
            alpha = 1f
        }
    }

    private fun showFailure() {
        if (ready) return
        val surface = overlay ?: return
        handler.removeCallbacks(timedOut)
        stopDot()
        surface.contentDescription = null
        failureActions?.visibility = View.VISIBLE
    }

    private fun remove(surface: FrameLayout) {
        (surface.parent as? ViewGroup)?.removeView(surface)
        if (overlay === surface) {
            overlay = null
            dot = null
            failureActions = null
            webView?.importantForAccessibility = webAccessibility
        }
    }
}

private fun Context.dp(value: Float) = value * resources.displayMetrics.density
