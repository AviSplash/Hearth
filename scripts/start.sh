#!/usr/bin/env bash
# Runs Hearth in this terminal (Linux and macOS). Ctrl+C stops it.
# To run it in the background and start at boot instead, use ./install.sh.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

# The node on PATH, or a new-enough one from the usual install locations.
NODE=""
for candidate in "$(command -v node 2>/dev/null || true)" /usr/bin/node /usr/local/bin/node /opt/homebrew/bin/node; do
  if [ -z "$candidate" ] || [ ! -x "$candidate" ]; then continue; fi
  [ -n "$NODE" ] || NODE="$candidate"
  if [ "$("$candidate" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -ge 20 ]; then
    NODE="$candidate"
    break
  fi
done
if [ -z "$NODE" ]; then
  echo
  echo "  Node.js isn't installed. Run ./install.sh to set it up, or get it from https://nodejs.org"
  echo
  exit 1
fi
PATH="$(dirname "$NODE"):$PATH"
export PATH

if [ ! -d node_modules ]; then
  echo "  Installing Hearth - first run only, takes a minute..."
  npm ci --omit=dev --no-audit --no-fund --loglevel=error || npm install --omit=dev --no-audit --no-fund --loglevel=error
fi

exec "$NODE" server/index.js
