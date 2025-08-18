# Homebrew Schaltwerk

Private Homebrew tap for Schaltwerk, a visual interface for managing Para sessions.

## Installation

```bash
# Add this tap
brew tap mariuswichtner/schaltwerk https://github.com/mariuswichtner/homebrew-schaltwerk.git

# Install Schaltwerk
brew install schaltwerk
```

## First Run

Since this application is not signed with an Apple Developer certificate, you'll need to approve it in System Settings on first launch:

1. Try to open the app (it will be blocked)
2. Go to System Settings > Privacy & Security
3. Click "Open Anyway" for Schaltwerk
4. The app will work normally after this one-time approval

## Repository Structure

This repository should be created as `homebrew-schaltwerk` (private) with:

```
homebrew-schaltwerk/
├── Formula/
│   └── schaltwerk.rb    # Homebrew formula
└── README.md            # This file
```

## Updating the Formula

The formula is automatically updated by GitHub Actions when a new release is tagged in the main repository. Manual updates can be done by:

1. Updating the version number
2. Updating the SHA256 checksums for both architectures
3. Committing and pushing the changes

## Manual Checksum Calculation

```bash
# Download the release archives
curl -LO https://github.com/mariuswichtner/para-ui/releases/download/vX.Y.Z/schaltwerk-X.Y.Z-x86_64-apple-darwin.tar.gz
curl -LO https://github.com/mariuswichtner/para-ui/releases/download/vX.Y.Z/schaltwerk-X.Y.Z-aarch64-apple-darwin.tar.gz

# Calculate checksums
shasum -a 256 schaltwerk-*.tar.gz
```

## License

Private repository - not for public distribution.