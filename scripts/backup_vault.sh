#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_VAULT_FILE="$ROOT_DIR/data/vault.json"

VAULT_FILE="${VAULT_FILE:-$DEFAULT_VAULT_FILE}"
BACKUP_DIR="${KEYSAFE_BACKUP_DIR:-$ROOT_DIR/backups}"
KEYCHAIN_SERVICE="${KEYSAFE_KEYCHAIN_SERVICE:-keysafe-backup-passphrase}"
PBKDF2_ITERATIONS="${KEYSAFE_BACKUP_ITERATIONS:-250000}"
RETENTION_DAYS="${KEYSAFE_BACKUP_RETENTION_DAYS:-30}"

if [[ ! -f "$VAULT_FILE" ]]; then
  echo "Vault file not found: $VAULT_FILE"
  exit 1
fi

if ! command -v openssl >/dev/null 2>&1; then
  echo "openssl is required but not available."
  exit 1
fi

umask 077
mkdir -p "$BACKUP_DIR"

PASSPHRASE="${KEYSAFE_BACKUP_PASSPHRASE:-}"
if [[ -z "$PASSPHRASE" ]]; then
  if command -v security >/dev/null 2>&1; then
    PASSPHRASE="$(security find-generic-password -a "$USER" -s "$KEYCHAIN_SERVICE" -w 2>/dev/null || true)"
  fi
fi

if [[ -z "$PASSPHRASE" ]]; then
  echo "No backup passphrase found."
  echo "Run: ./scripts/keysafe.sh set-backup-passphrase"
  echo "Or set KEYSAFE_BACKUP_PASSPHRASE for one-off backup."
  exit 1
fi

timestamp="$(date +%Y-%m-%d_%H-%M-%S)"
encrypted_file="$BACKUP_DIR/vault_${timestamp}.json.enc"
checksum_file="$encrypted_file.sha256"

printf '%s' "$PASSPHRASE" \
  | openssl enc -aes-256-cbc -pbkdf2 -iter "$PBKDF2_ITERATIONS" -salt \
    -in "$VAULT_FILE" -out "$encrypted_file" -pass stdin

shasum -a 256 "$encrypted_file" > "$checksum_file"

if [[ "$RETENTION_DAYS" =~ ^[0-9]+$ ]]; then
  find "$BACKUP_DIR" -type f \( -name 'vault_*.json.enc' -o -name 'vault_*.json.enc.sha256' \) -mtime +"$RETENTION_DAYS" -delete
fi

unset PASSPHRASE
echo "Encrypted backup created: $encrypted_file"
