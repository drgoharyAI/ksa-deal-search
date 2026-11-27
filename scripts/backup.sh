#!/usr/bin/env bash
# Backup of the deal-search data volume. Run ON THE VM from the repo folder (or via cron):
#   scripts/backup.sh                 # -> ~/deal-search-backups/deal-search-YYYYmmdd-HHMMSS.tar.gz
#   BACKUP_DIR=/mnt/nas KEEP=14 scripts/backup.sh
# The database is copied with SQLite's online .backup (consistent while the app runs); the rest
# of /data (API Anything home, noon/SHEIN Chrome profiles with their cookies) is tarred without
# Chrome's caches. Keeps the newest $KEEP archives (default 7). Restore: docs/DEPLOY.md.
set -euo pipefail

cd "$(dirname "$0")/.."
BACKUP_DIR="${BACKUP_DIR:-$HOME/deal-search-backups}"
KEEP="${KEEP:-7}"
stamp="$(date +%Y%m%d-%H%M%S)"
out="$BACKUP_DIR/deal-search-$stamp.tar.gz"
mkdir -p "$BACKUP_DIR"

dc() { docker compose exec -T app "$@"; }

# 1. consistent DB copy inside the volume
dc sh -c 'rm -rf /data/.backup && mkdir -p /data/.backup && sqlite3 /data/data.db ".backup /data/.backup/data.db" && sqlite3 /data/.backup/data.db "PRAGMA integrity_check;"' \
  | grep -qx ok || { echo "backup: database copy failed the integrity check" >&2; exit 1; }

# 2. stream a tar of /data (live DB files and Chrome caches excluded; the copy becomes data.db)
set +e
dc tar -C /data -cf - \
  --anchored \
  --exclude=./data.db --exclude=./data.db-wal --exclude=./data.db-shm \
  --no-anchored \
  --exclude='Cache' --exclude='Code Cache' --exclude='GPUCache' --exclude='DawnGraphiteCache' \
  --exclude='DawnWebGPUCache' --exclude='GrShaderCache' --exclude='ShaderCache' --exclude='CacheStorage' \
  --exclude='ScriptCache' --exclude='Crashpad' --exclude='component_crx_cache' --exclude='Singleton*' \
  --exclude='optimization_guide_model_store' --exclude='Safe Browsing' --exclude='segmentation_platform' \
  --transform='s,^\./\.backup/data\.db$,./data.db,' \
  . | gzip -6 > "$out.part"
status=("${PIPESTATUS[@]}")
set -e
# tar exit 1 = "file changed as we read it" (a running Chrome profile): the archive is still usable.
if [ "${status[0]}" -gt 1 ] || [ "${status[1]}" -ne 0 ]; then
  rm -f "$out.part"
  echo "backup: tar failed (tar=${status[0]} gzip=${status[1]})" >&2
  exit 1
fi
mv "$out.part" "$out"
dc rm -rf /data/.backup

# 3. retention
ls -1t "$BACKUP_DIR"/deal-search-*.tar.gz 2>/dev/null | tail -n +"$((KEEP + 1))" | xargs -r rm -f --
echo "backup: $out ($(du -h "$out" | cut -f1)); kept newest $KEEP in $BACKUP_DIR"
