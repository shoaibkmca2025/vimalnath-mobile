#!/bin/sh
# Copies the live database from Neon into the VPS database, once, while the VPS database is still empty.
# Run on the VPS:  copy-neon   (or: sh /opt/vimalnath/deploy/vps/copy-from-neon.sh)
# It asks for the Neon connection string; that is never shown, saved or sent anywhere but Neon.
set -eu
umask 077
cd "$(dirname "$0")"
compose="docker compose -f compose.yml --env-file /opt/vimalnath/.env"
pg="docker run --rm -i postgres:18-alpine"
dump=/opt/vimalnath/neon-copy.sql
fail() {
  echo "STOPPED: $1 Nothing was copied."
  rm -f "$dump"
  exit 1
}

echo 'Now paste the Neon connection string (it starts with postgresql://) and press Enter.'
printf 'Nothing shows while you paste; that is normal: '
stty -echo 2>/dev/null || true
read -r NEON
stty echo 2>/dev/null || true
echo
case "$NEON" in
  postgres://* | postgresql://*) ;;
  *) fail 'That isn’t a connection string; it must start with postgresql://.' ;;
esac
# The pooled address can't run a full copy; the direct one is the same without "-pooler".
NEON=$(printf '%s' "$NEON" | sed 's/-pooler\././')

echo 'Connecting to Neon…'
version=$($pg psql "$NEON" -Atc 'show server_version_num') || fail 'Couldn’t connect to Neon with that string (wrong or reset password?).'
major=$(printf '%s' "$version" | cut -c1-2)
[ "$major" -le 18 ] 2>/dev/null || fail "Neon runs Postgres $major and this server runs 18."

$compose up -d --wait db >/dev/null 2>&1 || fail 'The VPS database didn’t start.'
$compose stop api >/dev/null 2>&1 || true
tables=$($compose exec -T db psql -U vimalnath -d vimalnath -Atc "select count(*) from information_schema.tables where table_schema = 'public'" </dev/null)
[ "$tables" = 0 ] || fail "The VPS database already has $tables tables, so it won’t copy over them."

echo 'Copying from Neon…'
$pg pg_dump "$NEON" --schema=public --no-owner --no-privileges > "$dump" || fail 'Reading from Neon failed.'
echo 'Saving into the VPS database (all or nothing)…'
# The copy creates the public schema itself, so the empty one goes first, in the same all-or-nothing step.
{ echo 'drop schema public cascade;'; cat "$dump"; } | $compose exec -T db psql -U vimalnath -d vimalnath --single-transaction -v ON_ERROR_STOP=1 -q >/dev/null || fail 'Saving into the VPS failed and was rolled back.'
rm -f "$dump"

count() { $compose exec -T db psql -U vimalnath -d vimalnath -Atc "select count(*) from $1" </dev/null; }
orders=$(count orders) || fail 'The copy has no orders table.'
echo "Done: $orders orders, $(count products) products, $(count staff_users) staff."
