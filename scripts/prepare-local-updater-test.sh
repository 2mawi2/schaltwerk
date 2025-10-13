#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${BASH_VERSINFO:-}" || "${BASH_VERSINFO[0]}" -lt 4 ]]; then
  echo "⚠️  Running with legacy bash ${BASH_VERSION:-unknown}; proceeding with compatibility mode." >&2
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")"/.. && pwd)"
cd "$REPO_ROOT"

KEY_PATH="${TAURI_UPDATER_PRIVATE_KEY_PATH:-}"
if [[ -z "$KEY_PATH" ]]; then
  DEFAULT_HOME="$HOME/.schaltwerk/schaltwerk-updater.key"
  DEFAULT_REPO="$REPO_ROOT/updater-private.key"

  if [[ -f "$DEFAULT_HOME" ]]; then
    KEY_PATH="$DEFAULT_HOME"
  elif [[ -f "$DEFAULT_REPO" ]]; then
    KEY_PATH="$DEFAULT_REPO"
    echo "Using updater key from $KEY_PATH" >&2
  fi
fi

if [[ ! -f "$KEY_PATH" ]]; then
  echo "Updater private key not found at $KEY_PATH" >&2
  echo "Set TAURI_UPDATER_PRIVATE_KEY_PATH or place the key in repo root as updater-private.key." >&2
  exit 1
fi

KEY_PASSWORD="${TAURI_UPDATER_PRIVATE_KEY_PASSWORD:-${SCHALTWERK_UPDATER_PRIVATE_KEY_PASSWORD:-${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}}}"
if [[ -z "$KEY_PASSWORD" ]]; then
  PASSWORD_FILE="$HOME/.schaltwerk/schaltwerk-updater-password.txt"
  if [[ -f "$PASSWORD_FILE" ]]; then
    KEY_PASSWORD="$(tr -d '\r\n' <"$PASSWORD_FILE")"
  fi
fi
if [[ -z "$KEY_PASSWORD" ]]; then
  if head -n 1 "$KEY_PATH" | grep -qi 'encrypted'; then
    read -rsp "Enter updater private key password: " KEY_PASSWORD
    echo
    if [[ -z "$KEY_PASSWORD" ]]; then
      echo "No password provided; set TAURI_UPDATER_PRIVATE_KEY_PASSWORD to avoid the prompt." >&2
      exit 1
    fi
  fi
fi

PORT=${TAURI_UPDATER_TEST_PORT:-4000}

ORIGINAL_VERSION=$(node -p "require('./src-tauri/tauri.conf.json').version")
if [[ -z "${ORIGINAL_VERSION}" ]]; then
  echo "Unable to read current version from tauri.conf.json" >&2
  exit 1
fi

bump_patch() {
  python3 - "$1" <<'PY'
import sys
version = sys.argv[1]
parts = version.split('.')
if len(parts) != 3:
    print(version)
    sys.exit()
try:
    major, minor, patch = map(int, parts)
except ValueError:
    print(version)
    sys.exit()
patch += 1
print(f"{major}.{minor}.{patch}")
PY
}

TARGET_VERSION=${1:-}
if [[ -z "$TARGET_VERSION" ]]; then
  TARGET_VERSION=$(bump_patch "$ORIGINAL_VERSION")
fi

WORK_DIR="dist/local-updater-test"
WORK_DIR_ABS="$REPO_ROOT/$WORK_DIR"
rm -rf "$WORK_DIR_ABS"
mkdir -p "$WORK_DIR_ABS"

BACKUP_DIR=$(mktemp -d)
RESTORE_FILES=("src-tauri/tauri.conf.json" "src-tauri/Cargo.toml" "src-tauri/Cargo.lock")
for file in "${RESTORE_FILES[@]}"; do
  cp "$file" "$BACKUP_DIR/$(basename "$file")"
done

DONE=false
cleanup() {
  if [[ "$DONE" == true ]]; then
    return
  fi
  for file in "${RESTORE_FILES[@]}"; do
    cp "$BACKUP_DIR/$(basename "$file")" "$file"
  done
  rm -rf "$BACKUP_DIR"
}
trap cleanup EXIT

TARGET_VERSION="$TARGET_VERSION" node <<'JS'
const fs = require('fs')
const path = require('path')
const target = process.env.TARGET_VERSION
const file = path.join('src-tauri', 'tauri.conf.json')
const json = JSON.parse(fs.readFileSync(file, 'utf8'))
json.version = target
fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n')
JS

TARGET_VERSION="$TARGET_VERSION" python3 <<'PY'
import pathlib
import re
import os
version = os.environ['TARGET_VERSION']
file = pathlib.Path('src-tauri/Cargo.toml')
content = file.read_text()
content = re.sub(r'(?m)^version = "[^"]+"$', f'version = "{version}"', content, count=1)
file.write_text(content)
PY

( cd src-tauri && cargo update -p schaltwerk --precise "$TARGET_VERSION" >/dev/null )

echo "Building macOS bundle for version $TARGET_VERSION (this may take a few minutes)..."

node scripts/package-manager.mjs run tauri -- build --target aarch64-apple-darwin >/dev/null

ARM_PATH="src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Schaltwerk.app"
if [[ ! -d "$ARM_PATH" ]]; then
  echo "Expected app bundle not found: $ARM_PATH" >&2
  exit 1
fi

TMP_BUILD="$WORK_DIR_ABS/aarch64"
rm -rf "$TMP_BUILD"
mkdir -p "$TMP_BUILD"
cp -R "$ARM_PATH" "$TMP_BUILD/Schaltwerk.app"

ARCHIVE_NAME="Schaltwerk-${TARGET_VERSION}-macos-aarch64.app.tar.gz"
ARCHIVE_PATH="$WORK_DIR_ABS/$ARCHIVE_NAME"
( cd "$TMP_BUILD" && tar -czf "$ARCHIVE_PATH" Schaltwerk.app )

SIGN_ARGS=(signer sign "$ARCHIVE_PATH" --private-key-path "$KEY_PATH")
if [[ -n "$KEY_PASSWORD" ]]; then
  SIGN_ARGS+=(--password "$KEY_PASSWORD")
fi

SIGNATURE=$(node scripts/package-manager.mjs run tauri -- "${SIGN_ARGS[@]}" | awk '/Public signature:/{getline; gsub(/\r/, ""); print}' | tr -d '\n')
rm -f "$ARCHIVE_PATH.sig"

PUB_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
cat > "$WORK_DIR_ABS/latest.json" <<JSON
{
  "version": "$TARGET_VERSION",
  "pub_date": "$PUB_DATE",
  "notes": "Local updater smoke test build",
  "platforms": {
    "darwin-aarch64-app": {
      "signature": "$SIGNATURE",
      "url": "http://127.0.0.1:${PORT}/${ARCHIVE_NAME}"
    },
    "darwin-aarch64": {
      "signature": "$SIGNATURE",
      "url": "http://127.0.0.1:${PORT}/${ARCHIVE_NAME}"
    }
  }
}
JSON

WORK_DIR_ABS="$WORK_DIR_ABS" PORT="$PORT" node <<'JS'
const fs = require('fs')
const path = require('path')
const port = process.env.PORT
const workDir = process.env.WORK_DIR_ABS
const base = JSON.parse(fs.readFileSync(path.join('src-tauri', 'tauri.conf.json'), 'utf8'))
base.plugins = base.plugins || {}
base.plugins.updater = base.plugins.updater || {}
base.plugins.updater.endpoints = [`http://127.0.0.1:${port}/latest.json`]
base.plugins.updater.dangerousInsecureTransportProtocol = true
fs.writeFileSync(path.join(workDir, 'tauri.local-updater.json'), JSON.stringify(base, null, 2) + '\n')
JS

cat > "$WORK_DIR_ABS/README.md" <<EOF
# Local Updater Smoke Test

Artifacts for version **$TARGET_VERSION** are ready in:

    $WORK_DIR_ABS

## 1. Launch the HTTP server
```
cd $WORK_DIR_ABS
python3 -m http.server $PORT
```

## 2. Run Schaltwerk against the test manifest
```
TAURI_CONFIG_PATH="$WORK_DIR_ABS/tauri.local-updater.json" node scripts/package-manager.mjs run tauri -- dev
```

Automatic updates will run on startup; you can also open **Settings → Version** and press “Check for updates”.

## 3. Cleanup
- Stop the HTTP server when finished.
- Remove the directory if you no longer need the artifacts.
- Repository files were restored to version $ORIGINAL_VERSION automatically.
EOF

cleanup
DONE=true
trap - EXIT

cat <<EOF
Local updater test artifacts written to: $WORK_DIR_ABS
- Launch server:   (cd $WORK_DIR_ABS && python3 -m http.server $PORT)
- Dev config path: $WORK_DIR_ABS/tauri.local-updater.json
Run dev app with:  TAURI_CONFIG_PATH=$WORK_DIR_ABS/tauri.local-updater.json node scripts/package-manager.mjs run tauri -- dev
EOF
