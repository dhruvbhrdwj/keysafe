# Key Safe

Local-first encrypted key manager for API keys and secrets.

## Features

- Master-password protected vault
- AES-256-GCM encryption at rest
- Tags and environment labels (dev/prod/staging/etc.)
- Fast search by name/provider/environment/tag/notes
- One-click copy and reveal
- Auto-locks after 15 minutes of inactivity

## Run

```bash
npm start
```

Open `http://127.0.0.1:4312`.

Optional custom vault file location:

```bash
VAULT_FILE=/absolute/path/vault.json npm start
```

## Quick Commands

Start quickly:

```bash
npm run quickstart
```

Start and open in browser:

```bash
./scripts/keysafe.sh open
```

Check running status:

```bash
./scripts/keysafe.sh status
```

Stop Key Safe:

```bash
./scripts/keysafe.sh stop
```

Run encrypted backup now:

```bash
npm run backup
```

Set backup passphrase in macOS Keychain (one-time):

```bash
npm run setup:backup-passphrase
```

Install app autostart + daily backup (macOS launchd):

```bash
npm run setup:launchd
```

Remove launchd jobs:

```bash
npm run teardown:launchd
```

## Daily Encrypted Backup

- Backups are written to `backups/` as `vault_YYYY-MM-DD_HH-MM-SS.json.enc`
- Encryption uses OpenSSL `AES-256-CBC` with `PBKDF2`
- A `.sha256` checksum file is created for each backup
- Default retention is 30 days (older encrypted backups are deleted)

Optional backup settings:

```bash
KEYSAFE_BACKUP_DIR=/absolute/backup/path
KEYSAFE_BACKUP_RETENTION_DAYS=45
KEYSAFE_BACKUP_ITERATIONS=300000
KEYSAFE_KEYCHAIN_SERVICE=keysafe-backup-passphrase
```

Daily schedule defaults to `02:15` local time. Override before installing launchd:

```bash
KEYSAFE_BACKUP_HOUR=1 KEYSAFE_BACKUP_MINUTE=30 npm run setup:launchd
```

## Security model

- Vault data is encrypted on disk in `data/vault.json`
- Encryption key is derived from your master password using `scrypt`
- Decrypted values live only in server memory while unlocked
- Auto-lock wipes in-memory key and vault state

## Notes

- This is intended for local use on your machine.
- If you lose your master password, the vault cannot be recovered.
