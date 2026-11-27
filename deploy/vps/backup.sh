#!/bin/sh
# Nightly database backup on the VPS (cron, /etc/cron.d/vimalnath-backup), kept for 14 days.
# Restore one:  docker compose -f compose.yml --env-file /opt/vimalnath/.env exec -T db pg_restore -U vimalnath -d vimalnath --clean < FILE
# Kept outside /opt/vimalnath, which each deploy replaces.
# shortcut: the backups sit on the same VPS, so they don't survive losing it; copy /var/backups/vimalnath off it too.
set -eu
# Backups hold everything (customers, staff, money), so only root may read them.
umask 077
cd "$(dirname "$0")"
mkdir -p /var/backups/vimalnath
# A file can be named (the deploy names its own); otherwise today's nightly one.
file=${1:-/var/backups/vimalnath/vimalnath-$(date +%F).dump}
docker compose -f compose.yml --env-file /opt/vimalnath/.env exec -T db pg_dump -U vimalnath -Fc vimalnath > "$file.part"
mv "$file.part" "$file"
find /var/backups/vimalnath -name 'vimalnath-*.dump' -mtime +14 -delete
