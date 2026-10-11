// Generates udev rules granting user access to every supported OpenMouse device.
//
// Source of truth for DEVICES: src/supported-devices-data.ts (brand/model/pids
// per device). Source of truth for VENDOR IDs: the @openmouse/protocol driver
// registry (src/device/ in this repo must stay driver-free — the wire protocol
// lives in that external library, so this script only reads its ID tables).
//
// How a (brand, pid) becomes a rule:
//   1. The script collects every (vendorId, productId) pair the protocol's
//      exported HID filters declare (data only — no driver code runs here).
//   2. Each device brand maps to a small set of vendor IDs (BRAND_VIDS),
//      every one evidenced by a protocol VENDOR_ID constant, driver match, or
//      driver product table — see the citations in the table below.
//   3. A pid keeps the filter-evidenced VIDs that belong to its brand's set
//      (this drops cross-vendor PID collisions, e.g. Razer 1532:002e vs the
//      Redragon M690 PRO's 258a:002e). A pid with no filter evidence falls
//      back to the brand's full VID set — those rules are marked as such.
//   4. Every emitted rule is narrowly scoped per device, TAG+="uaccess", in
//      the same shape as the VXE example in README.md ("Linux WebHID
//      permissions").
//
// Entries without pids cannot be scoped to a rule and are reported, not
// emitted. Any pid-bearing entry with NO vendor-ID mapping fails LOUDLY
// (non-zero exit) — the "diff against the device table" is that failure.
//
// Usage:
//   node scripts/generate-udev-rules.mjs            # write udev/70-openmouse.rules
//   node scripts/generate-udev-rules.mjs --check    # exit non-zero if the
//                                                  # checked-in file is stale
//
// Regenerate whenever src/supported-devices-data.ts or @openmouse/protocol
// changes, and commit the result alongside.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const RULES_PATH = join(root, "udev", "70-openmouse.rules");

// Every VID below is evidenced by @openmouse/protocol. Citation key:
//   V=x  — protocol drivers/vendors.js VENDOR_ID.<name> (decimal x)
//   F    — the brand's table PIDs appear under this VID in exported HID filters
//   D    — driver source match (constant / product table / code comment)
const BRAND_VIDS = {
  // brand: [vids..., citation]
  "Logitech": [0x046d], // V=1133 (usage-scoped HID++ filters carry no PIDs)
  "Razer": [0x1532], // V=5426
  "SteelSeries": [0x1038], // V=4152
  "Glorious": [0x258a, 0x22d4, 0x320f, 0x3794], // F (classic/core2 filter sets)
  "VAXEE": [0x3057], // V=12375, F
  "Mchose": [0x3837, 0x2023], // V=14391 (main), V=8227 (A5 1K dongle)
  "AJAZZ": [0xa8a4, 0xa8a5], // F (NJ07/NJ08 wired + dongle)
  "K-snake": [0xa8a4, 0xa8a5], // V (same ODM IDs as AJAZZ)
  "WLMouse": [0x36a7], // V=13991 (table PIDs match WLMOUSE_PRODUCTS)
  "Ninjutso": [0x093a, 0x1915], // V=2362 (current), V=6421 (legacy)
  "Lamzu": [0x373e, 0x3554, 0x37b0], // V=14142 (main), V=13652 (Atlantis), V=14256 (Inca)
  "VXE": [0x3554], // F + README VXE example (3554:f58e/f58f)
  "VGN": [0x3554], // V=13652, F
  "Teevolution": [0x3554], // V=13652, F
  "Endgame Gear": [0x3367], // V=13159 (usage-scoped filters carry no PIDs)
  "ATK": [0x373b], // V=14139, F (ATK ZERO 0x1154/0x1155)
  "Asus": [0x0b05], // V=2821, F
  "Corsair": [0x1b1c], // V=6940, F
  "Dareu": [0x260d], // V=9741, F
  "Delux": [0x1d57], // D (DELUX_OEM_VENDOR_ID; M800 Mini shares X11 PIDs)
  "Redragon": [0x04d9, 0x258a], // V=1241 (main), V=9610 (M690 PRO SinoWealth)
  "Finalmouse": [0x361d], // V=13853, F
  "Incott": [0x093a], // V=2362, F
  "Keychron": [0x3434], // V=13364, F
  "Microsoft": [0x045e], // V=1118, F
  "Orbital": [0x1915], // V=6421
  "RAWM": [0x1915], // V=6421, F
  "Ryunix": [0x04f3], // V=1267, F
  "Pulsar": [0x3710], // V=14096, F
  "HyperX": [0x0951, 0x03f0], // F (Kingston originals + HP-era)
  "Zaunkoenig": [0x0483], // V=1155, F
  "WALLHACK": [0x3879], // V=14457, F
  "Cooler Master": [0x2516], // V=9494
  "Lingbao": [0x3151], // F (GearHub-V5 receivers, per GEARHUB_HID_FILTERS note)
  "Noir Gear": [0x3554], // D-family (M1-NEX matches LAMZU_ATLANTIS_VENDOR_ID;
  // M2-NEX/E1 PID 0x2255 itself is unpinned — see heuristic flag below)
  "IPI": [0x372e], // D (bytech driver binds BYTECH_VENDOR_ID for IPI Float 88)
  "CRDRAKO": [0x373e], // D (lamzu driver product table: KO-ONE 0x006a/0x006b)
  "LunaFury": [0x373e], // D (lamzu driver product table: LUNA33/TYPE33)
};

// Per-model narrowing inside multi-VID brands. First match wins; each entry
// is evidenced by driver source. (attackshark/hid.js header: 0x1d57 = X11
// family on shared PIDs, 0x25a7 = X3/X6/X8/X11 direct, 0x373e = R5/R6/R8/R3
// Lamzu OEM; R2/R3 0x402d/0x4026 are GearHub 0x3151 per GEARHUB_HID_FILTERS.)
const MODEL_VIDS = [
  ["Attack Shark", /\bX11\b/i, [0x1d57, 0x25a7]],
  ["Attack Shark", /\bR5\b/i, [0x373e]],
  ["Attack Shark", /\bR2\b/i, [0x3151]],
  ["Attack Shark", /\bR3\b/i, [0x3151, 0x373e]],
  // Lamzu mainline (Maya X) answers the lamzu driver table under 0x373e;
  // Atlantis has its own LAMZU_ATLANTIS_VENDOR_ID (0x3554).
  ["Lamzu", /maya/i, [0x373e]],
  ["Lamzu", /atlantis/i, [0x3554]],
  // 0x2023 is the Mchose A5-dongle VID (MCHOSE_A5_HID_FILTERS); the A7 line
  // is mainline 0x3837.
  ["Mchose", /\bA7\b/i, [0x3837]],
];

function vidsFor(brand, model) {
  for (const [b, re, vids] of MODEL_VIDS) {
    if (b === brand && re.test(model)) return vids;
  }
  return BRAND_VIDS[brand];
}

const hex4 = (n) => n.toString(16).padStart(4, "0");
const ruleFor = (vid, pid) =>
  `SUBSYSTEM=="hidraw", ATTRS{idVendor}=="${hex4(vid)}", ATTRS{idProduct}=="${hex4(pid)}", TAG+="uaccess"`;

const vendors = await import("@openmouse/protocol/drivers/vendors");
const { SUPPORTED_DEVICES } = await import(pathToFileURL(join(root, "src", "supported-devices-data.ts")).href);

// pid -> set of VIDs declared anywhere in the protocol's exported HID filters.
const filterVids = new Map();
for (const value of Object.values(vendors)) {
  if (!Array.isArray(value)) continue;
  for (const f of value) {
    if (f && typeof f === "object" && f.vendorId && f.productId !== undefined) {
      if (!filterVids.has(f.productId)) filterVids.set(f.productId, new Set());
      filterVids.get(f.productId).add(f.vendorId);
    }
  }
}

const missing = []; // pid-bearing entries with no VID mapping (fatal)
const heuristic = []; // emitted on brand VID only, pid unpinned anywhere (review)
const skipped = []; // entries without pids (cannot scope a rule)
const rules = new Map(); // rule line -> comment label

for (const entry of SUPPORTED_DEVICES) {
  const { brand, model } = entry;
  if (!entry.pids?.length) {
    skipped.push(`${brand} ${model}`);
    continue;
  }
  const vids = vidsFor(brand, model);
  if (!vids?.length) {
    missing.push(`${brand} ${model} (pids ${entry.pids.map((p) => "0x" + p.toString(16)).join(", ")})`);
    continue;
  }
  for (const pid of entry.pids) {
    const evidenced = filterVids.get(pid);
    let use = evidenced ? [...evidenced].filter((v) => vids.includes(v)) : [];
    const pinned = use.length > 0;
    if (!pinned) use = vids;
    // Fallback = the pid is not pinned to this brand's VID(s) anywhere in
    // the protocol filters. The rule is still correct when the brand VID is
    // right (driver constant / product table), but flag it for review.
    // (Noir M2-NEX/E1 0x2255 is the weakest: only the family VID is known.)
    if (!pinned) heuristic.push(`${brand} ${model} 0x${pid.toString(16)} under ${use.map((v) => "0x" + v.toString(16)).join("/")}`);
    for (const vid of use) {
      const line = ruleFor(vid, pid);
      if (!rules.has(line)) rules.set(line, `${brand} ${model}${pinned ? "" : " (brand-VID fallback)"}`);
    }
  }
}

const header = `# OpenMouse Linux hidraw access rules.
#
# AUTO-GENERATED — do not edit by hand. Regenerate with:
#   node scripts/generate-udev-rules.mjs
# Sources: src/supported-devices-data.ts (devices) x
# @openmouse/protocol driver registry (vendor IDs; see the generator's
# BRAND_VIDS citations). Chromium opens the HID device before OpenMouse
# selects its vendor collection, so every VID:PID gets its own hidraw node.
#
# Install with: sudo ./scripts/install-linux.sh
`;

const grouped = [];
let lastLabel = null;
for (const [line, label] of [...rules.entries()].sort(([a, la], [b, lb]) =>
  la < lb ? -1 : la > lb ? 1 : a < b ? -1 : 1,
)) {
  if (label !== lastLabel) {
    grouped.push(`# ${label}`);
    lastLabel = label;
  }
  grouped.push(line);
}
const out = `${header}\n${grouped.join("\n")}\n`;

if (process.argv.includes("--check")) {
  const current = readFileSync(RULES_PATH, "utf8");
  if (current !== out) {
    console.error(`STALE: ${RULES_PATH} differs from regenerated output.`);
    console.error("Run `node scripts/generate-udev-rules.mjs` and commit the result.");
    process.exit(1);
  }
} else {
  mkdirSync(dirname(RULES_PATH), { recursive: true });
  writeFileSync(RULES_PATH, out);
}

console.log(`devices with rules: ${SUPPORTED_DEVICES.length - skipped.length - new Set(missing.map((m) => m.split(" (")[0])).size}`);
console.log(`rules emitted: ${rules.size} -> ${RULES_PATH}`);
console.log(`entries without pids (skipped, cannot scope): ${skipped.length}`);
if (heuristic.length) {
  console.log(`brand-VID fallbacks (pid unpinned in protocol filters — review):`);
  for (const h of heuristic) console.log(`  heuristic: ${h}`);
}
if (missing.length) {
  console.error(`MISSING VENDOR-ID MAPPING — no rules emitted for:`);
  for (const m of missing) console.error(`  MISSING: ${m}`);
  console.error("Add the brand to BRAND_VIDS in scripts/generate-udev-rules.mjs with a protocol citation.");
  process.exit(1);
}
