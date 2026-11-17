#!/bin/sh
# Nightly backup of the leave app (spec platform MVP: "daily automatic backup"; stack §1).
# Writes, under ./backups/ (gitignored):
#   leave-YYYY-MM-DD.dump            PostgreSQL custom-format dump (pg_dump -Fc)
#   uploads-YYYY-MM-DD.tar.gz        the attachment files (the "uploads" volume)
# and keeps the last 14 days. Exits non-zero if any step fails.
#
# Run from the directory holding docker-compose.yml and .env (POSTGRES_USER / POSTGRES_DB are
# read from .env; defaults match docker-compose.yml). Install on the VPS with `crontab -e`:
#
#   0 2 * * * cd /opt/leave-app && ./scripts/backup.sh >> backups/backup.log 2>&1
#
# Copy ./backups to another machine or object storage as well: a backup on the same disk does
# not survive the loss of the VPS.
#
# Restore (stop the app first so nothing writes during the restore):
#   docker compose stop app
#   docker compose exec -T db pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner \
#     < backups/leave-YYYY-MM-DD.dump
#   docker compose run --rm --no-deps -T --user root --entrypoint sh app \
#     -c 'rm -rf /data/uploads/* && tar xzf - -C /data/uploads && chown -R node:node /data/uploads' \
#     < backups/uploads-YYYY-MM-DD.tar.gz
#   docker compose start app
set -eu
# Dumps hold password hashes, notes and medical certificates: owner-only files (security audit).
umask 077

KEEP_DAYS=14
cd "$(dirname "$0")/.."

# Read only the two variables we need from .env (never source the whole file).
env_value() {
  [ -f .env ] || return 0
  sed -n "s/^$1=//p" .env | tail -n 1 | sed 's/^["'\'']//; s/["'\'']$//'
}
POSTGRES_USER="${POSTGRES_USER:-$(env_value POSTGRES_USER)}"
POSTGRES_DB="${POSTGRES_DB:-$(env_value POSTGRES_DB)}"
POSTGRES_USER="${POSTGRES_USER:-leave}"
POSTGRES_DB="${POSTGRES_DB:-leave}"

STAMP="$(date +%F)"
DIR="backups"
DB_FILE="$DIR/leave-$STAMP.dump"
UPLOADS_FILE="$DIR/uploads-$STAMP.tar.gz"
mkdir -p "$DIR"
chmod 700 "$DIR"

log() { echo "[$(date '+%F %T')] $*"; }

fail() {
  log "BACKUP FAILED: $*"
  rm -f "$DB_FILE.part" "$UPLOADS_FILE.part"
  exit 1
}

log "database dump -> $DB_FILE"
docker compose exec -T db pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > "$DB_FILE.part" || fail "pg_dump"
[ -s "$DB_FILE.part" ] || fail "empty database dump"
mv "$DB_FILE.part" "$DB_FILE"

# The uploads volume is mounted at /data/uploads in the app service; reuse that mount so the
# compose project name never matters. --no-deps: do not start or restart other services.
log "uploads archive -> $UPLOADS_FILE"
docker compose run --rm --no-deps -T --entrypoint tar app czf - -C /data/uploads . > "$UPLOADS_FILE.part" ||
  fail "uploads archive"
[ -s "$UPLOADS_FILE.part" ] || fail "empty uploads archive"
mv "$UPLOADS_FILE.part" "$UPLOADS_FILE"

log "pruning backups older than $KEEP_DAYS days"
find "$DIR" -maxdepth 1 -type f \( -name 'leave-*.dump' -o -name 'uploads-*.tar.gz' \) -mtime +"$((KEEP_DAYS - 1))" -print -exec rm -f {} \; ||
  fail "prune"

log "backup OK ($(du -h "$DB_FILE" | cut -f1) database, $(du -h "$UPLOADS_FILE" | cut -f1) uploads)"
