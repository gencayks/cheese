#!/usr/bin/env bash
# One-command installer for the Cheese Linux hidraw access rules.
#
# Installs the rules to /etc/udev/rules.d/70-cheese.rules so
# Chromium/WebHID can open supported mice without running as root, reloads
# udev, and prints the unplug/reconnect step that applies the rules.
#
# Usage:
#   ./scripts/install-linux.sh            # from a checkout; re-runs sudo itself
#   curl -fsSL <installer-url> | sudo bash   # no checkout needed; the rules
#                                            # are downloaded instead
#
# From a checkout the rules are generated from src/supported-devices-data.ts;
# when node is available this script regenerates them first so the installed
# file always matches the checkout. Without a checkout (curl|bash) the rules
# are fetched from RULES_URL (override with CHEESE_RULES_URL).

set -euo pipefail

DEST="/etc/udev/rules.d/70-cheese.rules"
# NOTE: flipped to `main` on merge of the linux-first branch.
RULES_URL="${CHEESE_RULES_URL:-https://raw.githubusercontent.com/gencayks/cheese/main/udev/70-cheese.rules}"

# A piped script has no file backing ($0 is "bash"); only re-exec via sudo
# when this script exists on disk, otherwise a re-exec would hang on stdin.
SCRIPT_FILE="${BASH_SOURCE[0]:-$0}"
if [ "$(id -u)" -ne 0 ]; then
    if [ -f "${SCRIPT_FILE}" ]; then
        exec sudo -- "${SCRIPT_FILE}" "$@"
    fi
    echo "Run this script as root (e.g. curl ... | sudo bash)." >&2
    exit 1
fi

SOURCE=""
CLEANUP=""
if [ -f "${SCRIPT_FILE}" ]; then
    SNAPSHOT="$(cd -- "$(dirname -- "${SCRIPT_FILE}")/.." && pwd)/udev/70-cheese.rules"
    if [ -f "${SNAPSHOT}" ]; then
        if command -v node >/dev/null 2>&1; then
            # Regenerate first so the installed file always matches this
            # checkout (this also refreshes the snapshot — commit it if it
            # changed). A failed regeneration still installs the snapshot.
            node "$(dirname -- "${SNAPSHOT}")/../scripts/generate-udev-rules.mjs" >/dev/null \
                || echo "regeneration failed; installing the checked-in snapshot." >&2
        else
            echo "node not found; installing the checked-in snapshot." >&2
        fi
        SOURCE="${SNAPSHOT}"
    fi
fi
if [ -z "${SOURCE}" ]; then
    SOURCE="$(mktemp)"
    CLEANUP="${SOURCE}"
    if command -v curl >/dev/null 2>&1; then
        curl -fsSL "${RULES_URL}" -o "${SOURCE}"
    elif command -v wget >/dev/null 2>&1; then
        wget -qO "${SOURCE}" "${RULES_URL}"
    else
        echo "Need curl or wget to download the rules." >&2
        exit 1
    fi
fi

install -m 0644 "${SOURCE}" "${DEST}"
if [ -n "${CLEANUP}" ]; then rm -f "${CLEANUP}"; fi
udevadm control --reload-rules
# Best effort: re-apply rules to already-plugged devices so a reconnect is
# often unnecessary. Unplugging still always works — see below.
udevadm trigger --subsystem-match=hidraw --action=change || true

cat <<'EOF'

Cheese udev rules installed. Unplug your mouse (and its wireless
receiver, if it has one) and plug it back in, then reload the Cheese
page and connect the device again.

If the browser still reports "Failed to open the device", find your
mouse's USB IDs and check the installed file covers them:

  lsusb                                  # note the ID, e.g. 046d:c08b
  grep -i "c08b" /etc/udev/rules.d/70-cheese.rules
EOF
