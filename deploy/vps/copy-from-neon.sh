#!/bin/sh
# Copies the live database from Neon into the VPS database, once, while the VPS database is still empty.
# Run on the VPS:  sh /opt/vimalnath/deploy/vps/copy-from-neon.sh
# It asks for the Neon connection string; that is never shown, saved or sent anywhere but Neon.
set -eu
cd "$(dirname "$0")"
compose="docker compose -f compose.yml --env-file /opt/vimalnath/.env"
pg="docker run --rm -i postgres:17-alpine"

printf 'Paste the Neon connection string (it stays hidden), then press Enter: '
stty -echo
read -r NEON
stty echo
echo
# The pooled address can't run a full copy; the direct one is the same without "-pooler".
NEON=$(printf '%s' "$NEON" | sed 's/-pooler\././')

major=$($pg psql "$NEON" -Atc 'show server_version_num' | cut -c1-2)
if [ "$major" -gt 17 ]; then
  echo "Neon runs Postgres $major and this server runs 17. Nothing was copied."
  exit 1
fi

$compose up -d --wait db
$compose stop api >/dev/null 2>&1 || true
tables=$($compose exec -T db psql -U vimalnath -d vimalnath -Atc "select count(*) from information_schema.tables where table_schema = 'public'")
if [ "$tables" != 0 ]; then
  echo "The VPS database already has $tables tables, so nothing was copied over them."
  exit 1
fi

echo 'Copying (all or nothing)…'
$pg pg_dump "$NEON" --schema=public --no-owner --no-privileges | $compose exec -T db psql -U vimalnath -d vimalnath --single-transaction -v ON_ERROR_STOP=1 -q
echo "Done: $($compose exec -T db psql -U vimalnath -d vimalnath -Atc 'select count(*) from orders') orders, $($compose exec -T db psql -U vimalnath -d vimalnath -Atc 'select count(*) from products') products, $($compose exec -T db psql -U vimalnath -d vimalnath -Atc 'select count(*) from staff_users') staff."
