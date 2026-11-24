import UIKit
import WebKit

@MainActor
private final class StartupOverlay: UIView {
    private static let startupTag = 0x54494F
    private static var startupBackground: UIColor {
        UIColor(named: "TioStartupBackground") ?? .systemBackground
    }
    private let dot = UIImageView(image: UIImage(named: "TioStartupDot")?.withRenderingMode(.alwaysTemplate))
    private let symbol = UIImageView(image: UIImage(named: "TioStartupSymbol")?.withRenderingMode(.alwaysTemplate))
    private let failureLabel = UILabel()
    private let retry = UIButton(configuration: .bordered())
    private weak var webView: WKWebView?
    private let scrollBackground: UIColor?
    private var timeout: DispatchWorkItem?
    private var ready = false

    static func attach(to webView: WKWebView) {
        guard webView.viewWithTag(startupTag) == nil else { return }
        let background = startupBackground
        webView.window?.backgroundColor = background
        webView.superview?.backgroundColor = background
        webView.backgroundColor = background
        let scrollView = webView.scrollView
        let previousScrollBackground = scrollView.backgroundColor
        scrollView.backgroundColor = background
        let overlay = StartupOverlay(webView: webView, scrollBackground: previousScrollBackground)
        overlay.tag = startupTag
        overlay.translatesAutoresizingMaskIntoConstraints = false
        webView.addSubview(overlay)
        NSLayoutConstraint.activate([
            overlay.leadingAnchor.constraint(equalTo: webView.leadingAnchor),
            overlay.trailingAnchor.constraint(equalTo: webView.trailingAnchor),
            overlay.topAnchor.constraint(equalTo: webView.topAnchor),
            overlay.bottomAnchor.constraint(equalTo: webView.bottomAnchor)
        ])
        overlay.start()
    }

    static func finish(in webView: WKWebView, ready: Bool, dark: Bool?) {
        guard let overlay = webView.viewWithTag(startupTag) as? StartupOverlay else { return }
        if ready { overlay.dismiss(dark: dark) }
        else { overlay.fail() }
    }

    private init(webView: WKWebView, scrollBackground: UIColor?) {
        self.webView = webView
        self.scrollBackground = scrollBackground
        super.init(frame: .zero)
        accessibilityViewIsModal = true
        backgroundColor = Self.startupBackground
        let ink = UIColor(named: "TioStartupInk") ?? .label
        for image in [symbol, dot] {
            image.contentMode = .scaleAspectFit
            image.tintColor = ink
            image.translatesAutoresizingMaskIntoConstraints = false
            addSubview(image)
            NSLayoutConstraint.activate([
                image.centerXAnchor.constraint(equalTo: centerXAnchor),
                image.centerYAnchor.constraint(equalTo: centerYAnchor),
                image.widthAnchor.constraint(equalToConstant: 72),
                image.heightAnchor.constraint(equalToConstant: 72)
            ])
        }
        symbol.isAccessibilityElement = true
        failureLabel.translatesAutoresizingMaskIntoConstraints = false
        failureLabel.text = NSLocalizedString("startup.failed", tableName: "Startup", comment: "")
        failureLabel.textColor = ink
        failureLabel.font = .preferredFont(forTextStyle: .body)
        failureLabel.adjustsFontForContentSizeCategory = true
        failureLabel.numberOfLines = 0
        failureLabel.textAlignment = .center
        failureLabel.accessibilityTraits.insert(.header)
        addSubview(failureLabel)
        retry.translatesAutoresizingMaskIntoConstraints = false
        retry.setTitle(NSLocalizedString("startup.retry", tableName: "Startup", comment: ""), for: .normal)
        retry.tintColor = ink
        retry.addTarget(self, action: #selector(reload), for: .touchUpInside)
        addSubview(retry)
        NSLayoutConstraint.activate([
            failureLabel.centerXAnchor.constraint(equalTo: centerXAnchor),
            failureLabel.leadingAnchor.constraint(greaterThanOrEqualTo: leadingAnchor, constant: 20),
            failureLabel.topAnchor.constraint(equalTo: symbol.bottomAnchor, constant: 14),
            retry.centerXAnchor.constraint(equalTo: centerXAnchor),
            retry.topAnchor.constraint(equalTo: failureLabel.bottomAnchor, constant: 8),
            retry.heightAnchor.constraint(greaterThanOrEqualToConstant: 44)
        ])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { nil }

    private func start() {
        failureLabel.isHidden = true
        retry.isHidden = true
        symbol.isAccessibilityElement = true
        symbol.accessibilityLabel = NSLocalizedString("startup.loading", tableName: "Startup", comment: "")
        stopDot()
        if !UIAccessibility.isReduceMotionEnabled {
            UIView.animate(withDuration: 0.8, delay: 0, options: [.autoreverse, .repeat, .curveEaseInOut]) {
                self.dot.transform = CGAffineTransform(translationX: 0, y: -8)
                self.dot.alpha = 0.45
            }
        }
        timeout?.cancel()
        let deadline = DispatchWorkItem { [weak self] in self?.fail() }
        timeout = deadline
        DispatchQueue.main.asyncAfter(deadline: .now() + 15, execute: deadline)
    }

    @objc private func reload() {
        start()
        webView?.reload()
    }

    private func stopDot() {
        dot.layer.removeAllAnimations()
        dot.transform = .identity
        dot.alpha = 1
    }

    private func fail() {
        guard !ready else { return }
        timeout?.cancel()
        stopDot()
        symbol.isAccessibilityElement = false
        failureLabel.isHidden = false
        retry.isHidden = false
        UIAccessibility.post(notification: .layoutChanged, argument: failureLabel)
    }

    private func dismiss(dark: Bool?) {
        guard !ready else { return }
        ready = true
        timeout?.cancel()
        stopDot()
        webView?.scrollView.backgroundColor = scrollBackground
        let changesAppearance = dark.map { $0 != (traitCollection.userInterfaceStyle == .dark) } ?? false
        if UIAccessibility.isReduceMotionEnabled || changesAppearance { removeFromSuperview() }
        else {
            UIView.animate(withDuration: 0.16, animations: { self.alpha = 0 }) { _ in
                self.removeFromSuperview()
            }
        }
    }
}

@MainActor
@_cdecl("tio_show_startup")
func tioShowStartup(_ pointer: UnsafeRawPointer) {
    let webView = Unmanaged<WKWebView>.fromOpaque(pointer).takeUnretainedValue()
    webView.scrollView.pinchGestureRecognizer?.isEnabled = false
    KeyboardViewport.attach(to: webView)
    StartupOverlay.attach(to: webView)
}

@MainActor
@_cdecl("tio_finish_startup")
func tioFinishStartup(_ pointer: UnsafeRawPointer, _ ready: Bool, _ appearance: Int32) {
    let webView = Unmanaged<WKWebView>.fromOpaque(pointer).takeUnretainedValue()
    StartupOverlay.finish(in: webView, ready: ready, dark: appearance < 0 ? nil : appearance == 1)
}
