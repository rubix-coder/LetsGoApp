#!/bin/bash
set -e
if [ -f /etc/apparmor.d/letsgo-webapp ]; then
  if command -v apparmor_parser >/dev/null 2>&1; then
    apparmor_parser -R /etc/apparmor.d/letsgo-webapp 2>/dev/null || true
  fi
  rm -f /etc/apparmor.d/letsgo-webapp
fi
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database /usr/share/applications || true
fi
exit 0
