#!/usr/bin/env bash
#
# build-flatpak.sh — package LetsGo as a Flatpak.
#
# Pipeline:
#   1. build the webapp (Vite)                         -> webapp/dist
#   2. sync the shell version + run the server tests
#   3. electron-builder --linux dir                    -> packaging/electron/dist/linux-unpacked
#   4. stage launcher / desktop / metainfo / icons     -> packaging/flatpak/staging
#   5. flatpak-builder --repo=<repo> [--gpg-sign]      -> a single-commit OSTree repo
#   6. flatpak build-update-repo                       -> deltas + summary for `flatpak update`
#
# By default this installs the result into your --user installation, so
# `flatpak run com.rubixcoder.letsgo` works straight after.
#
# It also leaves an OSTree repo in packaging/flatpak/repo. You only need that
# if you intend to HOST updates yourself — serve it over HTTPS and set
# LETSGO_REPO_ORIGIN so a letsgo.flatpakrepo descriptor is written too.
# Otherwise ignore it, or export a single file to hand around:
#   flatpak build-bundle packaging/flatpak/repo letsgo.flatpak \
#     com.rubixcoder.letsgo master
#
# Usage:
#   packaging/flatpak/build-flatpak.sh [--skip-build] [--no-install]
#
# Env:
#   LETSGO_GPG_KEY   GPG key id to sign the repo with (recommended; required
#                    for a trustworthy OTA remote). Unset -> unsigned repo.
#   LETSGO_REPO_DIR   override the output repo dir.
#   LETSGO_REPO_ORIGIN base URL you will serve the repo from (enables the
#                     letsgo.flatpakrepo descriptor). Unset -> local repo only.
#   FLATPAK_BUILDER  override the flatpak-builder command (default: autodetect
#                    system `flatpak-builder`, else `flatpak run org.flatpak.Builder`).
#
set -euo pipefail

export PATH="$HOME/.local/bin:$HOME/.local/opt/node/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SHELL_DIR="$APP_ROOT/packaging/electron"
STAGING="$SCRIPT_DIR/staging"
BUILD_DIR="$SCRIPT_DIR/build"
REPO_DIR="${LETSGO_REPO_DIR:-$SCRIPT_DIR/repo}"
MANIFEST="$SCRIPT_DIR/com.rubixcoder.letsgo.yml"
APP_ID="com.rubixcoder.letsgo"

SKIP_BUILD=0
INSTALL=1
for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=1 ;;
    --no-install) INSTALL=0 ;;
    *) echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done

VERSION="$(node -p "require('$APP_ROOT/webapp/package.json').version")"
DATE="$(date -u +%Y-%m-%d)"
echo "==> LetsGo webapp Flatpak — v$VERSION"

# ── flatpak-builder command ────────────────────────────────────────────────
if [[ -n "${FLATPAK_BUILDER:-}" ]]; then
  FB=($FLATPAK_BUILDER)
elif command -v flatpak-builder >/dev/null 2>&1; then
  FB=(flatpak-builder)
elif flatpak info org.flatpak.Builder >/dev/null 2>&1; then
  FB=(flatpak run org.flatpak.Builder)
else
  echo "flatpak-builder not found. Install one of:" >&2
  echo "  sudo apt install flatpak-builder" >&2
  echo "  flatpak install --user flathub org.flatpak.Builder" >&2
  exit 1
fi
echo "==> flatpak-builder: ${FB[*]}"

# ── 1. webapp ──────────────────────────────────────────────────────────────
if [[ $SKIP_BUILD -eq 0 ]]; then
  echo "==> [1/6] Building the webapp"
  ( cd "$APP_ROOT" && pnpm --filter letsgo-webapp build )
else
  echo "==> [1/6] Skipping webapp build (--skip-build)"
fi
[[ -f "$APP_ROOT/webapp/dist/index.html" ]] || { echo "webapp/dist missing" >&2; exit 1; }

# ── 2. shell version + tests ───────────────────────────────────────────────
echo "==> [2/6] Sync shell version ($VERSION) + server tests"
node -e "
  const fs = require('fs'), p = '$SHELL_DIR/package.json';
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (j.version !== '$VERSION') { j.version = '$VERSION';
    fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n'); }
"
( cd "$SHELL_DIR" && node test-server.cjs && node test-flatpak-update.cjs )

# ── 3. electron-builder (unpacked dir) ─────────────────────────────────────
echo "==> [3/6] electron-builder --linux dir"
( cd "$SHELL_DIR" && [[ -d node_modules ]] || pnpm install )
( cd "$SHELL_DIR" && pnpm exec electron-builder --linux dir )
UNPACKED="$SHELL_DIR/dist/linux-unpacked"
[[ -x "$UNPACKED/letsgo-webapp" ]] || { echo "linux-unpacked/letsgo-webapp missing" >&2; exit 1; }

# ── 4. staging ─────────────────────────────────────────────────────────────
echo "==> [4/6] Stage build inputs"
rm -rf "$STAGING"
mkdir -p "$STAGING/linux-unpacked" "$STAGING/icons"
cp -a "$UNPACKED/." "$STAGING/linux-unpacked/"
install -m755 "$SCRIPT_DIR/letsgo-launcher" "$STAGING/letsgo-launcher"
install -m644 "$SCRIPT_DIR/$APP_ID.desktop" "$STAGING/$APP_ID.desktop"
sed -e "s/@VERSION@/$VERSION/g" -e "s/@DATE@/$DATE/g" \
  "$SCRIPT_DIR/$APP_ID.metainfo.xml.in" > "$STAGING/$APP_ID.metainfo.xml"
node "$SCRIPT_DIR/make-icons.mjs" "$STAGING/icons"

# ── 5. flatpak-builder → repo ─────────────────────────────────────────────
echo "==> [5/6] flatpak-builder"
SIGN=()
if [[ -n "${LETSGO_GPG_KEY:-}" ]]; then
  SIGN=(--gpg-sign="$LETSGO_GPG_KEY")
  echo "    signing with $LETSGO_GPG_KEY"
else
  echo "    WARNING: no LETSGO_GPG_KEY — repo will be unsigned (dev only)"
fi

INSTALL_ARGS=()
[[ $INSTALL -eq 1 ]] && INSTALL_ARGS=(--install --user)

"${FB[@]}" --force-clean --disable-rofiles-fuse \
  --repo="$REPO_DIR" "${SIGN[@]}" "${INSTALL_ARGS[@]}" \
  "$BUILD_DIR" "$MANIFEST"

# ── 6. repo metadata (deltas + summary) ──────────────────────────────────
echo "==> [6/6] build-update-repo"
# --prune-depth is what actually bounds growth: plain --prune only drops
# UNREACHABLE objects, and every published version stays reachable from its own
# commit. Depth 3 = current release plus two back (enough for deltas + rollback).
flatpak build-update-repo --generate-static-deltas --prune --prune-depth=3 \
  "${SIGN[@]}" "$REPO_DIR"

# A stable .flatpakrepo descriptor, emitted only when you are actually hosting
# the repo somewhere. Set LETSGO_REPO_ORIGIN to the base URL you will serve
# this OSTree repo from (the repo is expected at <origin>/flatpak/).
REPO_ORIGIN="${LETSGO_REPO_ORIGIN:-}"
if [[ -n "$REPO_ORIGIN" ]]; then
  REPO_ORIGIN="${REPO_ORIGIN%/}"
  GPG_LINE=""
  if [[ -n "${LETSGO_GPG_KEY:-}" ]]; then
    GPG_LINE="GPGKey=$(gpg --export "$LETSGO_GPG_KEY" | base64 -w0)"
  fi
  cat > "$REPO_DIR/letsgo.flatpakrepo" <<EOF
[Flatpak Repo]
Title=LetsGo
Url=$REPO_ORIGIN/flatpak/
Homepage=https://github.com/rubix-coder/LetsGoApp
Comment=LetsGo — update channel
Description=Local-first planner, self-hosted updates.
Icon=$REPO_ORIGIN/flatpak/icon.png
$GPG_LINE
EOF
else
  echo "    (no LETSGO_REPO_ORIGIN — skipping letsgo.flatpakrepo; local repo only)"
fi
cp "$STAGING/icons/256.png" "$REPO_DIR/icon.png"

echo
echo "==> Done. v$VERSION"
echo "    repo:   $REPO_DIR"
echo "    bundle: flatpak build-bundle '$REPO_DIR' letsgo.flatpak $APP_ID master"
[[ $INSTALL -eq 1 ]] && echo "    run:    flatpak run $APP_ID"
exit 0
