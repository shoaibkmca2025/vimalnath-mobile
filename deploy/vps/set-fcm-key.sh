#!/bin/sh
# Puts the Firebase key for Android push notifications into the VPS's settings (.env) and restarts the API with it.
# Run on the VPS:  set-fcm-key   (or: sh /opt/vimalnath/deploy/vps/set-fcm-key.sh)
# It asks for the key, base64 of the Firebase service account JSON, which stays hidden and is never sent anywhere.
# If the API won't start with it, the previous settings are put back.
set -eu
umask 077
env=/opt/vimalnath/.env
dc="docker compose -f /opt/vimalnath/deploy/vps/compose.yml --env-file $env"

echo 'Paste the Firebase key (the long base64 text) and press Enter.'
printf 'Nothing shows while you paste; that is normal: '
stty -echo 2>/dev/null || true
read -r KEY
stty echo 2>/dev/null || true
echo
case "$KEY" in
  '' | *' '* | *'{'*) echo 'STOPPED: paste the base64 text in one piece (from the PowerShell command), not the JSON file itself. Nothing changed.'; exit 1 ;;
esac

cp "$env" "$env.before-fcm"
grep -v '^FCM_SERVICE_ACCOUNT=' "$env.before-fcm" > "$env"
echo "FCM_SERVICE_ACCOUNT=$KEY" >> "$env"
echo 'Restarting the API with the key…'
if $dc up -d --wait --wait-timeout 90 api >/dev/null 2>&1; then
  rm -f "$env.before-fcm"
  echo 'Done: Android phones with the app installed can now get notifications.'
else
  mv "$env.before-fcm" "$env"
  $dc up -d --wait --wait-timeout 90 api >/dev/null 2>&1 || true
  echo 'STOPPED: the API refused that key (is it the Firebase service account key?). The previous settings are back.'
  exit 1
fi
