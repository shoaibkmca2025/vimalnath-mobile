#!/bin/sh
# Nightly database backup on the VPS (cron, /etc/cron.d/vimalnath-backup), kept for 14 days.
# Restore one:  docker compose -f compose.yml --env-file /opt/vimalnath/.env exec -T db pg_restore -U vimalnath -d vimalnath --clean < FILE
# shortcut: the backups sit on the same VPS, so they don't survive losing it; copy /opt/vimalnath/backups off it too.
set -eu
cd "$(dirname "$0")"
mkdir -p /opt/vimalnath/backups
file=/opt/vimalnath/backups/vimalnath-$(date +%F).dump
docker compose -f compose.yml --env-file /opt/vimalnath/.env exec -T db pg_dump -U vimalnath -Fc vimalnath > "$file.part"
mv "$file.part" "$file"
find /opt/vimalnath/backups -name 'vimalnath-*.dump' -mtime +14 -delete
