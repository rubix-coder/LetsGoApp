#!/bin/bash
# Replaces electron-builder's stock postinst, so it must also do the stock
# work (SUID sandbox helper, desktop DB refresh).
set -e

chmod 4755 '/opt/LetsGoWeb/chrome-sandbox' || true

# Ubuntu 24.04+ restricts unprivileged user namespaces via AppArmor, which
# breaks Chromium's sandbox for any unconfined binary — the app would crash
# on launch. Grant userns to exactly this executable (same approach as the
# Chrome/VS Code debs).
if [ -d /etc/apparmor.d ] && command -v apparmor_parser >/dev/null 2>&1; then
  cat > /etc/apparmor.d/letsgo-webapp <<'EOF'
abi <abi/4.0>,
include <tunables/global>

profile letsgo-webapp /opt/LetsGoWeb/letsgo-webapp flags=(unconfined) {
  userns,
  include if exists <local/letsgo-webapp>
}
EOF
  apparmor_parser -r /etc/apparmor.d/letsgo-webapp 2>/dev/null || true
fi

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database /usr/share/applications || true
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -q /usr/share/icons/hicolor || true
fi
exit 0
