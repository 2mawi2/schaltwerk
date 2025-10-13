# Schaltwerk Development Commands
#
# Run modes:
#   just run              - Dev mode with auto-detected port (hot-reload enabled, FASTEST compile)
#   just run-port 2235    - Release binary on specific port (NO hot-reload) - use for Schaltwerk-on-Schaltwerk
#   just run-port-dev 2235 - Dev mode on specific port (hot-reload enabled, standard dev performance)
#   just run-port-release 2235 - Force rebuild release binary on specific port (NO hot-reload)
#   just run-release      - Run pre-built release binary (NO hot-reload)
#
# Build Profiles:
#   dev (opt-level=0) - Default profile for fastest compilation, used by 'just run' and 'just test'
#   dev-opt (opt-level=3 for deps) - Production-like performance for testing
#   release (opt-level=3) - Used for production builds with maximum optimization

pm := "node scripts/package-manager.mjs"

# Clear all caches (build and application)
clear:
    rm -rf node_modules/.vite dist dist-ssr src-tauri/target/debug/incremental src-tauri/target/debug/deps src-tauri/target/debug/build
    rm -rf ~/Library/Application\ Support/schaltwerk/cache ~/Library/Application\ Support/schaltwerk/WebKit ~/.schaltwerk/cache
    rm -rf src-tauri/target/.rustc_info.json src-tauri/target/debug/.fingerprint
    rm -rf ~/Library/Caches/schaltwerk* ~/Library/WebKit/schaltwerk* /tmp/schaltwerk* 2>/dev/null || true
    pkill -f "schaltwerk" || true
    rm -rf .parcel-cache .turbo

# Release a new version (automatically bumps version, commits, tags, and pushes)
release version="patch":
    #!/usr/bin/env bash
    set -euo pipefail

    echo "Starting release process..."

    # Get current version from tauri.conf.json
    CURRENT_VERSION=$(grep '"version"' src-tauri/tauri.conf.json | head -1 | sed 's/.*"version": "\(.*\)".*/\1/')
    echo "Current version: $CURRENT_VERSION"

    # Calculate new version based on argument (patch, minor, major, or specific version)
    if [[ "{{version}}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        NEW_VERSION="{{version}}"
    else
        IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"
        case "{{version}}" in
            major)
                NEW_VERSION="$((MAJOR + 1)).0.0"
                ;;
            minor)
                NEW_VERSION="$MAJOR.$((MINOR + 1)).0"
                ;;
            patch|*)
                NEW_VERSION="$MAJOR.$MINOR.$((PATCH + 1))"
                ;;
        esac
    fi

    echo "New version: $NEW_VERSION"

    # Update version in tauri.conf.json
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "s/\"version\": \"$CURRENT_VERSION\"/\"version\": \"$NEW_VERSION\"/" src-tauri/tauri.conf.json
    else
        sed -i "s/\"version\": \"$CURRENT_VERSION\"/\"version\": \"$NEW_VERSION\"/" src-tauri/tauri.conf.json
    fi

    # Update version in Cargo.toml
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "s/^version = \"$CURRENT_VERSION\"/version = \"$NEW_VERSION\"/" src-tauri/Cargo.toml
    else
        sed -i "s/^version = \"$CURRENT_VERSION\"/version = \"$NEW_VERSION\"/" src-tauri/Cargo.toml
    fi

    # Update Cargo.lock
    cd src-tauri && cargo update -p schaltwerk && cd ..

    # Commit version bump
    git add src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock
    git commit -m "chore: bump version to $NEW_VERSION"

    # Create and push tag
    git tag "v$NEW_VERSION"

    echo "Pushing to remote..."
    git push origin HEAD
    git push origin "v$NEW_VERSION"

    echo "Release v$NEW_VERSION created successfully!"
    echo ""
    echo "GitHub Actions will now:"
    echo "  - Build universal macOS binary"
    echo "  - Build Linux DEB, RPM, and AppImage packages"
    echo "  - Create GitHub release"
    echo "  - Update Homebrew tap"
    echo ""
    echo "Monitor progress at:"
    echo "  https://github.com/2mawi2/schaltwerk/actions"

# Setup dependencies for development
setup:
    #!/usr/bin/env bash
    set -euo pipefail
    echo "Installing dependencies..."
    {{pm}} install
    # Setup MCP server if it exists
    if [ -d "mcp-server" ]; then
        echo "Setting up MCP server..."
        cd mcp-server
        node ../scripts/package-manager.mjs install
        cd ..
        echo "MCP server dependencies installed"
    fi

    echo "Setup complete! You can now run 'just install' to build and install the app"

# Install the application on macOS (builds and installs to /Applications)
install:
    #!/usr/bin/env bash
    set -euo pipefail

    echo "Building Schaltwerk for macOS..."

    # Check if node_modules exists, if not run setup first
    if [ ! -d "node_modules" ]; then
        echo "Dependencies not found. Running setup first..."
        just setup
    fi

    # Build frontend
    echo "Building frontend..."
    {{pm}} run build
    # Build MCP server if it exists
    if [ -d "mcp-server" ]; then
        echo "Building MCP server..."
        cd mcp-server
        # Ensure clean, reproducible deps before building (dev deps required for tsc)
        echo "Installing MCP server dependencies (lockfile)..."
        node ../scripts/package-manager.mjs install --frozen-lockfile
        # Build TypeScript sources
        node ../scripts/package-manager.mjs run build
        # Re-install with production-only deps for embedding inside the app bundle
        node ../scripts/package-manager.mjs install --production --frozen-lockfile
        cd ..
        echo "MCP server built"
    fi

    # Build Tauri application for release
    echo "Building Tauri app..."
    {{pm}} run tauri -- build
    
    # Find the built app bundle (handle different architectures)
    APP_PATH=""
    if [ -d "src-tauri/target/release/bundle/macos/Schaltwerk.app" ]; then
        APP_PATH="src-tauri/target/release/bundle/macos/Schaltwerk.app"
    elif [ -d "src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Schaltwerk.app" ]; then
        APP_PATH="src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Schaltwerk.app"
    elif [ -d "src-tauri/target/x86_64-apple-darwin/release/bundle/macos/Schaltwerk.app" ]; then
        APP_PATH="src-tauri/target/x86_64-apple-darwin/release/bundle/macos/Schaltwerk.app"
    elif [ -d "src-tauri/target/universal-apple-darwin/release/bundle/macos/Schaltwerk.app" ]; then
        APP_PATH="src-tauri/target/universal-apple-darwin/release/bundle/macos/Schaltwerk.app"
    fi
    
    if [ -z "$APP_PATH" ] || [ ! -d "$APP_PATH" ]; then
        echo "Build failed - Schaltwerk.app not found"
        echo "Searched in:"
        echo "  - src-tauri/target/release/bundle/macos/"
        echo "  - src-tauri/target/aarch64-apple-darwin/release/bundle/macos/"
        echo "  - src-tauri/target/x86_64-apple-darwin/release/bundle/macos/"
        echo "  - src-tauri/target/universal-apple-darwin/release/bundle/macos/"
        exit 1
    fi

    echo "Found app bundle at: $APP_PATH"

    # Embed MCP server if it was built
    if [ -d "mcp-server/build" ]; then
        MCP_DIR="$APP_PATH/Contents/Resources/mcp-server"
        mkdir -p "$MCP_DIR"
        cp -R mcp-server/build "$MCP_DIR/"
        cp mcp-server/package.json "$MCP_DIR/"
        cp -R mcp-server/node_modules "$MCP_DIR/"
        echo "MCP server embedded in app bundle"
    fi

    # Always install to /Applications for simplicity
    INSTALL_DIR="/Applications"

    # Remove old installation if it exists
    if [ -d "$INSTALL_DIR/Schaltwerk.app" ]; then
        echo "Removing existing Schaltwerk installation..."
        echo "Admin password required to remove old installation"
        sudo rm -rf "$INSTALL_DIR/Schaltwerk.app"
    fi

    # Copy the app to Applications
    echo "Installing Schaltwerk to $INSTALL_DIR..."
    echo "Admin password required for installation"
    sudo cp -R "$APP_PATH" "$INSTALL_DIR/"

    # Set proper permissions
    sudo chmod -R 755 "$INSTALL_DIR/Schaltwerk.app"

    # Clear quarantine attributes to avoid Gatekeeper issues
    sudo xattr -cr "$INSTALL_DIR/Schaltwerk.app" 2>/dev/null || true

    echo "Schaltwerk installed successfully!"
    echo ""
    echo "Launch Schaltwerk:"
    echo "  - From Spotlight: Press Cmd+Space and type 'Schaltwerk'"
    echo "  - From Terminal: open /Applications/Schaltwerk.app"

# Find an available port starting from a base port
_find_available_port base_port:
    #!/usr/bin/env bash
    port={{base_port}}
    while lsof -i :$port >/dev/null 2>&1; do
        port=$((port + 1))
    done
    echo $port

# Run the application in development mode with auto port detection (optimized for FASTEST compilation)
run:
    #!/usr/bin/env bash
    set -euo pipefail

    # Get the directory containing this justfile
    cd "{{justfile_directory()}}"

    # Verify we're in the correct directory
    if [[ ! -f "package.json" ]]; then
        echo "Error: Not in project root directory (no package.json found)"
        echo "Current directory: $(pwd)"
        exit 1
    fi

    echo "Working from project root: $(pwd)"

    # Get current git branch for display
    branch=$(git branch --show-current 2>/dev/null || echo "no-branch")

    # Find available port starting from 1420
    port=$(just _find_available_port 1420)
    echo "Starting Schaltwerk on port $port (branch: $branch)"
    echo "Using dev profile (opt-level=0) for fastest compilation"

    # Enable all available speed optimizations
    if command -v sccache &> /dev/null; then
        echo "Using sccache for Rust compilation caching"
        export RUSTC_WRAPPER=sccache
        export SCCACHE_DIR=$HOME/.cache/sccache
    fi
    
    # Export the port for Vite
    export VITE_PORT=$port
    
    # Create temporary config override for Tauri to use the dynamic port
    temp_config=$(mktemp)
    cat > "$temp_config" <<EOF
    {
      "build": {
        "devUrl": "http://localhost:$port",
        "beforeDevCommand": "node scripts/package-manager.mjs run dev",
        "beforeBuildCommand": "node scripts/package-manager.mjs run build",
        "frontendDist": "../dist"
      }
    }
    EOF
    
    # Cleanup function to remove temp config
    cleanup() {
        rm -f "$temp_config"
    }
    
    # Set trap to cleanup on exit
    trap cleanup EXIT
    
    # Set the application's starting directory to HOME
    # This ensures Schaltwerk starts without opening a project
    export SCHALTWERK_START_DIR="$HOME"
    
    # Start with dev profile (Tauri doesn't support custom profiles in dev mode)
    # The dev profile already has reasonable optimization settings
    TAURI_SKIP_DEVSERVER_CHECK=true {{pm}} run tauri -- dev --config "$temp_config"

# Run only the frontend (Vite dev server) on auto-detected port
run-frontend:
    #!/usr/bin/env bash
    set -euo pipefail

    port=$(just _find_available_port 1420)
    echo "Starting frontend on port $port"

    export VITE_PORT=$port
    {{pm}} run dev

# Run only the backend (Tauri/Rust)
run-backend:
    #!/usr/bin/env bash
    cd src-tauri
    cargo run

# Run frontend and backend separately in parallel
run-split:
    #!/usr/bin/env bash
    set -euo pipefail

    port=$(just _find_available_port 1420)
    echo "Starting split mode - Frontend: $port, Backend: separate process"

    # Start frontend in background
    VITE_PORT=$port {{pm}} run dev &
    frontend_pid=$!

    # Wait a moment for frontend to start
    sleep 2

    # Start backend
    echo "Starting Rust backend..."
    cd src-tauri
    FRONTEND_URL="http://localhost:$port" cargo run &
    backend_pid=$!

    # Handle cleanup on exit
    trap "echo 'Stopping services...'; kill $frontend_pid $backend_pid 2>/dev/null || true" EXIT

    echo "Services running - Frontend: http://localhost:$port"
    echo "Press Ctrl+C to stop both services"

    # Wait for either process to exit
    wait

# Run on a specific port (uses pre-built release binary if available, no hot-reload)
run-port port:
    #!/usr/bin/env bash
    set -euo pipefail

    if lsof -i :{{port}} >/dev/null 2>&1; then
        echo "Port {{port}} is already in use"
        exit 1
    fi

    echo "Starting Schaltwerk on port {{port}} (no hot-reload mode)"

    # Check if release binary exists
    PROJECT_ROOT="$(pwd)"
    BINARY_PATH="$PROJECT_ROOT/src-tauri/target/release/schaltwerk"

    # Check shared target first
    if [ -f "/tmp/schaltwerk-shared-target/release/schaltwerk" ]; then
        BINARY_PATH="/tmp/schaltwerk-shared-target/release/schaltwerk"
    fi

    if [ ! -f "$BINARY_PATH" ]; then
        echo "No release binary found. Building one first..."
        echo "   This will take a few minutes but only needs to be done once."
        {{pm}} run build
        {{pm}} run tauri -- build
        # Re-check for binary after build
        if [ -f "/tmp/schaltwerk-shared-target/release/schaltwerk" ]; then
            BINARY_PATH="/tmp/schaltwerk-shared-target/release/schaltwerk"
        elif [ ! -f "$BINARY_PATH" ]; then
            echo "Error: Binary not found after build"
            exit 1
        fi
    else
        echo "Using existing release binary (no hot-reload)"
        echo "   To force rebuild, run: just run-port-release {{port}}"
    fi
    
    # Export the port
    export VITE_PORT={{port}}
    export PORT={{port}}
    
    # Set the application's starting directory to HOME
    export SCHALTWERK_START_DIR="$HOME"
    
    # Run the release binary
    cd "$HOME" && VITE_PORT={{port}} PORT={{port}} PARA_REPO_PATH="$PROJECT_ROOT" "$BINARY_PATH"

# Run on a specific port with hot-reload (development mode with production-like performance)
run-port-dev port:
    #!/usr/bin/env bash
    set -euo pipefail

    if lsof -i :{{port}} >/dev/null 2>&1; then
        echo "Port {{port}} is already in use"
        exit 1
    fi

    echo "Starting Schaltwerk on port {{port}} (WITH hot-reload - dev mode)"
    echo "Using standard dev profile (opt-level=0) for fast compilation"

    # Create temporary config override
    temp_config=$(mktemp)
    cat > "$temp_config" <<EOF
    {
      "build": {
        "devUrl": "http://localhost:{{port}}",
        "beforeDevCommand": "node scripts/package-manager.mjs run dev",
        "beforeBuildCommand": "node scripts/package-manager.mjs run build",
        "frontendDist": "../dist"
      }
    }
    EOF

    # Export the port for Vite
    export VITE_PORT={{port}}
    export PORT={{port}}

    # Set the application's starting directory to HOME
    export SCHALTWERK_START_DIR="$HOME"

    # Cleanup function to remove temp config
    cleanup() {
        echo "Cleaning up temporary config..."
        rm -f "$temp_config"
    }

    # Set trap to cleanup on exit
    trap cleanup EXIT

    # Start Tauri with config override (standard dev profile for production-like performance)
    {{pm}} run tauri -- dev --config "$temp_config"

# Build the application for production
build:
    {{pm}} run build && {{pm}} run tauri -- build


# Build and run the application in production mode
run-build:
    {{pm}} run build && {{pm}} run tauri -- build && ./src-tauri/target/release/schaltwerk

# Run all tests and lints (uses dev-fast profile for FASTEST compilation)
test:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        echo "Running full test suite on Linux..."
        just _ensure-linux-rust-deps
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        echo "Running full test suite on macOS..."
    else
        echo "Unsupported platform for testing: $OSTYPE"
        echo "   Supported: Linux, macOS"
        exit 1
    fi
    {{pm}} run test


# Run only frontend tests (TypeScript, linting, unit tests)
test-frontend:
    npm run lint && npm run lint:ts && npm run test:frontend

# Run the application using the compiled release binary (no autoreload)
run-release:
    #!/usr/bin/env bash
    set -euo pipefail
    echo "Building Schaltwerk (release bundle, no auto-reload)..."
    {{pm}} run build
    {{pm}} run tauri -- build
    echo "Build complete. Launching binary from HOME directory..."
    # Always start from HOME directory when using 'just run' commands
    # Pass repository path explicitly so backend can discover it even from packaged runs
    PROJECT_ROOT="$(pwd)"

    # Check for binary in shared target directory first, then fallback to local
    BINARY_PATH="/tmp/schaltwerk-shared-target/release/schaltwerk"
    if [ ! -f "$BINARY_PATH" ]; then
        BINARY_PATH="$PROJECT_ROOT/src-tauri/target/release/schaltwerk"
    fi

    if [ ! -f "$BINARY_PATH" ]; then
        echo "Error: Binary not found at $BINARY_PATH"
        exit 1
    fi

    cd "$HOME" && PARA_REPO_PATH="$PROJECT_ROOT" "$BINARY_PATH"

# Build and run the application in release mode with a specific port
# This builds fresh like 'just run' does, but creates a release build
run-port-release port:
    #!/usr/bin/env bash
    set -euo pipefail
    echo "Building Schaltwerk release on port {{port}}..."

    # Export port for any runtime components that need it
    export VITE_PORT={{port}}
    export PORT={{port}}

    # Clean old binaries to force rebuild (check both shared and local target dirs)
    echo "Cleaning old release binaries..."
    rm -f ./src-tauri/target/release/schaltwerk
    rm -f ./src-tauri/target/release/ui
    rm -f /tmp/schaltwerk-shared-target/release/schaltwerk

    # Build frontend
    echo "Building frontend..."
    {{pm}} run build

    # Build Tauri app properly (this embeds the frontend assets)
    echo "Building Tauri app (with frontend embedded)..."
    {{pm}} run tauri -- build

    echo "Build complete. Launching release binary from HOME directory..."
    # Always start from HOME directory when using 'just run' commands
    # The tauri build creates the binary with the productName from tauri.conf.json
    # Pass repository path explicitly so backend can discover it
    PROJECT_ROOT="$(pwd)"

    # Check for binary in shared target directory first, then fallback to local
    BINARY_PATH="/tmp/schaltwerk-shared-target/release/schaltwerk"
    if [ ! -f "$BINARY_PATH" ]; then
        BINARY_PATH="$PROJECT_ROOT/src-tauri/target/release/schaltwerk"
    fi

    if [ ! -f "$BINARY_PATH" ]; then
        echo "Error: Binary not found at $BINARY_PATH"
        exit 1
    fi

    cd "$HOME" && VITE_PORT={{port}} PORT={{port}} PARA_REPO_PATH="$PROJECT_ROOT" "$BINARY_PATH"

# Cross-platform setup commands

# Cross-platform setup (auto-detect OS)
setup-cross-platform:
    #!/usr/bin/env bash
    set -euo pipefail

    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        echo "Detected Linux - running Linux-specific setup"
        just setup-linux
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        echo "Detected macOS - running standard setup"
        just setup
    else
        echo "Unsupported platform: $OSTYPE"
        exit 1
    fi

# Cross-platform install (auto-detect OS)
install-cross-platform:
    #!/usr/bin/env bash
    set -euo pipefail

    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        echo "Detected Linux - running Linux installation"
        just install-linux
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        echo "Detected macOS - running macOS installation"
        just install
    else
        echo "Unsupported platform: $OSTYPE"
        exit 1
    fi

# Linux-specific commands

# Check Linux build dependencies
check-linux-deps:
    #!/usr/bin/env bash
    echo "Checking Linux build dependencies..."
    echo ""
    which pkg-config > /dev/null 2>&1 && echo "[OK] pkg-config" || echo "[MISSING] pkg-config"
    pkg-config --exists webkit2gtk-4.1 2>/dev/null && echo "[OK] libwebkit2gtk-4.1-dev" || echo "[MISSING] libwebkit2gtk-4.1-dev"
    pkg-config --exists gtk+-3.0 2>/dev/null && echo "[OK] libgtk-3-dev" || echo "[MISSING] libgtk-3-dev"
    echo ""
    echo "To install missing dependencies:"
    echo "  Ubuntu/Debian: sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev patchelf"
    echo "  Fedora:        sudo dnf install webkit2gtk4.1-devel gtk3-devel libappindicator-gtk3-devel librsvg2-devel"
    echo "  Arch:          sudo pacman -S webkit2gtk-4.1 gtk3 libappindicator-gtk3 librsvg"

# Ensure Linux has the GTK stack required for Rust builds/tests
_ensure-linux-rust-deps:
    #!/usr/bin/env bash
    set -euo pipefail
    if ! command -v pkg-config >/dev/null 2>&1; then
        echo "ERROR: pkg-config not found. Install GTK build dependencies first."
        echo "   Run 'just check-linux-deps' for guidance."
        exit 1
    fi
    missing=()
    for pkg in gtk+-3.0 gdk-3.0 pango cairo atk; do
        if ! pkg-config --exists "$pkg"; then
            missing+=("$pkg")
        fi
    done
    if [ ${#missing[@]} -ne 0 ]; then
        echo "ERROR: Missing Linux GTK dependencies: ${missing[*]}"
        echo "   Run 'just check-linux-deps' for installation hints."
        exit 1
    fi

# Setup Linux-specific dependencies (from spec milestone 1)
setup-linux:
    #!/usr/bin/env bash
    set -euo pipefail

    echo "Setting up Linux development dependencies..."

    # Detect distribution and install GTK/WebKit stack
    if [ -f /etc/debian_version ]; then
        echo "Detected Debian/Ubuntu-based system"
        sudo apt-get update
        sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev patchelf
    elif [ -f /etc/redhat-release ]; then
        echo "Detected Red Hat-based system"
        sudo dnf install -y webkit2gtk4.1-devel gtk3-devel libappindicator-gtk3-devel librsvg2-devel patchelf
    elif [ -f /etc/arch-release ]; then
        echo "Detected Arch-based system"
        sudo pacman -S --needed webkit2gtk gtk3 libappindicator-gtk3 librsvg patchelf
    else
        echo "WARNING: Unknown distribution. Please install GTK and WebKit dependencies manually."
        echo "   Required: libwebkit2gtk-4.1-dev, libgtk-3-dev, libayatana-appindicator3-dev, librsvg2-dev, patchelf"
        exit 1
    fi

    echo "Linux dependencies installed"

# Install built binary to ~/.local/bin (Linux XDG standard)
install-linux:
    #!/usr/bin/env bash
    set -euo pipefail
    echo "Building Schaltwerk for Linux..."
    cargo build --release --manifest-path src-tauri/Cargo.toml
    echo "Installing to ~/.local/bin..."
    mkdir -p ~/.local/bin
    mkdir -p ~/.local/share/applications
    mkdir -p ~/.local/share/icons/hicolor/128x128/apps
    cp src-tauri/target/release/schaltwerk ~/.local/bin/
    cp src-tauri/icons/128x128.png ~/.local/share/icons/hicolor/128x128/apps/schaltwerk.png
    echo "#!/usr/bin/env xdg-open" > ~/.local/share/applications/schaltwerk.desktop
    echo "[Desktop Entry]" >> ~/.local/share/applications/schaltwerk.desktop
    echo "Type=Application" >> ~/.local/share/applications/schaltwerk.desktop
    echo "Name=Schaltwerk" >> ~/.local/share/applications/schaltwerk.desktop
    echo "Exec=schaltwerk" >> ~/.local/share/applications/schaltwerk.desktop
    echo "Icon=schaltwerk" >> ~/.local/share/applications/schaltwerk.desktop
    echo "Categories=Development;" >> ~/.local/share/applications/schaltwerk.desktop
    chmod +x ~/.local/share/applications/schaltwerk.desktop
    echo "Installed to ~/.local/bin/schaltwerk"
    echo "Desktop entry: ~/.local/share/applications/schaltwerk.desktop"

# Build all Linux packages (AppImage, deb, rpm)
build-linux:
    #!/usr/bin/env bash
    set -euo pipefail
    echo "Building all Linux packages..."
    npm run tauri build -- --bundles appimage,deb,rpm
    echo "Build complete!"
    echo "Packages created:"
    ls -lh src-tauri/target/release/bundle/ 2>/dev/null || echo "No bundle directory found"

# Build Linux AppImage
build-linux-appimage:
    npm run tauri build -- --bundles appimage
    @echo "AppImage created in src-tauri/target/release/bundle/appimage/"

# Build Linux .deb package
build-linux-deb:
    npm run tauri build -- --bundles deb
    @echo ".deb package created in src-tauri/target/release/bundle/deb/"

# Build Linux .rpm package
build-linux-rpm:
    npm run tauri build -- --bundles rpm
    @echo ".rpm package created in src-tauri/target/release/bundle/rpm/"

# Run with Wayland debugging enabled
run-wayland:
    #!/usr/bin/env bash
    set -euo pipefail
    echo "Starting Schaltwerk with Wayland debugging..."
    WAYLAND_DEBUG=1 WAYLAND_DISPLAY=wayland-0 RUST_LOG=schaltwerk=debug npm run tauri:dev

# Force X11 backend (fallback mode)
run-x11:
    #!/usr/bin/env bash
    set -euo pipefail
    echo "Starting Schaltwerk with X11 backend..."
    GDK_BACKEND=x11 npm run tauri:dev
