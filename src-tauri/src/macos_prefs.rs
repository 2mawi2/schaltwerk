// App-scoped macOS preferences to disable smart punctuation
// This only affects our application, not system-wide settings

#[cfg(target_os = "macos")]
pub fn disable_smart_substitutions() {
    use core_foundation::base::TCFType;
    use core_foundation::boolean::CFBoolean;
    use core_foundation::bundle::{CFBundleGetIdentifier, CFBundleGetMainBundle};
    use core_foundation::string::CFString;
    use core_foundation_sys::preferences::{CFPreferencesAppSynchronize, CFPreferencesSetAppValue};

    // Get the bundle identifier at runtime (e.g., "com.schaltwerk.app")
    let bundle_id_cf = unsafe {
        let bundle = CFBundleGetMainBundle();
        let ident = CFBundleGetIdentifier(bundle);
        // If missing (shouldn't be in a proper app), bail out quietly
        if ident.is_null() {
            log::warn!(
                "[macOS] Could not get bundle identifier for smart substitution preferences"
            );
            return;
        }
        // Wrap in safe CFString
        CFString::wrap_under_get_rule(ident)
    };

    let keys = [
        "NSAutomaticDashSubstitutionEnabled",
        "NSAutomaticQuoteSubstitutionEnabled",
        "NSAutomaticPeriodSubstitutionEnabled",
        "NSAutomaticTextReplacementEnabled",
        // Also disable automatic capitalization of the first letter
        "NSAutomaticCapitalizationEnabled",
    ];

    unsafe {
        for key in keys {
            let key_cf = CFString::new(key);
            let false_value = CFBoolean::false_value();
            // Set to false in our app's domain only
            CFPreferencesSetAppValue(
                key_cf.as_concrete_TypeRef(),
                false_value.as_CFTypeRef(),
                bundle_id_cf.as_concrete_TypeRef(),
            );
        }
        // Flush to ~/Library/Preferences/<bundle>.plist for current user
        CFPreferencesAppSynchronize(bundle_id_cf.as_concrete_TypeRef());
        log::info!("[macOS] Disabled smart substitutions for app domain only");
    }
}

#[cfg(not(target_os = "macos"))]
pub fn disable_smart_substitutions() {
    // No-op on non-macOS platforms
}
