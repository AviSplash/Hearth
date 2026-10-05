#!/bin/bash
# Opens Hearth full screen on this Mac. ./install.sh --kiosk runs this when
# you sign in. Usage: kiosk.sh [url]   (default http://localhost:3000)
URL="${1:-http://localhost:3000}"

# Wait up to two minutes for the Hearth server to come up after login.
for _ in $(seq 1 60); do
  curl -fsS -o /dev/null "$URL/api/state" 2>/dev/null && break
  sleep 2
done

# Keep the display awake while you're signed in.
nohup /usr/bin/caffeinate -d >/dev/null 2>&1 &

for app in "Google Chrome" "Microsoft Edge" "Chromium" "Brave Browser"; do
  if [ -d "/Applications/$app.app" ] || [ -d "$HOME/Applications/$app.app" ]; then
    exec open -na "$app" --args --kiosk --noerrdialogs --no-first-run --hide-crash-restore-bubble "$URL"
  fi
done

# No Chromium-based browser: open Safari. Use File > Add to Dock there to get
# a separate Hearth app window, and View > Enter Full Screen.
exec open "$URL"
