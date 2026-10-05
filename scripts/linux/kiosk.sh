#!/usr/bin/env bash
# Opens Hearth full screen on this machine's display (Ubuntu Desktop,
# Raspberry Pi OS, etc). ./install.sh --kiosk runs this when you sign in.
# Usage: kiosk.sh [url]     (default http://localhost:3000)
URL="${1:-http://localhost:3000}"

# Wait up to two minutes for the Hearth server to come up after boot.
for _ in $(seq 1 60); do
  if command -v curl >/dev/null 2>&1; then
    curl -fsS -o /dev/null "$URL/api/state" 2>/dev/null && break
  elif command -v wget >/dev/null 2>&1; then
    wget -q -O /dev/null "$URL/api/state" 2>/dev/null && break
  else
    sleep 10 && break
  fi
  sleep 2
done

# Stop the screen blanking (X11 sessions; GNOME settings are set by install.sh).
if [ "${XDG_SESSION_TYPE:-}" = x11 ] && command -v xset >/dev/null 2>&1; then
  xset s off -dpms s noblank 2>/dev/null || true
fi

for browser in chromium chromium-browser google-chrome google-chrome-stable microsoft-edge brave-browser; do
  if command -v "$browser" >/dev/null 2>&1; then
    exec "$browser" --kiosk --noerrdialogs --disable-infobars --no-first-run \
      --disable-session-crashed-bubble --hide-crash-restore-bubble \
      --password-store=basic --check-for-update-interval=31536000 "$URL"
  fi
done
if command -v firefox >/dev/null 2>&1; then
  exec firefox --kiosk "$URL"
fi
exec xdg-open "$URL"
