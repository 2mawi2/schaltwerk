#!/usr/bin/env bash
set -euo pipefail

echo "Setting up fast build optimizations for Schaltwerk"
echo ""

OS=$(uname -s)
ARCH=$(uname -m)

install_if_missing() {
    local cmd=$1
    local install_cmd=$2
    local description=$3

    if command -v "$cmd" &> /dev/null; then
        echo "[ok] $description already installed"
        return 0
    fi

    echo "[install] $description..."
    eval "$install_cmd"

    if command -v "$cmd" &> /dev/null; then
        echo "[ok] $description installed successfully"
    else
        echo "[warn] $description installation may require manual setup"
    fi
}

echo "=== System Information ==="
echo "OS: $OS"
echo "Architecture: $ARCH"
echo ""

echo "=== Installing Build Optimization Tools ==="
echo ""

if [[ "$OS" == "Darwin" ]]; then
    if ! command -v brew &> /dev/null; then
        echo "[error] Homebrew not found. Please install it first: https://brew.sh"
        exit 1
    fi

    install_if_missing "sccache" "brew install sccache" "sccache (Rust compilation cache)"

elif [[ "$OS" == "Linux" ]]; then
    if command -v apt-get &> /dev/null; then
        install_if_missing "mold" "sudo apt-get install -y mold" "mold (fast linker)"
        install_if_missing "sccache" "sudo apt-get install -y sccache" "sccache (Rust compilation cache)"
    elif command -v dnf &> /dev/null; then
        install_if_missing "mold" "sudo dnf install -y mold" "mold (fast linker)"
        install_if_missing "sccache" "sudo dnf install -y sccache" "sccache (Rust compilation cache)"
    elif command -v pacman &> /dev/null; then
        install_if_missing "mold" "sudo pacman -S --noconfirm mold" "mold (fast linker)"
        install_if_missing "sccache" "sudo pacman -S --noconfirm sccache" "sccache (Rust compilation cache)"
    else
        echo "[warn] Unknown package manager. Please install manually:"
        echo "   - mold: https://github.com/rui314/mold"
        echo "   - sccache: cargo install sccache"
    fi
fi

echo ""
echo "=== Starting sccache ==="
echo ""

if command -v sccache &> /dev/null; then
    sccache --stop-server 2>/dev/null || true
    sccache --start-server
    echo "[ok] sccache server started"
    echo ""
    echo "sccache is configured in .cargo/config.toml"
    echo "All cargo builds will automatically use sccache"
else
    echo "[warn] sccache not found - builds will work but won't be cached"
fi

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Measured improvements:"
echo "  - Rust cold builds: 28% faster with sccache (1m 33s -> 1m 07s)"
echo "  - Frontend builds: 2.7x faster with esbuild (11.4s -> 4.2s)"
echo ""
echo "Usage:"
echo "  bun run tauri:dev     # Development with hot reload"
echo "  bun run build:rust    # Build Rust backend"
echo "  sccache --show-stats  # Check cache statistics"
echo ""

if [[ "$OS" == "Linux" ]]; then
    echo "Linux: mold linker is auto-configured in .cargo/config.toml"
    echo ""
fi
