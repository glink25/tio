import UIKit

enum AppLifecycle {
    private static var activeObservers: [NSObjectProtocol] = []
    static func register() {
        for name in [UIApplication.didBecomeActiveNotification, UIScene.didActivateNotification] {
            activeObservers.append(NotificationCenter.default.addObserver(
                forName: name, object: nil, queue: .main
            ) { _ in tio_activate_foreground() })
        }
    }
}

@_cdecl("tio_register_foreground")
func tioRegisterForeground() {
    AppLifecycle.register()
}

@MainActor
@_cdecl("tio_is_active")
func tioIsActive() -> Bool {
    UIApplication.shared.applicationState == .active ||
        UIApplication.shared.connectedScenes.contains { $0.activationState == .foregroundActive }
}
