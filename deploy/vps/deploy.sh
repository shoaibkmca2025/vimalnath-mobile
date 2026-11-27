#!/bin/sh
# One deploy on the VPS, run by GitHub Actions (.github/workflows/ci-cd.yml) once the checks pass on main.
# The new code arrives unpacked in /opt/vimalnath.next. Nothing live changes until it has built. The database is backed
# up just before the switch; if the new version then doesn't come up healthy, the previous one is put back by itself,
# and so is the database if the new version had changed it (migrations).
# Roll back by hand to the deploy before:  sh /opt/vimalnath/deploy/vps/deploy.sh rollback
#   If that deploy changed the database, add --with-database to put the database back too. That loses anything
#   saved since the deploy (orders, payments), so it is never done without asking.
set -eu
umask 077
live=/opt/vimalnath
next=/opt/vimalnath.next
prev=/opt/vimalnath.prev
failed=/opt/vimalnath.failed
before=/var/backups/vimalnath/before-deploy.dump
dc() {
  dir=$1
  shift
  docker compose -f "$dir/deploy/vps/compose.yml" --env-file "$dir/.env" "$@"
}
# Caddy and the admin read files mounted from the code folder, so they're recreated to see the new ones.
start() {
  dc "$live" up -d --build --wait --remove-orphans
  dc "$live" up -d --no-deps --force-recreate admin caddy
}
healthy() {
  . "$live/.env"
  curl -fsS --retry 10 --retry-delay 3 --retry-all-errors -o /dev/null "https://$ADMIN_HOST/v1/health" &&
    curl -fsS --retry 10 --retry-delay 3 --retry-all-errors -o /dev/null "https://$APP_HOST/"
}
# Database changes applied that the code in $1 doesn't have.
unknown_to() {
  dc "$live" exec -T db psql -U vimalnath -d vimalnath -Atc 'select name from schema_migrations order by name' </dev/null |
    while read -r name; do [ -f "$1/server/migrations/$name" ] || echo "$name"; done
}
# Puts the database back as it was in a backup, all or nothing.
restore() {
  dc "$live" stop api
  dc "$live" exec -T db pg_restore -f - <"$1" >"$1.sql"
  # The backup may or may not create the public schema itself; it's always cleared and made here instead.
  sed -i '/^CREATE SCHEMA public;$/d' "$1.sql"
  { echo 'drop schema public cascade; create schema public;'; cat "$1.sql"; } |
    dc "$live" exec -T db psql -U vimalnath -d vimalnath --single-transaction -v ON_ERROR_STOP=1 -q >/dev/null
  rm -f "$1.sql"
}
put_back() {
  [ -d "$prev" ] || { echo 'No previous version to put back.'; exit 1; }
  newer=$(unknown_to "$prev" | tr '\n' ' ')
  if [ -n "$newer" ]; then
    if [ "${1:-}" != --with-database ]; then
      echo "The version being removed changed the database ($newer), and the previous version doesn't know those changes."
      echo "Run again with --with-database to put the database back as it was before that deploy; anything saved since is lost."
      exit 1
    fi
    [ -f "$before" ] || { echo 'There is no backup from before that deploy.'; exit 1; }
    echo "Putting the database back as it was before the deploy (undoing $newer)"
    restore "$before"
  fi
  rm -rf "$failed"
  mv "$live" "$failed"
  mv "$prev" "$live"
  start
  healthy
  echo "The previous version is live again ($(cat "$live/REVISION" 2>/dev/null || echo 'unknown'))."
}

if [ "${1:-}" = rollback ]; then
  put_back "${2:-}"
  exit 0
fi

echo '1/5 Settings'
install -m 600 "$live/.env" "$next/.env"

echo '2/5 Building (the live site keeps running)'
dc "$next" build

echo '3/5 Backing up the database'
sh "$next/deploy/vps/backup.sh" "$before"

echo '4/5 Switching to the new version'
rm -rf "$prev"
mv "$live" "$prev"
mv "$next" "$live"
if ! start || ! healthy; then
  echo 'The new version did not come up healthy; putting the previous one back.'
  put_back --with-database
  exit 1
fi

echo '5/5 Tidying up'
docker image prune -f >/dev/null
echo "Deployed $(cat "$live/REVISION" 2>/dev/null || echo 'a version without a REVISION file')."
