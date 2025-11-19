#!/usr/bin/env bash
set -euo pipefail

PORT=${1:-3212}

echo "🚀 Building Schaltwerk on port $PORT (fresh release build)"

export VITE_PORT=$PORT
export PORT=$PORT

# Clean old binary to force rebuild
echo "🧹 Cleaning old release binary..."
rm -f ./src-tauri/target/release/schaltwerk

# Enable sccache if available for faster Rust builds
if command -v sccache &> /dev/null; then
    echo "✨ Using sccache for Rust compilation caching"
    export RUSTC_WRAPPER=sccache
    export SCCACHE_DIR=$HOME/.cache/sccache
fi

# Build frontend
echo "📦 Building frontend..."
node scripts/package-manager.mjs run build

# Build rust with release profile
echo "🦀 Building Tauri app with release profile..."
cd src-tauri && cargo build --release
cd ..

echo "✅ Build complete! Starting application..."
VITE_PORT=$PORT PORT=$PORT PARA_REPO_PATH="$(pwd)" ./src-tauri/target/release/schaltwerk
