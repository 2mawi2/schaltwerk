#!/usr/bin/env bash
set -euo pipefail

echo "🚀 Setting up fast build optimizations for Schaltwerk"
echo ""

OS=$(uname -s)
ARCH=$(uname -m)

install_if_missing() {
    local cmd=$1
    local install_cmd=$2
    local description=$3

    if command -v "$cmd" &> /dev/null; then
        echo "✅ $description already installed"
        return 0
    fi

    echo "📦 Installing $description..."
    eval "$install_cmd"

    if command -v "$cmd" &> /dev/null; then
        echo "✅ $description installed successfully"
    else
        echo "⚠️  $description installation may require manual setup"
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
        echo "❌ Homebrew not found. Please install it first: https://brew.sh"
        exit 1
    fi

    install_if_missing "sccache" "brew install sccache" "sccache (Rust compilation cache)"

    echo ""
    echo "📝 Note: On macOS, the default linker (ld64) is well-optimized."
    echo "   For maximum speed, consider using lld from LLVM:"
    echo "   brew install llvm"
    echo ""

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
        echo "⚠️  Unknown package manager. Please install manually:"
        echo "   - mold: https://github.com/rui314/mold"
        echo "   - sccache: cargo install sccache"
    fi
fi

echo ""
echo "=== Setting up Cranelift (Optional - Nightly Only) ==="
echo ""

if rustup toolchain list | grep -q "nightly"; then
    echo "✅ Rust nightly toolchain already installed"
else
    echo "📦 Installing Rust nightly toolchain..."
    rustup toolchain install nightly
fi

echo "📦 Installing Cranelift codegen backend..."
rustup component add rustc-codegen-cranelift-preview --toolchain nightly 2>/dev/null || {
    echo "⚠️  Cranelift not available for your platform/nightly version"
    echo "   This is optional - builds will still be fast without it"
}

echo ""
echo "=== Configuring sccache ==="
echo ""

SCCACHE_DIR="${SCCACHE_DIR:-$HOME/.cache/sccache}"
mkdir -p "$SCCACHE_DIR"

if [[ -f "$HOME/.cargo/config.toml" ]]; then
    if ! grep -q "RUSTC_WRAPPER" "$HOME/.cargo/config.toml" 2>/dev/null; then
        echo ""
        echo "📝 To enable sccache globally, add to ~/.cargo/config.toml:"
        echo ""
        echo '  [build]'
        echo '  rustc-wrapper = "sccache"'
        echo ""
    fi
fi

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Build optimization tools installed! Usage:"
echo ""
echo "  Standard dev build (stable):"
echo "    bun run tauri:dev"
echo ""
echo "  Fast dev build with Cranelift (nightly, ~50% faster):"
echo "    cargo +nightly build-fast"
echo ""
echo "  Enable sccache for current session:"
echo "    export RUSTC_WRAPPER=sccache"
echo ""
echo "  Check sccache stats:"
echo "    sccache --show-stats"
echo ""

if [[ "$OS" == "Linux" ]]; then
    echo "  Linux: mold linker is auto-configured in .cargo/config.toml"
    echo ""
fi

echo "Expected improvements:"
echo "  - Cold builds: ~30-50% faster with sccache + linker"
echo "  - Warm builds: ~50-75% faster with Cranelift"
echo "  - Incremental: Already optimized in Cargo.toml"
echo ""
