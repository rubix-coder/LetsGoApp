#!/usr/bin/env bash
#
# build-deb.sh — package the LetsGo web app as a desktop .deb (Electron).
#
# The package is a 100% clone of the webapp: the same Vite bundle, rendered
# by Chromium, served from a bundled localhost server that also proxies /api
# same-origin to your self-hosted team backend (default upstream below, overridable in
# ~/.config/LetsGoWeb/config.json or $LETSGO_NAS_URL at runtime).
#
# Usage:  packaging/electron/build-deb.sh [--skip-build]
# Output: packaging/electron/dist/letsgo-webapp_<version>_amd64.deb
#
set -euo pipefail

export PATH="$HOME/.local/bin:$HOME/.local/opt/node/bin:$PATH"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

VERSION="$(node -p "require('$APP_ROOT/webapp/package.json').version")"

echo "==> [1/4] Sync shell version to webapp ($VERSION)"
(cd "$SCRIPT_DIR" && node -e "
  const fs = require('fs'), p = './package.json';
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  j.version = '$VERSION';
  fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
")

if [[ "${1:-}" != "--skip-build" ]]; then
  echo "==> [2/4] Building the webapp"
  (cd "$APP_ROOT" && pnpm --filter letsgo-webapp build)
else
  echo "==> [2/4] Skipping webapp build, using existing webapp/dist"
fi
[[ -f "$APP_ROOT/webapp/dist/index.html" ]] || { echo "webapp/dist missing" >&2; exit 1; }

echo "==> [3/4] Server tests"
(cd "$SCRIPT_DIR" && node test-server.cjs && node test-flatpak-update.cjs)

echo "==> [4/4] electron-builder"
(cd "$SCRIPT_DIR" && pnpm exec electron-builder --linux deb)

ls -lh "$SCRIPT_DIR"/dist/*.deb
