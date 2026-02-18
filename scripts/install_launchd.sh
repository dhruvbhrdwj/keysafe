#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This script only supports macOS launchd."
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT_DIR="$ROOT_DIR/scripts"
AGENTS_DIR="$HOME/Library/LaunchAgents"
LOG_DIR="$ROOT_DIR/logs"

APP_LABEL="${KEYSAFE_APP_LABEL:-com.keysafe.app}"
BACKUP_LABEL="${KEYSAFE_BACKUP_LABEL:-com.keysafe.backup}"
APP_PORT="${PORT:-4312}"
APP_HOST="${HOST:-127.0.0.1}"
VAULT_FILE_PATH="${VAULT_FILE:-$ROOT_DIR/data/vault.json}"
BACKUP_HOUR="${KEYSAFE_BACKUP_HOUR:-2}"
BACKUP_MINUTE="${KEYSAFE_BACKUP_MINUTE:-15}"

NODE_BIN="$(command -v node || true)"
if [[ -z "$NODE_BIN" ]]; then
  echo "node executable not found."
  exit 1
fi

mkdir -p "$AGENTS_DIR" "$LOG_DIR"

APP_PLIST="$AGENTS_DIR/$APP_LABEL.plist"
BACKUP_PLIST="$AGENTS_DIR/$BACKUP_LABEL.plist"

cat >"$APP_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>$APP_LABEL</string>
    <key>ProgramArguments</key>
    <array>
      <string>$NODE_BIN</string>
      <string>server.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$ROOT_DIR</string>
    <key>EnvironmentVariables</key>
    <dict>
      <key>HOST</key>
      <string>$APP_HOST</string>
      <key>PORT</key>
      <string>$APP_PORT</string>
      <key>VAULT_FILE</key>
      <string>$VAULT_FILE_PATH</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$LOG_DIR/app.out.log</string>
    <key>StandardErrorPath</key>
    <string>$LOG_DIR/app.err.log</string>
  </dict>
</plist>
EOF

cat >"$BACKUP_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>$BACKUP_LABEL</string>
    <key>ProgramArguments</key>
    <array>
      <string>/bin/bash</string>
      <string>$SCRIPT_DIR/backup_vault.sh</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$ROOT_DIR</string>
    <key>EnvironmentVariables</key>
    <dict>
      <key>VAULT_FILE</key>
      <string>$VAULT_FILE_PATH</string>
    </dict>
    <key>StartCalendarInterval</key>
    <dict>
      <key>Hour</key>
      <integer>$BACKUP_HOUR</integer>
      <key>Minute</key>
      <integer>$BACKUP_MINUTE</integer>
    </dict>
    <key>StandardOutPath</key>
    <string>$LOG_DIR/backup.out.log</string>
    <key>StandardErrorPath</key>
    <string>$LOG_DIR/backup.err.log</string>
  </dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)" "$APP_PLIST" >/dev/null 2>&1 || true
launchctl bootout "gui/$(id -u)" "$BACKUP_PLIST" >/dev/null 2>&1 || true

launchctl bootstrap "gui/$(id -u)" "$APP_PLIST"
launchctl bootstrap "gui/$(id -u)" "$BACKUP_PLIST"
launchctl kickstart -k "gui/$(id -u)/$APP_LABEL"

echo "Installed launchd jobs:"
echo "- App label: $APP_LABEL"
echo "- Backup label: $BACKUP_LABEL at $(printf '%02d:%02d' "$BACKUP_HOUR" "$BACKUP_MINUTE")"
echo "Use: ./scripts/keysafe.sh uninstall-launchd to remove."
