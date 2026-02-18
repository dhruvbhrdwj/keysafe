#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This script only supports macOS launchd."
  exit 1
fi

APP_LABEL="${KEYSAFE_APP_LABEL:-com.keysafe.app}"
BACKUP_LABEL="${KEYSAFE_BACKUP_LABEL:-com.keysafe.backup}"
AGENTS_DIR="$HOME/Library/LaunchAgents"

APP_PLIST="$AGENTS_DIR/$APP_LABEL.plist"
BACKUP_PLIST="$AGENTS_DIR/$BACKUP_LABEL.plist"

launchctl bootout "gui/$(id -u)" "$APP_PLIST" >/dev/null 2>&1 || true
launchctl bootout "gui/$(id -u)" "$BACKUP_PLIST" >/dev/null 2>&1 || true

rm -f "$APP_PLIST" "$BACKUP_PLIST"

echo "Removed launchd jobs and plist files."
