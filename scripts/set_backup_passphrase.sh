#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This script only supports macOS Keychain."
  exit 1
fi

if ! command -v security >/dev/null 2>&1; then
  echo "security command not found."
  exit 1
fi

KEYCHAIN_SERVICE="${KEYSAFE_KEYCHAIN_SERVICE:-keysafe-backup-passphrase}"

echo "Save backup passphrase into macOS Keychain service: $KEYCHAIN_SERVICE"
read -r -s -p "Backup passphrase: " passphrase_1
echo
read -r -s -p "Confirm passphrase: " passphrase_2
echo

if [[ "$passphrase_1" != "$passphrase_2" ]]; then
  echo "Passphrases do not match."
  exit 1
fi

if [[ ${#passphrase_1} -lt 12 ]]; then
  echo "Passphrase must be at least 12 characters."
  exit 1
fi

security add-generic-password -U -a "$USER" -s "$KEYCHAIN_SERVICE" -w "$passphrase_1" >/dev/null

unset passphrase_1 passphrase_2
echo "Backup passphrase saved."
