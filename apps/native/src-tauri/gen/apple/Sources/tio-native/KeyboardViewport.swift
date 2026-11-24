import UIKit
import WebKit

/// Reports the docked keyboard relative to the WebView without resizing it.
@MainActor
final class KeyboardViewport: UIView, WKScriptMessageHandler {
    private static let messageName = "tioKeyboardViewport"
    private weak var webView: WKWebView?
    private var lastGeometry: (height: Int, visibleHeight: Int)?

    static func attach(to webView: WKWebView) {
        guard !webView.subviews.contains(where: { $0 is KeyboardViewport }) else { return }
        let observer = KeyboardViewport()
        observer.webView = webView
        observer.translatesAutoresizingMaskIntoConstraints = false
        observer.isUserInteractionEnabled = false
        observer.isOpaque = false
        observer.accessibilityElementsHidden = true
        if #available(iOS 17.0, *) {
            webView.keyboardLayoutGuide.usesBottomSafeArea = false
        }
        webView.addSubview(observer)
        NSLayoutConstraint.activate([
            observer.leadingAnchor.constraint(equalTo: webView.leadingAnchor),
            observer.trailingAnchor.constraint(equalTo: webView.trailingAnchor),
            observer.topAnchor.constraint(equalTo: webView.topAnchor),
            observer.bottomAnchor.constraint(equalTo: webView.keyboardLayoutGuide.topAnchor)
        ])

        let content = webView.configuration.userContentController
        content.add(observer, name: messageName)
        content.addUserScript(WKUserScript(
            source: "window.webkit.messageHandlers.tioKeyboardViewport.postMessage(null)",
            injectionTime: .atDocumentEnd,
            forMainFrameOnly: true
        ))
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        publish()
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, message.webView === webView else { return }
        publish(force: true)
    }

    private func publish(force: Bool = false) {
        guard let webView, webView.window != nil, webView.bounds.height > 0, bounds.height > 0 else { return }
        let height = Int(webView.bounds.height.rounded())
        let unobscured = max(0, min(height, Int(bounds.height.rounded(.down))))
        // iOS 16 places the inactive guide at the bottom safe area.
        let visibleHeight = height - unobscured <= Int(webView.safeAreaInsets.bottom.rounded(.up)) + 1
            ? height : unobscured
        if !force, lastGeometry?.height == height, lastGeometry?.visibleHeight == visibleHeight { return }
        lastGeometry = (height, visibleHeight)
        webView.evaluateJavaScript("""
            (() => {
              const root = document.documentElement;
              if (!root) return;
              window.__tioKeyboardViewport = { height: \(height), visibleHeight: \(visibleHeight) };
              root.style.setProperty('--tio-native-screen-height', '\(height)px');
              root.toggleAttribute('data-tio-keyboard-open', \(visibleHeight < height));
              window.dispatchEvent(new Event('tio:keyboard-viewport'));
            })()
            """, completionHandler: nil)
    }
}
