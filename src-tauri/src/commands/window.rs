#[cfg(target_os = "macos")]
#[tauri::command]
pub fn set_native_window_background_color(
    window: tauri::WebviewWindow,
    r: f64,
    g: f64,
    b: f64,
    a: f64,
) -> Result<(), String> {
    use objc2_app_kit::{NSColor, NSWindow};

    window
        .with_webview(move |webview| {
            unsafe {
                let ns_window: &NSWindow = &*webview.ns_window().cast();
                let color = NSColor::colorWithDeviceRed_green_blue_alpha(r, g, b, a);
                ns_window.setBackgroundColor(Some(&color));
            }
        })
        .map_err(|e| format!("Failed to set window background color: {e}"))
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn set_native_window_background_color(
    _window: tauri::WebviewWindow,
    _r: f64,
    _g: f64,
    _b: f64,
    _a: f64,
) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn test_color_values_in_range() {
        let r = 250.0 / 255.0;
        let g = 250.0 / 255.0;
        let b = 250.0 / 255.0;
        assert!(r >= 0.0 && r <= 1.0);
        assert!(g >= 0.0 && g <= 1.0);
        assert!(b >= 0.0 && b <= 1.0);
    }
}
