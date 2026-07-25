#!/usr/bin/env bash
set -euo pipefail

export DISPLAY="${DISPLAY:-:99}"

mkdir -p /home/schaltwerk/runtime

display_number="${DISPLAY#:}"
display_lock="/tmp/.X${display_number}-lock"
display_socket="/tmp/.X11-unix/X${display_number}"

if ! xdpyinfo -display "$DISPLAY" >/dev/null 2>&1; then
    rm -f "$display_lock" "$display_socket"
fi

Xvfb "$DISPLAY" -screen 0 1440x900x24 -ac +extension RANDR >/home/schaltwerk/runtime/xvfb.log 2>&1 &
until xdpyinfo -display "$DISPLAY" >/dev/null 2>&1; do
    sleep 0.1
done

openbox >/home/schaltwerk/runtime/openbox.log 2>&1 &
x11vnc -display "$DISPLAY" -forever -shared -nopw -rfbport 5900 >/home/schaltwerk/runtime/x11vnc.log 2>&1 &
websockify --web=/usr/share/novnc/ 6080 localhost:5900 >/home/schaltwerk/runtime/websockify.log 2>&1 &
/home/schaltwerk/.venv/bin/python -m computer_server --host 0.0.0.0 --port "${SCHALTWERK_COMPUTER_SERVER_PORT:-8000}" >/home/schaltwerk/runtime/computer-server.log 2>&1 &

if [[ $# -gt 0 ]]; then
    exec "$@"
fi

tail -f /dev/null
