#!/usr/bin/env bash
# Hearth installer for Ubuntu / Debian (desktop or server) and macOS.
#
#   ./install.sh               install, run in the background, start at boot
#   ./install.sh --kiosk       also open Hearth full screen on this machine's display
#   ./install.sh --uninstall   stop and remove the background service (keeps your data)
#   ./install.sh --help        all options
#
# Safe to run again: it updates packages and restarts Hearth (use it after a git pull).
# Run it as your normal user; it asks for your password (sudo) only when it needs to.

set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PORT="${PORT:-3000}"
HTTPS_PORT="${HTTPS_PORT:-3443}"
DATA_DIR="${DATA_DIR:-$APP_DIR/data}"
MIN_NODE=20
WANT_SERVICE=1
WANT_FIREWALL=1
WANT_KIOSK=0
UNINSTALL=0
ASSUME_YES=0
OS="$(uname -s)"
LAN_RANGES="10.0.0.0/8 172.16.0.0/12 192.168.0.0/16"

# ---- output -----------------------------------------------------------------

if [ -t 1 ]; then
  B=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GRN=$'\033[32m'; YEL=$'\033[33m'; BLU=$'\033[34m'; RST=$'\033[0m'
else
  B=''; DIM=''; RED=''; GRN=''; YEL=''; BLU=''; RST=''
fi
step() { printf '\n%s==>%s %s%s%s\n' "$BLU" "$RST" "$B" "$*" "$RST"; }
say()  { printf '    %s\n' "$*"; }
ok()   { printf '    %s✓%s %s\n' "$GRN" "$RST" "$*"; }
warn() { printf '    %s!%s %s\n' "$YEL" "$RST" "$*"; }
die()  { printf '\n%sError:%s %s\n\n' "$RED" "$RST" "$*" >&2; exit 1; }

# ask "Question?" [Y|N]  -> returns 0 for yes. Uses the default when not interactive.
ask() {
  local default="${2:-Y}" reply prompt="[Y/n]"
  [ "$default" = N ] && prompt="[y/N]"
  if [ "$ASSUME_YES" = 1 ]; then return 0; fi
  if [ ! -t 0 ]; then [ "$default" = Y ]; return; fi
  read -r -p "    $1 $prompt " reply || reply=""
  [ -z "$reply" ] && reply="$default"
  case "$reply" in [Yy]*) return 0 ;; *) return 1 ;; esac
}

usage() {
  cat <<EOF
Hearth installer for Ubuntu/Debian and macOS

Usage: ./install.sh [options]

  --kiosk             Also open Hearth full screen on this machine's display at login
  --no-service        Only install packages; don't set up the background service
  --no-firewall       Don't touch the firewall
  --port N            HTTP port (default 3000)
  --https-port N      HTTPS port (default 3443)
  --data-dir DIR      Where Hearth keeps its data (default: ./data)
  -y, --yes           Answer yes to every question
  --uninstall         Remove the background service and kiosk launcher (keeps data)
  -h, --help          Show this help
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --kiosk) WANT_KIOSK=1 ;;
    --no-service) WANT_SERVICE=0 ;;
    --no-firewall) WANT_FIREWALL=0 ;;
    --port) PORT="${2:?--port needs a number}"; shift ;;
    --https-port) HTTPS_PORT="${2:?--https-port needs a number}"; shift ;;
    --data-dir) DATA_DIR="${2:?--data-dir needs a folder}"; shift ;;
    -y|--yes) ASSUME_YES=1 ;;
    --uninstall) UNINSTALL=1 ;;
    -h|--help) usage; exit 0 ;;
    *) usage; die "Unknown option: $1" ;;
  esac
  shift
done

case "$PORT$HTTPS_PORT" in *[!0-9]*) die "Ports must be numbers." ;; esac
case "$DATA_DIR" in /*) ;; *) DATA_DIR="$(pwd -P)/$DATA_DIR" ;; esac
case "$OS" in Linux|Darwin) ;; *) die "This installer is for Linux and macOS. On Windows use scripts\\windows\\start-hearth.bat." ;; esac

# ---- who runs Hearth ---------------------------------------------------------

if [ "$(id -u)" = 0 ]; then
  if [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != root ]; then
    die "Run ./install.sh without sudo. It asks for your password when it needs it, and Hearth then runs as $SUDO_USER instead of root."
  fi
  [ "$OS" = Darwin ] && die "On macOS, run ./install.sh as your normal user (not root)."
  SUDO=""
  ROOT_WARNING=1
else
  if command -v sudo >/dev/null 2>&1; then SUDO="sudo"; else SUDO=""; fi
fi
RUN_USER="$(id -un)"
ROOT_WARNING="${ROOT_WARNING:-0}"

need_root() {
  if [ "$(id -u)" != 0 ] && [ -z "$SUDO" ]; then
    warn "Skipping: $1 needs administrator rights and sudo isn't installed."
    return 1
  fi
}

# ---- Node.js ----------------------------------------------------------------

NODE=""
node_major() {
  "$1" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0
}

# Use the node on PATH if it's new enough, else a new-enough one from the
# usual install locations (an older nvm/system node may come first on PATH,
# and Homebrew isn't always on PATH, e.g. over SSH on a Mac).
find_node() {
  local first="" candidate
  NODE=""
  for candidate in "$(command -v node 2>/dev/null || true)" /usr/bin/node /usr/local/bin/node /opt/homebrew/bin/node; do
    if [ -z "$candidate" ] || [ ! -x "$candidate" ]; then continue; fi
    [ -n "$first" ] || first="$candidate"
    if [ "$(node_major "$candidate")" -ge "$MIN_NODE" ]; then
      NODE="$candidate"
      return
    fi
  done
  NODE="$first"
}

install_node_linux() {
  need_root "Installing Node.js" || die "Install Node.js $MIN_NODE or newer (https://nodejs.org/en/download), then run ./install.sh again."
  if command -v apt-get >/dev/null 2>&1; then
    local candidate major
    candidate="$(apt-cache policy nodejs 2>/dev/null | awk '/Candidate:/ {print $2}')"
    major="$(printf '%s' "$candidate" | sed -E 's/^([0-9]+:)?([0-9]+).*/\2/')"
    case "$major" in ''|*[!0-9]*) major=0 ;; esac
    if [ "$major" -ge "$MIN_NODE" ]; then
      ask "Install Node.js $candidate from your system's packages?" || die "Hearth needs Node.js $MIN_NODE or newer."
      $SUDO apt-get update -qq
      $SUDO apt-get install -y nodejs npm
    else
      say "Your system's Node.js package (${candidate:-none}) is too old for Hearth."
      say "Hearth can add the official Node.js 22 LTS packages from NodeSource (deb.nodesource.com)."
      ask "Install Node.js 22 LTS from NodeSource?" || die "Install Node.js $MIN_NODE or newer (https://nodejs.org/en/download), then run ./install.sh again."
      $SUDO apt-get update -qq
      $SUDO apt-get install -y ca-certificates curl gnupg
      local setup
      setup="$(mktemp)"
      curl -fsSL https://deb.nodesource.com/setup_22.x -o "$setup"
      $SUDO bash "$setup"
      rm -f "$setup"
      $SUDO apt-get install -y nodejs
    fi
  elif command -v dnf >/dev/null 2>&1; then
    ask "Install Node.js with dnf?" || die "Hearth needs Node.js $MIN_NODE or newer."
    $SUDO dnf install -y nodejs npm
  elif command -v pacman >/dev/null 2>&1; then
    ask "Install Node.js with pacman?" || die "Hearth needs Node.js $MIN_NODE or newer."
    $SUDO pacman -S --needed --noconfirm nodejs npm
  else
    die "Install Node.js $MIN_NODE or newer (https://nodejs.org/en/download), then run ./install.sh again."
  fi
}

install_node_mac() {
  local brew=""
  for candidate in "$(command -v brew 2>/dev/null || true)" /opt/homebrew/bin/brew /usr/local/bin/brew; do
    if [ -z "$brew" ] && [ -n "$candidate" ] && [ -x "$candidate" ]; then brew="$candidate"; fi
  done
  if [ -z "$brew" ]; then
    die "Install Node.js 22 LTS with the macOS Installer from https://nodejs.org (or install Homebrew from https://brew.sh), then run ./install.sh again."
  fi
  ask "Install Node.js with Homebrew (brew install node)?" || die "Hearth needs Node.js $MIN_NODE or newer."
  "$brew" install node
}

ensure_node() {
  step "Checking Node.js"
  find_node
  if [ -n "$NODE" ] && [ "$(node_major "$NODE")" -ge "$MIN_NODE" ]; then
    use_real_snap_node
    ok "Node.js $("$NODE" -v) at $NODE"
    return
  fi
  if [ -n "$NODE" ]; then warn "Found Node.js $("$NODE" -v), but Hearth needs $MIN_NODE or newer."; else warn "Node.js isn't installed."; fi
  if [ "$OS" = Darwin ]; then install_node_mac; else install_node_linux; fi
  hash -r 2>/dev/null || true
  find_node
  if [ -z "$NODE" ] || [ "$(node_major "$NODE")" -lt "$MIN_NODE" ]; then
    die "Node.js $MIN_NODE+ still isn't available. Open a new terminal and run ./install.sh again."
  fi
  use_real_snap_node
  ok "Node.js $("$NODE" -v) at $NODE"
}

use_real_snap_node() {
  # /snap/bin/node goes through snap-confine, which refuses to run under the
  # service's NoNewPrivileges hardening. The node snap is "classic" (not
  # sandboxed), so running its binary directly is equivalent.
  if [ "$NODE" = /snap/bin/node ] && [ -x /snap/node/current/bin/node ]; then
    NODE=/snap/node/current/bin/node
  fi
}

install_packages() {
  step "Installing Hearth's packages"
  PATH="$(dirname "$NODE"):$PATH"
  export PATH
  local npm
  npm="$(command -v npm 2>/dev/null || true)"
  [ -n "$npm" ] || die "npm wasn't found next to Node.js. On Ubuntu: sudo apt-get install npm"
  (cd "$APP_DIR" && "$npm" ci --omit=dev --no-audit --no-fund --progress=false --loglevel=error) ||
    (cd "$APP_DIR" && "$npm" install --omit=dev --no-audit --no-fund --progress=false --loglevel=error) ||
    die "npm couldn't install Hearth's packages. Check your internet connection and try again."
  mkdir -p "$DATA_DIR"
  chmod 700 "$DATA_DIR" 2>/dev/null || true
  ok "Packages installed. Data folder: $DATA_DIR"
}

# ---- Linux: systemd service ---------------------------------------------------

UNIT=/etc/systemd/system/hearth.service

has_systemd() {
  [ -d /run/systemd/system ] && command -v systemctl >/dev/null 2>&1
}

# systemd treats % as a specifier; double it in paths.
unit_path() { printf '%s' "$1" | sed 's/%/%%/g'; }

linux_service() {
  step "Setting up the Hearth service (systemd)"
  if ! has_systemd; then
    warn "systemd isn't running here, so Hearth can't start automatically."
    say "Start it yourself with: $APP_DIR/scripts/start.sh"
    WANT_SERVICE=0
    return
  fi
  need_root "Installing the service" || { WANT_SERVICE=0; return; }

  local caps=""
  if [ "$PORT" -lt 1024 ] || [ "$HTTPS_PORT" -lt 1024 ]; then
    caps="AmbientCapabilities=CAP_NET_BIND_SERVICE"
  fi

  $SUDO tee "$UNIT" >/dev/null <<EOF
# Created by $APP_DIR/install.sh. Re-run it to update; ./install.sh --uninstall removes it.
[Unit]
Description=Hearth family calendar
Documentation=file://$APP_DIR/README.md
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$RUN_USER
WorkingDirectory=$(unit_path "$APP_DIR")
ExecStart="$(unit_path "$NODE")" "$(unit_path "$APP_DIR/server/index.js")"
Environment=NODE_ENV=production
Environment=PORT=$PORT
Environment=HTTPS_PORT=$HTTPS_PORT
Environment="DATA_DIR=$(unit_path "$DATA_DIR")"
Restart=on-failure
RestartSec=5
$caps
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=read-only
ReadWritePaths="$(unit_path "$DATA_DIR")"

[Install]
WantedBy=multi-user.target
EOF
  $SUDO systemctl daemon-reload
  $SUDO systemctl enable hearth >/dev/null 2>&1
  $SUDO systemctl restart hearth
  ok "Hearth runs in the background and starts when this machine boots."
}

linux_uninstall() {
  if has_systemd && [ -f "$UNIT" ]; then
    $SUDO systemctl disable --now hearth >/dev/null 2>&1 || true
    $SUDO rm -f "$UNIT"
    $SUDO systemctl daemon-reload
    ok "Removed the Hearth service."
  fi
  if command -v ufw >/dev/null 2>&1 && { [ "$(id -u)" = 0 ] || [ -n "$SUDO" ]; }; then
    local net port
    for net in $LAN_RANGES; do
      for port in "$PORT" "$HTTPS_PORT"; do
        $SUDO ufw delete allow from "$net" to any port "$port" proto tcp >/dev/null 2>&1 || true
      done
    done
  fi
  rm -f "$HOME/.config/autostart/hearth-kiosk.desktop"
}

linux_timezone_check() {
  local tz=""
  tz="$(timedatectl show -p Timezone --value 2>/dev/null || cat /etc/timezone 2>/dev/null || true)"
  case "$tz" in
    ''|UTC|Etc/UTC|Etc/Universal)
      step "Time zone"
      warn "This machine's time zone is UTC. Hearth uses the time zone of the weather location you pick,"
      say "  or set the machine's: sudo timedatectl set-timezone America/Chicago  (list: timedatectl list-timezones)"
      ;;
  esac
}

linux_mdns() {
  # Lets tablets use http://<name>.local:3000, which survives IP changes.
  if [ -e /run/avahi-daemon/pid ] || ! command -v apt-get >/dev/null 2>&1; then return; fi
  step "Network name (optional)"
  say "Installing avahi-daemon lets devices open Hearth at http://$(hostname -s 2>/dev/null || hostname).local:$PORT"
  say "instead of the IP address. iPhones, iPads, Macs and Windows PCs understand these names."
  if ask "Install avahi-daemon?" && need_root "Installing avahi-daemon"; then
    $SUDO apt-get install -y avahi-daemon >/dev/null && ok "avahi-daemon installed."
  fi
}

linux_firewall() {
  step "Firewall"
  if command -v ufw >/dev/null 2>&1 && need_root "Checking ufw" && $SUDO ufw status 2>/dev/null | grep -q "Status: active"; then
    if ask "ufw is on. Allow devices on your home network to reach Hearth (ports $PORT, $HTTPS_PORT)?"; then
      local net
      for net in $LAN_RANGES; do
        $SUDO ufw allow from "$net" to any port "$PORT" proto tcp comment Hearth >/dev/null
        $SUDO ufw allow from "$net" to any port "$HTTPS_PORT" proto tcp comment Hearth >/dev/null
        if [ -e /run/avahi-daemon/pid ]; then
          $SUDO ufw allow from "$net" to any port 5353 proto udp comment 'mDNS for Hearth' >/dev/null
        fi
      done
      ok "Allowed from private networks ($LAN_RANGES)."
    fi
  elif command -v firewall-cmd >/dev/null 2>&1 && $SUDO firewall-cmd --state >/dev/null 2>&1; then
    if ask "firewalld is on. Open ports $PORT and $HTTPS_PORT for Hearth?"; then
      $SUDO firewall-cmd --permanent --add-port="$PORT/tcp" --add-port="$HTTPS_PORT/tcp" >/dev/null
      $SUDO firewall-cmd --reload >/dev/null
      ok "Ports opened."
    fi
  else
    ok "No active firewall found, so nothing to open."
  fi
}

linux_kiosk() {
  step "Kiosk mode"
  if [ ! -d /usr/share/xsessions ] && [ ! -d /usr/share/wayland-sessions ] && [ -z "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then
    warn "This machine has no desktop, so there's no screen to show Hearth on. Skipping kiosk mode."
    return
  fi
  local browser=""
  for b in chromium chromium-browser google-chrome google-chrome-stable microsoft-edge brave-browser firefox; do
    if [ -z "$browser" ] && command -v "$b" >/dev/null 2>&1; then browser="$b"; fi
  done
  if [ -z "$browser" ] && command -v snap >/dev/null 2>&1; then
    if ask "No web browser found. Install Chromium (snap install chromium)?" && need_root "Installing Chromium"; then
      $SUDO snap install chromium
    fi
  fi

  mkdir -p "$HOME/.config/autostart"
  cat > "$HOME/.config/autostart/hearth-kiosk.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Hearth (full screen)
Comment=Opens the Hearth family calendar full screen
Exec="$APP_DIR/scripts/linux/kiosk.sh" http://localhost:$PORT
X-GNOME-Autostart-enabled=true
X-GNOME-Autostart-Delay=5
EOF
  ok "Hearth will open full screen when you sign in to the desktop."

  if command -v gsettings >/dev/null 2>&1 && gsettings get org.gnome.desktop.session idle-delay >/dev/null 2>&1; then
    if ask "Keep the screen on (no blanking, no lock screen, no sleep)?"; then
      gsettings set org.gnome.desktop.session idle-delay 0 || true
      gsettings set org.gnome.desktop.screensaver lock-enabled false || true
      gsettings set org.gnome.settings-daemon.plugins.power sleep-inactive-ac-type 'nothing' 2>/dev/null || true
      ok "Screen blanking and auto-lock turned off."
    fi
  else
    say "Turn off screen blanking and the lock screen in your desktop's settings so the calendar stays visible."
  fi
  say "Tip: Settings > Users > Automatic Login makes the display come back on its own after a power cut."
}

# ---- macOS: launchd agent ------------------------------------------------------

AGENT_DIR="$HOME/Library/LaunchAgents"
SERVER_PLIST="$AGENT_DIR/com.hearth.server.plist"
KIOSK_PLIST="$AGENT_DIR/com.hearth.kiosk.plist"
LOG_DIR="$HOME/Library/Logs/Hearth"

xml() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }

resolve_path() {
  # Follow symlinks without relying on readlink -f (missing on older macOS).
  local p="$1" target
  while [ -L "$p" ]; do
    target="$(readlink "$p")"
    case "$target" in /*) p="$target" ;; *) p="$(dirname "$p")/$target" ;; esac
  done
  printf '%s/%s\n' "$(cd "$(dirname "$p")" && pwd -P)" "$(basename "$p")"
}

mac_privacy_check() {
  # launchd jobs can't read Desktop/Documents/Downloads (macOS privacy rules),
  # so a Hearth folder there would fail to start in the background.
  case "$APP_DIR/" in
    "$HOME/Desktop/"*|"$HOME/Documents/"*|"$HOME/Downloads/"*|"$HOME/Library/Mobile Documents/"*)
      warn "Hearth is inside a protected folder ($APP_DIR)."
      say "macOS won't let background services read Desktop, Documents, Downloads or iCloud Drive."
      say "Move it first, then run the installer again:"
      say "  mv \"$APP_DIR\" ~/hearth && cd ~/hearth && ./install.sh"
      ask "Continue anyway?" N || exit 1
      ;;
  esac
}

mac_load() {
  local label="$1" plist="$2"
  launchctl bootout "gui/$(id -u)/$label" >/dev/null 2>&1 || launchctl unload "$plist" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$(id -u)" "$plist" 2>/dev/null || launchctl load -w "$plist"
}

mac_service() {
  step "Setting up the Hearth service (launchd)"
  mkdir -p "$AGENT_DIR" "$LOG_DIR"
  # caffeinate -i keeps the Mac from idle-sleeping while Hearth runs.
  cat > "$SERVER_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.hearth.server</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/caffeinate</string>
    <string>-i</string>
    <string>$(xml "$NODE")</string>
    <string>$(xml "$APP_DIR/server/index.js")</string>
  </array>
  <key>WorkingDirectory</key><string>$(xml "$APP_DIR")</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key><string>production</string>
    <key>PORT</key><string>$PORT</string>
    <key>HTTPS_PORT</key><string>$HTTPS_PORT</string>
    <key>DATA_DIR</key><string>$(xml "$DATA_DIR")</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$(xml "$LOG_DIR/hearth.log")</string>
  <key>StandardErrorPath</key><string>$(xml "$LOG_DIR/hearth.log")</string>
</dict>
</plist>
EOF
  mac_load com.hearth.server "$SERVER_PLIST"
  ok "Hearth runs in the background and starts when you sign in."
  say "For a Mac that should come back on its own after a power cut: System Settings >"
  say "Users & Groups > Automatically log in as $RUN_USER, and Energy > Start up automatically after a power failure."
}

mac_firewall() {
  step "Firewall"
  local fw=/usr/libexec/ApplicationFirewall/socketfilterfw
  if [ -x "$fw" ] && "$fw" --getglobalstate 2>/dev/null | grep -q "is enabled"; then
    if ask "The macOS firewall is on. Let Hearth (Node.js) accept connections from your network?"; then
      local real
      real="$(resolve_path "$NODE")"
      sudo "$fw" --add "$real" >/dev/null
      sudo "$fw" --unblockapp "$real" >/dev/null
      ok "Allowed $real through the firewall."
    fi
  else
    ok "The macOS firewall is off, so nothing to open."
  fi
}

mac_kiosk() {
  step "Kiosk mode"
  cat > "$KIOSK_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.hearth.kiosk</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$(xml "$APP_DIR/scripts/macos/kiosk.sh")</string>
    <string>http://localhost:$PORT</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>AbandonProcessGroup</key><true/>
  <key>StandardOutPath</key><string>$(xml "$LOG_DIR/kiosk.log")</string>
  <key>StandardErrorPath</key><string>$(xml "$LOG_DIR/kiosk.log")</string>
</dict>
</plist>
EOF
  mac_load com.hearth.kiosk "$KIOSK_PLIST"
  ok "Hearth opens full screen when you sign in (Cmd+Q quits the browser)."
}

mac_uninstall() {
  local label
  for label in com.hearth.server com.hearth.kiosk; do
    launchctl bootout "gui/$(id -u)/$label" >/dev/null 2>&1 || launchctl unload "$AGENT_DIR/$label.plist" >/dev/null 2>&1 || true
    rm -f "$AGENT_DIR/$label.plist"
  done
  ok "Removed the Hearth launch agents."
}

# ---- finish -------------------------------------------------------------------

wait_and_report() {
  step "Starting Hearth"
  local info=""
  for _ in $(seq 1 30); do
    # shellcheck disable=SC2016  # ${...} below is JavaScript, not shell
    info="$("$NODE" -e '
      fetch(`http://127.0.0.1:${process.argv[1]}/api/system`)
        .then((r) => r.json())
        .then((s) => {
          for (const u of s.urls) console.log(`${u.label}|${u.http}|${u.https || ""}`);
          process.exit(0);
        })
        .catch(() => process.exit(1));
    ' "$PORT" 2>/dev/null)" && break
    info=""
    sleep 1
  done
  if [ -z "$info" ]; then
    warn "Hearth didn't answer on port $PORT."
    if [ "$OS" = Linux ]; then say "See what went wrong: journalctl -u hearth -n 40 --no-pager"; else say "See what went wrong: tail -n 40 \"$LOG_DIR/hearth.log\""; fi
    exit 1
  fi

  printf '\n%s  Hearth is running.%s\n\n' "$GRN$B" "$RST"
  printf '    On this machine:  http://localhost:%s\n' "$PORT"
  local label http https
  while IFS='|' read -r label http https; do
    [ -n "$http" ] || continue
    printf '    %-17s %s%s\n' "$label:" "$http" "${https:+   (secure: $https)}"
  done <<<"$info"
  printf '\n    Open one of these on your tablet, then go to Settings > Connect devices\n'
  printf '    to install Hearth as an app.\n\n'
  if [ "$OS" = Linux ]; then
    printf '    %sManage:%s  systemctl status hearth  |  sudo systemctl restart hearth  |  journalctl -u hearth -f\n' "$DIM" "$RST"
  else
    printf '    %sManage:%s  launchctl kickstart -k gui/%s/com.hearth.server  (restart)  |  tail -f ~/Library/Logs/Hearth/hearth.log\n' "$DIM" "$RST" "$(id -u)"
  fi
  printf '    %sUpdate:%s  git pull && ./install.sh     %sRemove:%s ./install.sh --uninstall\n\n' "$DIM" "$RST" "$DIM" "$RST"
}

# ---- main ---------------------------------------------------------------------

printf '\n%sHearth installer%s  (%s, %s)\n' "$B" "$RST" "$([ "$OS" = Darwin ] && echo macOS || echo Linux)" "$APP_DIR"

if [ "$UNINSTALL" = 1 ]; then
  step "Removing Hearth's background service"
  if [ "$OS" = Darwin ]; then mac_uninstall; else linux_uninstall; fi
  say "Your data is still in $DATA_DIR. Delete that folder too if you want everything gone."
  exit 0
fi

if [ "$ROOT_WARNING" = 1 ]; then
  warn "Running as root, so the Hearth service will run as root too. A normal user account with sudo is safer."
fi
if [ "$OS" = Darwin ] && [ "$WANT_SERVICE" = 1 ]; then mac_privacy_check; fi
ensure_node
install_packages

if [ "$WANT_SERVICE" = 0 ]; then
  step "Done"
  say "Start Hearth with: $APP_DIR/scripts/start.sh   (or: npm start)"
  exit 0
fi

if [ "$OS" = Darwin ]; then
  mac_service
  if [ "$WANT_FIREWALL" = 1 ]; then mac_firewall; fi
  if [ "$WANT_KIOSK" = 1 ]; then mac_kiosk; fi
else
  linux_timezone_check
  linux_mdns
  linux_service
  if [ "$WANT_FIREWALL" = 1 ]; then linux_firewall; fi
  if [ "$WANT_KIOSK" = 1 ]; then linux_kiosk; fi
fi

if [ "$WANT_SERVICE" = 1 ]; then
  wait_and_report
else
  step "Done"
  say "Start Hearth with: $APP_DIR/scripts/start.sh"
fi
