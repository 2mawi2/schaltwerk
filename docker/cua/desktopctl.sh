#!/usr/bin/env bash
set -euo pipefail

export DISPLAY="${DISPLAY:-:99}"

SOURCE_DIR="${SCHALTWERK_SOURCE_DIR:-/workspace/source}"
APP_DIR="${SCHALTWERK_APP_DIR:-/home/schaltwerk/app}"
RUNTIME_DIR="${SCHALTWERK_RUNTIME_DIR:-/home/schaltwerk/runtime}"
FIXTURE_DIR="${SCHALTWERK_FIXTURE_DIR:-$RUNTIME_DIR/fixture-project}"
PID_FILE="$RUNTIME_DIR/schaltwerk.pid"
LOG_FILE="$RUNTIME_DIR/schaltwerk.log"
COMPUTER_SERVER_PORT="${SCHALTWERK_COMPUTER_SERVER_PORT:-8000}"

mkdir -p "$APP_DIR" "$RUNTIME_DIR"

find_binary() {
    local candidates=(
        "$APP_DIR/src-tauri/target/release/schaltwerk"
        "$APP_DIR/src-tauri/target/x86_64-unknown-linux-gnu/release/schaltwerk"
        "$APP_DIR/src-tauri/target/aarch64-unknown-linux-gnu/release/schaltwerk"
    )

    for candidate in "${candidates[@]}"; do
        if [[ -x "$candidate" ]]; then
            printf '%s\n' "$candidate"
            return 0
        fi
    done

    echo "Schaltwerk binary not found under $APP_DIR" >&2
    return 1
}

window_id() {
    local by_pid=""

    if [[ ! -f "$PID_FILE" ]]; then
        xdotool search --onlyvisible --name "Schaltwerk" | head -n 1
        return 0
    fi

    local pid
    pid="$(cat "$PID_FILE")"
    by_pid="$(xdotool search --onlyvisible --pid "$pid" 2>/dev/null | head -n 1 || true)"
    if [[ -n "$by_pid" ]]; then
        printf '%s\n' "$by_pid"
        return 0
    fi

    xdotool search --onlyvisible --name "Schaltwerk" | head -n 1
}

mouse_button() {
    case "${1:-left}" in
        left) echo 1 ;;
        middle) echo 2 ;;
        right) echo 3 ;;
        *)
            echo "Unsupported mouse button: $1" >&2
            return 1
            ;;
    esac
}

scroll_clicks() {
    python3 - "$@" <<'PY'
import math
import sys

value = abs(int(float(sys.argv[1])))
print(max(1, math.ceil(value / 120)) if value else 0)
PY
}

sync_source() {
    rsync -a --delete \
        --exclude '.git' \
        --exclude '.schaltwerk' \
        --exclude 'coverage' \
        --exclude 'dist' \
        --exclude 'dist-ssr' \
        --exclude 'logs' \
        --exclude 'node_modules' \
        --exclude 'src-tauri/target' \
        --exclude 'target' \
        "$SOURCE_DIR"/ "$APP_DIR"/
}

install_deps() {
    cd "$APP_DIR"
    bun install --frozen-lockfile
    if [[ -d "$APP_DIR/mcp-server" ]]; then
        (
            cd "$APP_DIR/mcp-server"
            bun install --frozen-lockfile
        )
    fi
}

build_app() {
    cd "$APP_DIR"
    bun run tauri -- build --no-bundle
}

reset_app_state() {
    rm -rf "$RUNTIME_DIR/xdg" "$RUNTIME_DIR/home" "$LOG_FILE" "$PID_FILE"
    mkdir -p \
        "$RUNTIME_DIR/xdg/config" \
        "$RUNTIME_DIR/xdg/cache" \
        "$RUNTIME_DIR/xdg/data" \
        "$RUNTIME_DIR/home"
}

prepare_fixture() {
    case "$FIXTURE_DIR" in
        "$RUNTIME_DIR"/*) ;;
        *)
            echo "Fixture directory must be inside $RUNTIME_DIR" >&2
            return 1
            ;;
    esac

    rm -rf "$FIXTURE_DIR"
    mkdir -p "$FIXTURE_DIR"
    git init --initial-branch=main "$FIXTURE_DIR"
    git -C "$FIXTURE_DIR" config user.name "Schaltwerk CUA"
    git -C "$FIXTURE_DIR" config user.email "schaltwerk-cua@example.invalid"
    printf '# Schaltwerk CUA Fixture\n\nDisposable repository for isolated desktop testing.\n' >"$FIXTURE_DIR/README.md"
    mkdir -p "$FIXTURE_DIR/src"
    printf 'export const fixture = true\n' >"$FIXTURE_DIR/src/fixture.ts"
    git -C "$FIXTURE_DIR" add README.md src/fixture.ts
    git -C "$FIXTURE_DIR" commit -m "Initial fixture"
}

stop_app() {
    if [[ ! -f "$PID_FILE" ]]; then
        return 0
    fi

    local pid
    pid="$(cat "$PID_FILE")"
    if kill -0 "$pid" >/dev/null 2>&1; then
        kill "$pid"
    fi
    rm -f "$PID_FILE"
}

launch_app() {
    local binary
    binary="$(find_binary)"

    stop_app

    (
        cd "$APP_DIR"
        env \
            DISPLAY="$DISPLAY" \
            GDK_BACKEND=x11 \
            HOME="$RUNTIME_DIR/home" \
            RUST_LOG="${RUST_LOG:-schaltwerk=info}" \
            XDG_CACHE_HOME="$RUNTIME_DIR/xdg/cache" \
            XDG_CONFIG_HOME="$RUNTIME_DIR/xdg/config" \
            XDG_DATA_HOME="$RUNTIME_DIR/xdg/data" \
            dbus-run-session -- "$binary" "$FIXTURE_DIR" >"$LOG_FILE" 2>&1 &
        echo $! > "$PID_FILE"
    )
}

wait_for_window() {
    local pid=""
    if [[ -f "$PID_FILE" ]]; then
        pid="$(cat "$PID_FILE")"
        if xdotool search --onlyvisible --pid "$pid" >/dev/null 2>&1; then
            return 0
        fi
    fi

    timeout 30s xdotool search --sync --onlyvisible --name "Schaltwerk" >/dev/null
}

wait_for_computer_server() {
    python3 - "$COMPUTER_SERVER_PORT" <<'PY'
import socket
import sys
import time

port = int(sys.argv[1])
deadline = time.time() + 30

while time.time() < deadline:
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=1):
            sys.exit(0)
    except OSError:
        time.sleep(0.2)

raise SystemExit(f"computer-server did not start on port {port}")
PY
}

focus_app() {
    local win
    win="$(window_id)"
    xdotool windowactivate --sync "$win"
}

screenshot() {
    local tmp
    tmp="$(mktemp "$RUNTIME_DIR/screenshot.XXXXXX.png")"
    scrot -z -q 100 "$tmp"
    cat "$tmp"
    rm -f "$tmp"
}

click_cmd() {
    xdotool mousemove "$1" "$2"
    xdotool click "$(mouse_button "$3")"
}

double_click_cmd() {
    xdotool mousemove "$1" "$2"
    xdotool click --repeat 2 --delay 120 "$(mouse_button "$3")"
}

drag_cmd() {
    xdotool mousemove "$1" "$2"
    xdotool mousedown 1
    xdotool mousemove "$3" "$4"
    xdotool mouseup 1
}

scroll_cmd() {
    local x="$1"
    local y="$2"
    local scroll_x="$3"
    local scroll_y="$4"

    xdotool mousemove "$x" "$y"

    local vertical_clicks
    vertical_clicks="$(scroll_clicks "$scroll_y")"
    if [[ "$vertical_clicks" != "0" ]]; then
        local button=5
        if (( scroll_y < 0 )); then
            button=4
        fi
        xdotool click --repeat "$vertical_clicks" "$button"
    fi

    local horizontal_clicks
    horizontal_clicks="$(scroll_clicks "$scroll_x")"
    if [[ "$horizontal_clicks" != "0" ]]; then
        local button=7
        if (( scroll_x < 0 )); then
            button=6
        fi
        xdotool click --repeat "$horizontal_clicks" "$button"
    fi
}

type_cmd() {
    local text
    text="$(printf '%s' "$1" | base64 --decode)"
    xdotool type --clearmodifiers --delay 1 -- "$text"
}

keypress_cmd() {
    xdotool key --clearmodifiers "$1"
}

wait_cmd() {
    python3 - "$1" <<'PY'
import sys
import time

time.sleep(max(0.0, int(sys.argv[1]) / 1000))
PY
}

read_log() {
    local lines="${1:-80}"
    if [[ ! -f "$LOG_FILE" ]]; then
        return 0
    fi
    tail -n "$lines" "$LOG_FILE"
}

status_cmd() {
    local running="no"
    local fixture_head=""
    local fixture_ready="no"
    if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" >/dev/null 2>&1; then
        running="yes"
    fi
    if git -C "$FIXTURE_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
        fixture_ready="yes"
        fixture_head="$(git -C "$FIXTURE_DIR" rev-parse --short HEAD)"
    fi

    cat <<EOF
container_display=$DISPLAY
source_dir=$SOURCE_DIR
app_dir=$APP_DIR
runtime_dir=$RUNTIME_DIR
schaltwerk_running=$running
fixture_repo=$FIXTURE_DIR
fixture_ready=$fixture_ready
fixture_head=$fixture_head
novnc_url=http://127.0.0.1:6080/vnc.html?autoconnect=1
computer_server_url=http://127.0.0.1:$COMPUTER_SERVER_PORT
EOF
}

fixture_status_cmd() {
    git -C "$FIXTURE_DIR" status --short --branch
    git -C "$FIXTURE_DIR" worktree list --porcelain
    find "$FIXTURE_DIR/.schaltwerk/worktrees" -maxdepth 2 -type d -print 2>/dev/null || true
}

case "${1:-}" in
    sync-source)
        sync_source
        ;;
    install-deps)
        install_deps
        ;;
    build-app)
        build_app
        ;;
    reset-app-state)
        reset_app_state
        ;;
    prepare-fixture)
        prepare_fixture
        ;;
    launch-app)
        launch_app
        ;;
    stop-app)
        stop_app
        ;;
    wait-for-window)
        wait_for_window
        ;;
    wait-for-computer-server)
        wait_for_computer_server
        ;;
    focus-app)
        focus_app
        ;;
    screenshot)
        screenshot
        ;;
    click)
        click_cmd "$2" "$3" "${4:-left}"
        ;;
    double-click)
        double_click_cmd "$2" "$3" "${4:-left}"
        ;;
    move)
        xdotool mousemove "$2" "$3"
        ;;
    drag)
        drag_cmd "$2" "$3" "$4" "$5"
        ;;
    scroll)
        scroll_cmd "$2" "$3" "$4" "$5"
        ;;
    type)
        type_cmd "$2"
        ;;
    keypress)
        keypress_cmd "$2"
        ;;
    wait)
        wait_cmd "$2"
        ;;
    read-log)
        read_log "${2:-80}"
        ;;
    status)
        status_cmd
        ;;
    fixture-status)
        fixture_status_cmd
        ;;
    *)
        echo "Usage: desktopctl <sync-source|install-deps|build-app|reset-app-state|prepare-fixture|launch-app|stop-app|wait-for-window|wait-for-computer-server|focus-app|screenshot|click|double-click|move|drag|scroll|type|keypress|wait|read-log|status|fixture-status>" >&2
        exit 1
        ;;
esac
