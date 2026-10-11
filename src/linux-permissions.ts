/** Linux WebHID permission diagnostics (Task 2, linux-first).
 *
 * On Linux without the OpenMouse udev rules, Chromium's device picker still
 * lists the mouse, but the subsequent `HIDDevice.open()` rejects — surfacing
 * in the app as a generic "Connection failed". This module detects exactly
 * that case (Linux + picker succeeded + open denied) so the UI can show the
 * fix instead of the generic error. No HID driver code lives here: only
 * platform/error-shape checks and the installer command string.
 */

/** Owner/repo/ref serving the installer for the curl|bash fix command.
 * NOTE: flipped to `main` on merge of the linux-first branch. */
export const LINUX_UDEV_INSTALLER_URL =
  "https://raw.githubusercontent.com/gencayks/openmouse/main/scripts/install-linux.sh";

/** The exact command the panel offers (copied verbatim by its copy button). */
export function linuxUdevFixCommand(): string {
  return `curl -fsSL ${LINUX_UDEV_INSTALLER_URL} | sudo bash`;
}

export function isLinuxPlatform(userAgent = navigator.userAgent): boolean {
  const withData = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = withData.userAgentData?.platform;
  if (typeof platform === "string" && platform.length > 0) return platform.toLowerCase() === "linux";
  return /linux/i.test(userAgent);
}

/** True for the DOMException Chromium raises when the OS denies hidraw
 * access at open() time (picker already granted the device). Kept narrow:
 * the name must be a denial AND the message must read like an open failure,
 * so protocol-level errors after a successful open never match. */
export function isHidOpenDenied(error: unknown): boolean {
  if (!(error instanceof DOMException)) return false;
  if (error.name !== "NotAllowedError" && error.name !== "SecurityError") return false;
  return /failed to open|access denied|permission|not allowed/i.test(error.message);
}

export function describeDeniedDevice(device: { productName?: string | null; vendorId: number; productId: number }): string {
  const name = device.productName?.trim() || "the selected device";
  const ids = `VID 0x${device.vendorId.toString(16).padStart(4, "0")} PID 0x${device.productId.toString(16).padStart(4, "0")}`;
  return `${name} (${ids})`;
}
