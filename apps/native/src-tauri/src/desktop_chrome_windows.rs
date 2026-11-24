use super::ChromeState;
use ::windows::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
use ::windows::Win32::Graphics::Dwm::{
    DwmDefWindowProc, DwmExtendFrameIntoClientArea, DwmGetWindowAttribute, DwmIsCompositionEnabled,
    DWMWA_CAPTION_BUTTON_BOUNDS,
};
use ::windows::Win32::UI::Accessibility::{HCF_HIGHCONTRASTON, HIGHCONTRASTW};
use ::windows::Win32::UI::Controls::MARGINS;
use ::windows::Win32::UI::HiDpi::{GetDpiForWindow, GetSystemMetricsForDpi};
use ::windows::Win32::UI::Shell::{
    DefSubclassProc, GetWindowSubclass, RemoveWindowSubclass, SetWindowSubclass,
};
use ::windows::Win32::UI::WindowsAndMessaging::{
    GetWindowLongW, GetWindowRect, SetWindowPos, SystemParametersInfoW, GWL_STYLE, HTCAPTION,
    HTCLIENT, HTTOP, HTTOPLEFT, HTTOPRIGHT, NCCALCSIZE_PARAMS, SM_CXPADDEDBORDER, SM_CXSIZE,
    SM_CYSIZEFRAME, SPI_GETHIGHCONTRAST, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
    SWP_NOZORDER, WM_DPICHANGED, WM_DWMCOMPOSITIONCHANGED, WM_NCCALCSIZE, WM_NCDESTROY,
    WM_NCHITTEST, WS_CAPTION,
};

const CHROME_SUBCLASS: usize = 1;
const ROW_HEIGHT: f64 = 40.;

pub(super) fn install(hwnd: HWND) {
    unsafe {
        let mut high_contrast = HIGHCONTRASTW {
            cbSize: size_of::<HIGHCONTRASTW>() as u32,
            ..Default::default()
        };
        let _ = SystemParametersInfoW(
            SPI_GETHIGHCONTRAST,
            high_contrast.cbSize,
            Some((&mut high_contrast as *mut HIGHCONTRASTW).cast()),
            Default::default(),
        );
        if high_contrast.dwFlags.contains(HCF_HIGHCONTRASTON)
            || !DwmIsCompositionEnabled().is_ok_and(|enabled| enabled.as_bool())
            || extend_frame(hwnd).is_err()
        {
            return;
        }
        if !SetWindowSubclass(hwnd, Some(frame_proc), CHROME_SUBCLASS, 0).as_bool()
            || refresh_frame(hwnd).is_err()
        {
            remove(hwnd);
        }
    }
}

pub(super) fn state(hwnd: HWND) -> Option<ChromeState> {
    unsafe {
        if !GetWindowSubclass(hwnd, Some(frame_proc), CHROME_SUBCLASS, None).as_bool() {
            return None;
        }
        let dpi = GetDpiForWindow(hwnd).max(96);
        let scale = f64::from(dpi) / 96.;
        let mut caption = RECT::default();
        let measured = DwmGetWindowAttribute(
            hwnd,
            DWMWA_CAPTION_BUTTON_BOUNDS,
            (&mut caption as *mut RECT).cast(),
            size_of::<RECT>() as u32,
        )
        .is_ok()
            && caption.right > caption.left;
        let width = if measured {
            caption.right - caption.left
        } else {
            3 * GetSystemMetricsForDpi(SM_CXSIZE, dpi)
        };
        let left = measured && caption.left < width;
        let inset = f64::from(width) / scale + 12.;
        Some(ChromeState {
            layout: "overlay",
            left: if left { inset } else { 0. },
            right: if left { 0. } else { inset },
            height: ROW_HEIGHT.max(f64::from(caption.bottom) / scale),
            center: None,
        })
    }
}

unsafe fn extend_frame(hwnd: HWND) -> ::windows::core::Result<()> {
    let dpi = unsafe { GetDpiForWindow(hwnd) }.max(96);
    let margin = MARGINS {
        cyTopHeight: (ROW_HEIGHT * f64::from(dpi) / 96.).round() as i32,
        ..Default::default()
    };
    unsafe { DwmExtendFrameIntoClientArea(hwnd, &margin) }
}

unsafe fn refresh_frame(hwnd: HWND) -> ::windows::core::Result<()> {
    unsafe {
        SetWindowPos(
            hwnd,
            None,
            0,
            0,
            0,
            0,
            SWP_FRAMECHANGED | SWP_NOSIZE | SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE,
        )
    }
}

unsafe fn remove(hwnd: HWND) {
    unsafe {
        let _ = RemoveWindowSubclass(hwnd, Some(frame_proc), CHROME_SUBCLASS);
        let _ = DwmExtendFrameIntoClientArea(hwnd, &MARGINS::default());
        let _ = refresh_frame(hwnd);
    }
}

unsafe extern "system" fn frame_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _: usize,
    _: usize,
) -> LRESULT {
    unsafe {
        if message == WM_NCDESTROY {
            let _ = RemoveWindowSubclass(hwnd, Some(frame_proc), CHROME_SUBCLASS);
            return DefSubclassProc(hwnd, message, wparam, lparam);
        }
        if (message == WM_DWMCOMPOSITIONCHANGED || message == WM_DPICHANGED)
            && extend_frame(hwnd).is_err()
        {
            remove(hwnd);
            return DefSubclassProc(hwnd, message, wparam, lparam);
        }
        // Tao clears the caption style when it enters native fullscreen.
        if GetWindowLongW(hwnd, GWL_STYLE) as u32 & WS_CAPTION.0 != WS_CAPTION.0 {
            return DefSubclassProc(hwnd, message, wparam, lparam);
        }

        let mut dwm = LRESULT(0);
        if DwmDefWindowProc(hwnd, message, wparam, lparam, &mut dwm).as_bool() {
            return dwm;
        }

        if message == WM_NCCALCSIZE && wparam.0 != 0 && lparam.0 != 0 {
            let params = lparam.0 as *mut NCCALCSIZE_PARAMS;
            let original_top = (*params).rgrc[0].top;
            let result = DefSubclassProc(hwnd, message, wparam, lparam);
            let client = &mut (*params).rgrc[0];
            // Keep the frame insets applied by Windows; extend over just the caption height.
            client.top = original_top + resize_border(hwnd);
            return result;
        }

        let system = DefSubclassProc(hwnd, message, wparam, lparam);
        if message == WM_NCHITTEST && system.0 == HTCAPTION as isize {
            let mut rect = RECT::default();
            let x = (lparam.0 & 0xffff) as i16 as i32;
            let y = ((lparam.0 >> 16) & 0xffff) as i16 as i32;
            let border = resize_border(hwnd);
            if GetWindowRect(hwnd, &mut rect).is_ok() && y < rect.top + border {
                let top_edge = if x < rect.left + border {
                    HTTOPLEFT
                } else if x >= rect.right - border {
                    HTTOPRIGHT
                } else {
                    HTTOP
                };
                return LRESULT(top_edge as isize);
            }
            // Drag versus click inside the caption is classified by WebView2's app-region CSS.
            return LRESULT(HTCLIENT as isize);
        }
        system
    }
}

unsafe fn resize_border(hwnd: HWND) -> i32 {
    let dpi = unsafe { GetDpiForWindow(hwnd) }.max(96);
    unsafe {
        GetSystemMetricsForDpi(SM_CYSIZEFRAME, dpi) + GetSystemMetricsForDpi(SM_CXPADDEDBORDER, dpi)
    }
}
