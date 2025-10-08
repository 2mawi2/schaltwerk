# App Icon Alignment Adjustment Plan

1. Determine the additional downward offset for the base 1024×1024 icon (proposing an extra 6 px, keeping total shift small to avoid clipping).
2. Apply the offset to `app_icon.png`, regenerate the macOS `.icns` bundle and the PNG sizes we ship.
3. Rebuild the cross-platform icon assets (iOS, Android, Windows) from the updated source so all targets stay consistent.
4. Run `just test` to confirm the asset regeneration leaves the project green before handing back the change.
