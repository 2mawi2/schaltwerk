# Schaltwerk Installation Guide

## Quick Install (Homebrew)

For users with access to the private repository:

```bash
# 1. Add the private Homebrew tap (one-time setup)
brew tap 2mawi2/tap https://github.com/2mawi2/homebrew-tap

# 2. Install Schaltwerk
brew install --cask schaltwerk

# 3. Launch the application
open -a Schaltwerk
```

## First Launch Setup

Since Schaltwerk is distributed without an Apple Developer certificate, macOS will block it on first launch. Follow these steps to approve the app:

### Step 1: Attempt First Launch
```bash
schaltwerk
```
You'll see a message that "Schaltwerk" cannot be opened because it is from an unidentified developer.

### Step 2: Open System Settings
1. Click the Apple menu  > System Settings
2. Navigate to Privacy & Security
3. Scroll down to the Security section

### Step 3: Approve the Application
1. Look for the message: "Schaltwerk was blocked from use because it is not from an identified developer"
2. Click the "Open Anyway" button next to this message
3. You may need to enter your password

### Step 4: Confirm Launch
1. Try launching Schaltwerk again
2. A dialog will appear asking if you're sure you want to open it
3. Click "Open"

The application will now launch and work normally. This approval is only needed once.

## Manual Installation

If you prefer to install manually or can't use Homebrew:

### Download the Application
1. Go to the [Releases page](https://github.com/2mawi2/schaltwerk/releases)
2. Download `Schaltwerk-<version>-macos-universal.app.tar.gz`

### Install the Application
```bash
# 1. Extract the archive
tar -xzf Schaltwerk-*-macos-universal.app.tar.gz

# 2. Move to Applications folder
mv Schaltwerk.app /Applications/

# 3. Remove quarantine attribute (optional, helps with Gatekeeper)
xattr -cr /Applications/Schaltwerk.app

# 4. Ad-hoc sign the application (optional, improves security)
codesign --force --deep -s - /Applications/Schaltwerk.app
```

### Launch from Applications
1. Open Finder
2. Navigate to Applications
3. Double-click Schaltwerk
4. Follow the First Launch Setup steps above if blocked

## Troubleshooting

## Automatic Updates

- Schaltwerk checks GitHub releases on startup and installs new versions silently when "Automatic updates" is enabled (default).
- You can toggle this behavior in **Settings → Version** and run a manual check with the "Check for updates" button. Manual checks work even when automatic updates are disabled.
- Updates require internet connectivity and the ability to overwrite the existing `/Applications/Schaltwerk.app`. If macOS prevents the update, reopen the app directly from `/Applications` or reinstall from the latest DMG/tarball.
- After an update is applied you will be prompted with a toast; restart Schaltwerk to launch the new build.

### "Schaltwerk is damaged and can't be opened"
This usually means the quarantine attribute needs to be removed:
```bash
xattr -cr /Applications/Schaltwerk.app
```

### "The application 'Schaltwerk' can't be opened"
Re-sign the application:
```bash
codesign --force --deep -s - /Applications/Schaltwerk.app
```

### App doesn't appear in Applications folder after Homebrew install
Check if it was installed to the Homebrew prefix:
```bash
ls -la $(brew --prefix)/bin/schaltwerk
```

### Terminal permissions issues
If Schaltwerk can't create terminals:
1. Go to System Settings > Privacy & Security > Developer Tools
2. Add Terminal.app or your preferred terminal
3. Restart Schaltwerk

### Port 8547 already in use
Schaltwerk runs an API server on port 8547. If this port is in use:
```bash
# Find what's using the port
lsof -i :8547

# Kill the process if needed
kill -9 <PID>
```

## Uninstallation

### Via Homebrew
```bash
brew uninstall schaltwerk
```

### Manual Uninstallation
```bash
# Remove the application
rm -rf /Applications/Schaltwerk.app

# Remove application support files
rm -rf ~/Library/Application\ Support/schaltwerk

# Remove logs
rm -rf ~/Library/Logs/schaltwerk
```

## Building from Source

If you need to build Schaltwerk from source:

### Prerequisites
- Bun 1.2 or later (JS tooling)
- Node.js 20 or later (for compatibility and native tooling)
- Rust 1.75 or later
- Xcode Command Line Tools

### Build Steps
```bash
# 1. Clone the repository
git clone https://github.com/2mawi2/schaltwerk.git
cd schaltwerk

# 2. Install dependencies
bun install        # or: npm install

# 3. Build the application
bun run tauri build    # or: npm run tauri build

# 4. The built app will be in:
# src-tauri/target/release/bundle/macos/Schaltwerk.app
```

## Security Considerations

### Why the Security Warning?
Schaltwerk is distributed without an Apple Developer certificate ($99/year) to keep it free and open. The ad-hoc signing we use provides:
- Basic code integrity verification
- Protection against tampering after download
- Consistent behavior across launches

### What Permissions Does Schaltwerk Need?
- **File System Access**: To read and write Para session files
- **Process Spawning**: To create terminal sessions (PTY)
- **Network Access**: Local API server on port 8547
- **No Special Entitlements**: No camera, microphone, or contacts access

### Is It Safe?
- All code is open source and auditable
- No external network connections (only localhost)
- No telemetry or data collection
- Built and signed via GitHub Actions for transparency

## Support

For issues or questions:
1. Check the [GitHub Issues](https://github.com/2mawi2/schaltwerk/issues)
2. Review the [CLAUDE.md](./CLAUDE.md) for development guidelines
3. Contact the maintainer through the private repository
