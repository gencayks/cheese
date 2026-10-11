import assert from "node:assert/strict";
import test from "node:test";

import {
  describeDeniedDevice,
  isHidOpenDenied,
  LINUX_UDEV_INSTALLER_URL,
  linuxUdevFixCommand,
} from "./linux-permissions.ts";

test("fix command is a curl-piped-to-sudo-bash one-liner", () => {
  const command = linuxUdevFixCommand();
  assert.match(command, /^curl -fsSL https:\/\/\S+ \| sudo bash$/);
  assert.ok(command.includes(LINUX_UDEV_INSTALLER_URL));
  assert.match(LINUX_UDEV_INSTALLER_URL, /^https:\/\/raw\.githubusercontent\.com\//);
});

test("open-denied matcher accepts Chromium's denial shapes", () => {
  assert.equal(isHidOpenDenied(new DOMException("Failed to open the device.", "NotAllowedError")), true);
  assert.equal(isHidOpenDenied(new DOMException("Access denied.", "NotAllowedError")), true);
  assert.equal(isHidOpenDenied(new DOMException("Failed to open the device.", "SecurityError")), true);
});

test("open-denied matcher rejects unrelated failures", () => {
  assert.equal(isHidOpenDenied(new DOMException("No device selected.", "NotFoundError")), false);
  assert.equal(isHidOpenDenied(new DOMException("The transfer failed.", "NotAllowedError")), false);
  assert.equal(isHidOpenDenied(new Error("Failed to open the device.")), false);
  assert.equal(isHidOpenDenied(null), false);
  assert.equal(isHidOpenDenied("Access denied."), false);
});

test("denied device label carries the USB IDs", () => {
  assert.equal(
    describeDeniedDevice({ productName: "Viper V2 Pro", vendorId: 0x1532, productId: 0x100 }),
    "Viper V2 Pro (VID 0x1532 PID 0x0100)",
  );
  assert.equal(
    describeDeniedDevice({ vendorId: 0x46d, productId: 0xc08b }),
    "the selected device (VID 0x046d PID 0xc08b)",
  );
});
