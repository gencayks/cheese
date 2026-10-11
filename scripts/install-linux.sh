#!/usr/bin/env bash
# One-command installer for the OpenMouse Linux hidraw access rules.
#
# Installs udev/70-openmouse.rules to /etc/udev/rules.d/70-openmouse.rules so
# Chromium/WebHID can open supported mice without running as root, reloads
# udev, and prints the unplug/reconnect step that applies the rules.
#
# Usage:
#   ./scripts/install-linux.sh            # re-runs sudo itself when needed
#
# The rules are generated from src/supported-devices-data.ts; when node is
# available this script regenerates them first so the installed file always
# matches the checkout. Without node it installs the checked-in snapshot.

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${0}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
SNAPSHOT="${REPO_ROOT}/udev/70-openmouse.rules"
DEST="/etc/udev/rules.d/70-openmouse.rules"

if [ "$(id -u)" -ne 0 ]; then
    exec sudo -- "${0}" "$@"
fi

SOURCE="${SNAPSHOT}"
if command -v node >/dev/null 2>&1; then
    # Regenerate first so the installed file always matches this checkout.
    # (This also refreshes the snapshot — commit it if it changed.)
    node "${REPO_ROOT}/scripts/generate-udev-rules.mjs" >/dev/null
else
    echo "node not found; installing the checked-in snapshot." >&2
fi

install -m 0644 "${SOURCE}" "${DEST}"
udevadm control --reload-rules
# Best effort: re-apply rules to already-plugged devices so a reconnect is
# often unnecessary. Unplugging still always works — see below.
udevadm trigger --subsystem-match=hidraw --action=change || true

cat <<'EOF'

OpenMouse udev rules installed. Unplug your mouse (and its wireless
receiver, if it has one) and plug it back in, then reload the OpenMouse
page and connect the device again.

If the browser still reports "Failed to open the device", find your
mouse's USB IDs and check the installed file covers them:

  lsusb                                  # note the ID, e.g. 046d:c08b
  grep -i "c08b" /etc/udev/rules.d/70-openmouse.rules
EOF
