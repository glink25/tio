use serde::Serialize;
use tauri::utils::config::WindowConfig;
use tauri::WebviewWindow;
#[cfg(any(target_os = "macos", target_os = "linux"))]
use tauri::{Emitter, EventTarget};

#[cfg(target_os = "windows")]
#[path = "desktop_chrome_windows.rs"]
mod windows;

#[cfg(target_os = "linux")]
use gtk::prelude::*;

#[derive(Serialize)]
pub struct ChromeState {
    layout: &'static str,
    left: f64,
    right: f64,
    height: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    center: Option<f64>,
}

impl ChromeState {
    fn system() -> Self {
        Self {
            layout: "system",
            left: 0.,
            right: 0.,
            height: 0.,
            center: None,
        }
    }
}

pub fn configure(config: &mut WindowConfig) {
    config.visible = false;
    #[cfg(target_os = "macos")]
    {
        config.hidden_title = true;
        config.title_bar_style = tauri::TitleBarStyle::Overlay;
    }
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn emit_action(window: &WebviewWindow, action: &str) {
    let _ = window.emit_to(
        EventTarget::webview_window(window.label()),
        "tio:desktop-chrome",
        action,
    );
}

pub fn install(window: &WebviewWindow) -> tauri::Result<()> {
    #[cfg(target_os = "windows")]
    if let Ok(hwnd) = window.hwnd() {
        windows::install(hwnd);
    }

    #[cfg(target_os = "linux")]
    if let Ok(gtk_window) = window.gtk_window() {
        // GTK requires setting the decoration before the top-level window is realized.
        if !gtk_window.is_realized() {
            let header = gtk::HeaderBar::new();
            header.set_title(gtk_window.title().as_deref());
            header.set_has_subtitle(false);
            header.set_show_close_button(true);
            let sidebar =
                gtk::Button::from_icon_name(Some("sidebar-show-symbolic"), gtk::IconSize::Button);
            sidebar.set_widget_name("tio-sidebar");
            sidebar.set_tooltip_text(Some("Sidebar"));
            sidebar.set_visible(false);
            sidebar.set_no_show_all(true);
            let sidebar_window = window.clone();
            sidebar.connect_clicked(move |_| emit_action(&sidebar_window, "sidebar"));
            header.pack_start(&sidebar);
            let new_window =
                gtk::Button::from_icon_name(Some("window-new-symbolic"), gtk::IconSize::Button);
            new_window.set_tooltip_text(Some("New window"));
            let current = window.clone();
            new_window.connect_clicked(move |_| emit_action(&current, "new-window"));
            header.pack_end(&new_window);
            header.show_all();
            gtk_window.set_titlebar(Some(&header));
        }
    }

    window.show()
}

#[cfg(target_os = "macos")]
pub fn install_app_menu(app: &tauri::AppHandle) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem, MenuItemKind, WINDOW_SUBMENU_ID};
    use tauri::Manager;

    const NEW_WINDOW: &str = "tio-new-window";
    let menu = app.menu().map_or_else(|| Menu::default(app), Ok)?;
    if let Some(MenuItemKind::Submenu(window_menu)) = menu.get(WINDOW_SUBMENU_ID) {
        let item = MenuItem::with_id(
            app,
            NEW_WINDOW,
            "New Window",
            true,
            Some("CmdOrCtrl+Shift+N"),
        )?;
        window_menu.prepend(&item)?;
    }
    app.set_menu(menu)?;
    app.on_menu_event(|app, event| {
        if event.id() == NEW_WINDOW {
            if let Some(window) = app
                .webview_windows()
                .into_values()
                .find(|window| window.is_focused().unwrap_or(false))
            {
                emit_action(&window, "new-window");
            }
        }
    });
    Ok(())
}

// AppKit geometry is in logical points, the same coordinate scale as the WebView.
#[cfg(target_os = "macos")]
fn mac_chrome_state(window: &WebviewWindow) -> Option<ChromeState> {
    use objc2_app_kit::{NSWindow, NSWindowButton};

    let raw = window.ns_window().ok()?;
    // Tauri owns the NSWindow and this function runs on the AppKit main thread.
    let native = unsafe { raw.cast::<NSWindow>().as_ref()? };
    if native
        .styleMask()
        .contains(objc2_app_kit::NSWindowStyleMask::FullScreen)
    {
        return Some(ChromeState::system());
    }

    let content = native.contentView()?;
    let bounds = content.convertRect_toView(content.bounds(), None);
    let layout = native.contentLayoutRect();
    let top = bounds.origin.y + bounds.size.height;
    let close = native.standardWindowButton(NSWindowButton::CloseButton)?;
    let close_rect = close.convertRect_toView(close.bounds(), None);
    let right_edge = [
        NSWindowButton::CloseButton,
        NSWindowButton::MiniaturizeButton,
        NSWindowButton::ZoomButton,
    ]
    .into_iter()
    .filter_map(|kind| native.standardWindowButton(kind))
    .filter(|button| !button.isHidden())
    .map(|button| {
        let rect = button.convertRect_toView(button.bounds(), None);
        rect.origin.x + rect.size.width
    })
    .fold(close_rect.origin.x + close_rect.size.width, f64::max);

    let center = top - (close_rect.origin.y + close_rect.size.height / 2.);
    // Keep the strip below the controls even when the system's layout guide is
    // briefly out of date during a window transition.
    let height = (top - (layout.origin.y + layout.size.height)).max(top - close_rect.origin.y);
    (height > 0. && center > 0. && center < height).then_some(ChromeState {
        layout: "overlay",
        left: (right_edge - bounds.origin.x).ceil(),
        right: 0.,
        height: height.ceil(),
        center: Some(center),
    })
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn desktop_chrome_state(window: WebviewWindow) -> ChromeState {
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    let target = window.clone();
    let scheduled = window.run_on_main_thread(move || {
        let _ = sender.send(mac_chrome_state(&target));
    });
    scheduled
        .ok()
        .and_then(|_| receiver.recv().ok())
        .flatten()
        .unwrap_or(ChromeState {
            layout: "overlay",
            left: 84.,
            right: 0.,
            height: 32.,
            center: Some(16.),
        })
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn desktop_chrome_state(window: WebviewWindow) -> ChromeState {
    if window.is_fullscreen().unwrap_or(false) {
        return ChromeState::system();
    }
    #[cfg(target_os = "windows")]
    {
        window
            .hwnd()
            .ok()
            .and_then(windows::state)
            .unwrap_or_else(ChromeState::system)
    }
    #[cfg(target_os = "linux")]
    {
        let layout = if window
            .gtk_window()
            .ok()
            .and_then(|window| window.titlebar())
            .is_some()
        {
            "headerbar"
        } else {
            "system"
        };
        ChromeState {
            layout,
            ..ChromeState::system()
        }
    }
}

#[tauri::command]
pub fn desktop_chrome_title(
    window: WebviewWindow,
    title: String,
    sidebar: Option<String>,
) -> tauri::Result<()> {
    window.set_title(&title)?;
    #[cfg(not(target_os = "linux"))]
    let _ = sidebar;
    #[cfg(target_os = "linux")]
    if let Some(header) = window
        .gtk_window()?
        .titlebar()
        .and_downcast::<gtk::HeaderBar>()
    {
        header.set_title(Some(&title));
        if let Some(button) = header
            .children()
            .into_iter()
            .find(|widget| widget.widget_name() == "tio-sidebar")
        {
            button.set_tooltip_text(sidebar.as_deref());
            button.set_visible(sidebar.is_some());
        }
    }
    Ok(())
}
