import UIKit

@MainActor
@_cdecl("tio_supports_ipad_windows")
func tioSupportsIPadWindows() -> Bool {
    UIDevice.current.userInterfaceIdiom == .pad && UIApplication.shared.supportsMultipleScenes
}

@MainActor
@_cdecl("tio_focus_scene")
func tioFocusScene(_ value: UnsafePointer<CChar>) -> Bool {
    let id = String(cString: value)
    let app = UIApplication.shared
    guard let scene = app.connectedScenes.first(where: { $0.session.persistentIdentifier == id }) else {
        return false
    }
    if scene.activationState == .foregroundActive, let window = (scene as? UIWindowScene)?.windows.first {
        window.makeKeyAndVisible()
    } else if #available(iOS 17.0, *) {
        app.activateSceneSession(for: UISceneSessionActivationRequest(session: scene.session)) { error in
            NSLog("Tio scene activation failed: %@", String(describing: error))
        }
    } else {
        app.requestSceneSessionActivation(scene.session, userActivity: nil, options: nil) { error in
            NSLog("Tio scene activation failed: %@", String(describing: error))
        }
    }
    return true
}

@_silgen_name("tio_scene_request_failed")
private func tioSceneRequestFailed(_ label: UnsafePointer<CChar>)

private let windowActivity = "com.glink25.tio.new-window"

@MainActor
@_cdecl("tio_request_scene")
func tioRequestScene(_ source: UnsafePointer<CChar>?, _ value: UnsafePointer<CChar>) {
    let label = String(cString: value)
    let app = UIApplication.shared
    let options = UIScene.ActivationRequestOptions()
    if let source {
        let id = String(cString: source)
        options.requestingScene = app.connectedScenes.first { $0.session.persistentIdentifier == id }
    }
    let activity = NSUserActivity(activityType: windowActivity)
    activity.userInfo = ["label": label]
    let failed: (Error) -> Void = { error in
        NSLog("Tio could not open another scene: %@", String(describing: error))
        label.withCString { tioSceneRequestFailed($0) }
    }
    if #available(iOS 17.0, *) {
        var request = UISceneSessionActivationRequest()
        request.userActivity = activity
        request.options = options
        app.activateSceneSession(for: request, errorHandler: failed)
    } else {
        app.requestSceneSessionActivation(nil, userActivity: activity, options: options, errorHandler: failed)
    }
}

@MainActor
@_cdecl("tio_requested_scene_label")
func tioRequestedSceneLabel(_ pointer: UnsafeRawPointer) -> UnsafeMutablePointer<CChar>? {
    let options = Unmanaged<UIScene.ConnectionOptions>.fromOpaque(pointer).takeUnretainedValue()
    guard let label = options.userActivities.first(where: { $0.activityType == windowActivity })?.userInfo?["label"] as? String else {
        return nil
    }
    return strdup(label)
}

@_silgen_name("tio_scene_close_failed")
private func tioSceneCloseFailed(_ label: UnsafePointer<CChar>)

@MainActor
@_cdecl("tio_close_scene")
func tioCloseScene(_ value: UnsafePointer<CChar>, _ labelValue: UnsafePointer<CChar>) -> Bool {
    let id = String(cString: value)
    let label = String(cString: labelValue)
    let app = UIApplication.shared
    guard app.supportsMultipleScenes,
          let scene = app.connectedScenes.first(where: { $0.session.persistentIdentifier == id })
    else { return false }
    // Keep the Tauri window alive until UIKit has delivered sceneDidDisconnect.
    app.requestSceneSessionDestruction(scene.session, options: nil) { error in
        NSLog("Tio could not close a scene: %@", String(describing: error))
        label.withCString { tioSceneCloseFailed($0) }
    }
    return true
}
