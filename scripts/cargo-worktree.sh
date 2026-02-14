#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"

if [[ -z "${CARGO_TARGET_DIR:-}" ]]; then
    git_common_dir="$(git -C "$repo_root" rev-parse --git-common-dir)"
    export CARGO_TARGET_DIR="$git_common_dir/schaltwerk-target"
fi

if [[ -z "${CARGO_INCREMENTAL:-}" ]]; then
    export CARGO_INCREMENTAL=1
fi

mkdir -p "$CARGO_TARGET_DIR"

cd "$repo_root/src-tauri"
exec cargo "$@"
