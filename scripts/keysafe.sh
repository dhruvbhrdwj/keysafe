#!/usr/bin/env bash
set -euo pipefail

SOURCE="${BASH_SOURCE[0]}"
while [ -L "$SOURCE" ]; do
  DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
  SOURCE="$(readlink "$SOURCE")"
  [[ "$SOURCE" != /* ]] && SOURCE="$DIR/$SOURCE"
done
SCRIPT_PATH="$(cd -P "$(dirname "$SOURCE")" && pwd)/$(basename "$SOURCE")"
ROOT_DIR="$(cd "$(dirname "$SCRIPT_PATH")/.." && pwd)"
SCRIPT_DIR="$ROOT_DIR/scripts"

usage() {
  cat <<'EOF'
Usage: ./scripts/keysafe.sh <command>

Commands:
  start                    Start Key Safe server (local-only: 127.0.0.1)
  open                     Start server in background (if needed) and open browser
  status                   Show whether Key Safe is running on port 4312
  stop                     Stop Key Safe process listening on port 4312
  backup-now               Create encrypted backup immediately
  set-backup-passphrase    Save backup passphrase in macOS Keychain
  install-launchd          Install app autostart + daily backup jobs (macOS)
  uninstall-launchd        Remove launchd jobs (macOS)
EOF
}

is_port_in_use() {
  lsof -nP -iTCP:4312 -sTCP:LISTEN >/dev/null 2>&1
}

get_port_pid() {
  lsof -nP -iTCP:4312 -sTCP:LISTEN -t 2>/dev/null | head -n 1
}

is_launchd_managed() {
  [[ "$(uname -s)" == "Darwin" ]] && launchctl print "gui/$(id -u)/com.keysafe.app" >/dev/null 2>&1
}

require_macos() {
  if [[ "$(uname -s)" != "Darwin" ]]; then
    echo "This command only supports macOS."
    exit 1
  fi
}

command_name="${1:-}"

case "$command_name" in
  start)
    cd "$ROOT_DIR"
    if is_port_in_use; then
      echo "Key Safe is already running at http://127.0.0.1:4312"
      exit 0
    fi
    exec node server.js
    ;;
  open)
    cd "$ROOT_DIR"
    if ! is_port_in_use; then
      nohup node server.js >/tmp/keysafe-server.log 2>&1 &
      sleep 1
    fi
    if [[ "$(uname -s)" == "Darwin" ]]; then
      open "http://127.0.0.1:4312"
    else
      echo "Open this URL in your browser: http://127.0.0.1:4312"
    fi
    ;;
  status)
    if is_port_in_use; then
      pid="$(get_port_pid)"
      echo "Key Safe is running at http://127.0.0.1:4312 (PID: ${pid:-unknown})"
    else
      echo "Key Safe is not running."
    fi
    ;;
  stop)
    was_running=0
    if is_port_in_use; then
      was_running=1
    fi
    if is_launchd_managed; then
      launchctl bootout "gui/$(id -u)/com.keysafe.app" >/dev/null 2>&1 || true
      sleep 1
    fi

    if ! is_port_in_use; then
      if [[ "$was_running" -eq 1 ]]; then
        echo "Stopped Key Safe."
        exit 0
      fi
      echo "Key Safe is not running."
      exit 0
    fi

    pid="$(get_port_pid)"
    kill "$pid"
    sleep 1
    if is_port_in_use; then
      current_pid="$(get_port_pid)"
      if [[ -n "${current_pid:-}" ]]; then
        echo "Process did not stop cleanly, forcing stop..."
        kill -9 "$current_pid" 2>/dev/null || true
      fi
    fi
    if is_port_in_use; then
      echo "Failed to stop Key Safe on port 4312."
      exit 1
    fi
    echo "Stopped Key Safe (PID: $pid)."
    ;;
  backup-now)
    exec "$SCRIPT_DIR/backup_vault.sh"
    ;;
  set-backup-passphrase)
    require_macos
    exec "$SCRIPT_DIR/set_backup_passphrase.sh"
    ;;
  install-launchd)
    require_macos
    exec "$SCRIPT_DIR/install_launchd.sh"
    ;;
  uninstall-launchd)
    require_macos
    exec "$SCRIPT_DIR/uninstall_launchd.sh"
    ;;
  "" | -h | --help | help)
    usage
    ;;
  *)
    echo "Unknown command: $command_name"
    usage
    exit 1
    ;;
esac
