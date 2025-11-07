# Flatpak Linux Release Plan

## Goals
- Ship Schaltwerk as a reproducible Flatpak bundle alongside the existing `.deb`, `.rpm`, and AppImage artifacts.
- Keep Flatpak metadata (AppStream, desktop entry, icons) aligned with GNOME/Flathub guidelines so the package can graduate to Flathub without rework.
- Automate builds inside the release workflow so every tagged version outputs signed `.flatpak` and exported repo archives ready for distribution.

## Current State
- `flatpak/com.mariuswichtner.schaltwerk.yml` already defines a builder that installs dependencies, embeds the MCP server, and copies resources into `/app/bin`, but it is manually invoked outside of Tauri’s `bundle.targets`.
- `.github/workflows/release.yml` provisions Flatpak runtimes in `build-linux`, yet `node scripts/package-manager.mjs run tauri -- build` still targets `deb`, `rpm`, and `appimage` only. The Flatpak bundle is produced separately via `flatpak-builder`, which duplicates logic and skips Tauri’s built-in bundle metadata.
- AppStream (`flatpak/com.mariuswichtner.schaltwerk.metainfo.xml`) and desktop entry files exist but are not validated in CI, and they lack release notes/screenshots required for Flathub.

## Constraints & External Requirements
- Tauri 2 exposes `bundle.targets` with a `flatpak` entry; enabling it keeps versioning/icons in sync with other bundles and ensures `src-tauri/tauri.conf.json` remains the single source of truth.
- Flathub requires current GNOME runtimes (47 as of November 2025), complete AppStream metadata (releases, screenshots, content rating), and automated validation via `flatpak-builder --install-deps-from=flathub` plus `flatpak run org.freedesktop.appstream-glib validate`. Access to `$HOME` must be justified (git worktrees) and ideally narrowed to `home:ro` plus explicit directories when possible.
- CI artifacts must include both the single-file bundle (`Schaltwerk-<version>.flatpak`) and the exported repo (`.flatpakrepo.tar.gz`) so self-hosted remotes can `flatpak remote-add` without rebuilding.

## Phase 1 – Manifest & Bundler Alignment
1. Update `src-tauri/tauri.conf.json`:
   - Add `"flatpak"` to `bundle.targets`.
   - Define a `bundle.flatpak` section that mirrors the runtime, SDK extensions, finish arguments, and extra resources already present in `flatpak/com.mariuswichtner.schaltwerk.yml` (Wayland/X11 sockets, `--filesystem=home`, notifications, SSH agent).
   - Point `resources` to the MCP assets so the Flatpak target produced by Tauri bundler remains consistent with the manual manifest.
2. Refactor `flatpak/com.mariuswichtner.schaltwerk.yml`:
   - Reuse build outputs from `src-tauri/target/release/bundle/flatpak` when the Tauri target is run, or document why `flatpak-builder` remains necessary (e.g., for Flathub export). If both are needed, split responsibilities: let Tauri build the binary, and let the manifest focus on staging + export.
   - Extract duplicated commands (e.g., MCP embed, npm install) into `scripts/flatpak-build.sh` so GitHub Actions and local dev share the same entry point.
3. Document local build instructions inside `INSTALL.md` (Flatpak section) so contributors can run `flatpak-builder --user --install --force-clean build flatpak/com.mariuswichtner.schaltwerk.yml`.

## Phase 2 – Flatpak Automation & CI Packaging
1. Extend `.github/workflows/release.yml`:
   - After the existing `node scripts/package-manager.mjs run tauri -- build --bundles ...` call, add `flatpak` to the bundle list so the Tauri-generated manifest lives under `src-tauri/target/release/bundle/flatpak`.
   - Replace the manual `flatpak-builder` invocation with a reusable GitHub Action (`flatpak/flatpak-github-actions/flatpak-builder@v6`) or keep the raw CLI but feed it the staged artifacts from the Tauri build to avoid double compilation.
   - Run `flatpak run org.freedesktop.appstream-glib validate flatpak/com.mariuswichtner.schaltwerk.metainfo.xml` (or the builder action’s `appstream-compose` step) to fail CI on metadata issues.
   - Upload `.flatpak`, `.flatpakrepo.tar.gz`, and checksums to the release assets, mirroring how `.deb/.rpm/.AppImage` files are handled.
2. Cache the Flatpak builder dirs between runs (`~/.cache/flatpak-builder`) to reduce build time; invalidate when manifest changes.
3. Add a nightly/weekly workflow that rebuilds the Flatpak against the latest runtime to catch ABI regressions early.

## Phase 3 – Distribution & Flathub Readiness
1. Flesh out `flatpak/com.mariuswichtner.schaltwerk.metainfo.xml`:
   - Add screenshots (PNG hosted in repo), release entries with version + date, and developer contact info.
   - Declare required permissions (filesystem, network, notifications) in the description for reviewer clarity.
2. Prepare Flathub submission:
   - Fork `flathub/com.mariuswichtner.schaltwerk`, mirror the manifest, and configure the Flathub GitHub workflow hook.
   - Ensure the manifest pulls tagged release tarballs instead of the entire git tree to satisfy Flathub’s source requirements.
   - Provide verification instructions (e.g., steps to create a dummy project and spawn a session) for the Flathub reviewer.
3. Decide on distribution strategy:
   - Short term: host `.flatpak` and `.flatpakrepo.tar.gz` on GitHub Releases (already partially in place).
   - Long term: publish to Flathub so users can `flatpak install flathub com.mariuswichtner.schaltwerk` without manual downloads; keep GitHub artifacts for power users.

## Phase 4 – Validation & Release Checklist
1. Local smoke test on a GNOME 47 runtime:
   - `flatpak-builder --user --install --force-clean build flatpak/com.mariuswichtner.schaltwerk.yml`
   - `flatpak run com.mariuswichtner.schaltwerk` and verify git worktree access, dual terminals, MCP server embedding, and notifications.
2. CI verification:
   - `just test` (mandatory before tagging).
   - `flatpak run org.freedesktop.appstream-glib validate` on the AppStream file.
   - `flatpak build-export` + `flatpak build-sign` (optional) so the exported repo is ready for Flathub or custom remotes.
3. Release checklist:
   - Confirm release notes mention Flatpak availability and installation steps.
   - Update `INSTALL.md` with the final commands (Flathub vs. manual bundle).
   - Announce runtime changes (e.g., when GNOME 48 becomes stable) to keep existing installations updated.

## Open Questions
- Should Schaltwerk continue granting full `$HOME` access from Flatpak, or can we narrow it to specific directories (`--filesystem=home/.schaltwerk`)? This impacts Flathub approval.
- Is signature infrastructure (OSTree GPG key) required now, or can we rely on GitHub artifacts until Flathub handles signing?
- Do we need a separate telemetry/metrics opt-in for Flatpak builds due to sandboxed network restrictions?
