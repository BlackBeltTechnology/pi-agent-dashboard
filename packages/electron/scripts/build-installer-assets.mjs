#!/usr/bin/env node
// =============================================================================
// build-installer-assets.mjs — derive NSIS installer assets from a master PNG.
//
// Inputs:
//   packages/electron/build/installer-assets/master.png  (Pi master mark)
//
// Outputs (build artifacts — gitignored, generated in CI before electron-builder):
//   installer-icon.ico    multi-res ICO (16/24/32/48/64/128/256)
//   uninstaller-icon.ico   same resolutions, grayscale-differentiated
//   welcome-banner.bmp     164x314 24-bit BMP (MUI2 welcome/finish sidebar)
//   header-banner.bmp      150x57  24-bit BMP (MUI2 page header)
//
// Deterministic: same master.png -> byte-identical outputs. Prints per-asset
// SHA-256 so CI can detect master-asset drift.
//
// Deps: sharp, png-to-ico (devDependencies of packages/electron).
// =============================================================================

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = resolve(__dirname, "..", "build", "installer-assets");
const MASTER = join(ASSETS_DIR, "master.png");

if (!existsSync(MASTER)) {
  console.error(`✗ master asset not found: ${MASTER}`);
  process.exit(1);
}

const { default: sharp } = await import("sharp");
const { default: pngToIco } = await import("png-to-ico");

// Deterministic output: disable libvips threading caches that can reorder
// pixels at the margins, and pin a stable background.
sharp.cache(false);
sharp.concurrency(1);

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function emit(name, buf) {
  const out = join(ASSETS_DIR, name);
  writeFileSync(out, buf);
  console.log(`  ${name.padEnd(22)} ${buf.length.toString().padStart(8)} B  sha256=${sha256(buf)}`);
}

// --- ICO (installer + uninstaller) -----------------------------------------
async function buildIco(srcBuf, grayscale) {
  const pngs = await Promise.all(
    ICO_SIZES.map((size) => {
      let img = sharp(srcBuf).resize(size, size, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      });
      if (grayscale) img = img.grayscale();
      return img.png({ compressionLevel: 9 }).toBuffer();
    }),
  );
  return pngToIco(pngs);
}

// --- BMP (24-bit, no alpha) -------------------------------------------------
// NSIS MUI2 bitmaps must be 24-bit BMP. sharp can emit BMP via raw -> manual
// header; simplest portable path is to flatten onto white and write BMP.
async function buildBmp(srcBuf, w, h) {
  const { data } = await sharp(srcBuf)
    .resize(w, h, { fit: "contain", background: { r: 255, g: 255, b: 255 } })
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // sharp raw is RGB top-to-bottom; BMP is BGR bottom-to-top, rows padded to 4 bytes.
  const rowSize = Math.floor((24 * w + 31) / 32) * 4;
  const pixelArraySize = rowSize * h;
  const fileSize = 54 + pixelArraySize;
  const buf = Buffer.alloc(fileSize, 0);
  buf.write("BM", 0, "ascii");
  buf.writeUInt32LE(fileSize, 2);
  buf.writeUInt32LE(54, 10); // pixel data offset
  buf.writeUInt32LE(40, 14); // DIB header size
  buf.writeInt32LE(w, 18);
  buf.writeInt32LE(h, 22);
  buf.writeUInt16LE(1, 26); // planes
  buf.writeUInt16LE(24, 28); // bpp
  buf.writeUInt32LE(pixelArraySize, 34);
  for (let y = 0; y < h; y++) {
    const srcY = h - 1 - y; // flip vertically
    let dst = 54 + y * rowSize;
    for (let x = 0; x < w; x++) {
      const src = (srcY * w + x) * 3;
      buf[dst++] = data[src + 2]; // B
      buf[dst++] = data[src + 1]; // G
      buf[dst++] = data[src]; // R
    }
  }
  return buf;
}

const master = readFileSync(MASTER);
console.log(`master.png            ${master.length.toString().padStart(8)} B  sha256=${sha256(master)}`);
console.log("Deriving installer assets:");

emit("installer-icon.ico", await buildIco(master, false));
emit("uninstaller-icon.ico", await buildIco(master, true));
emit("welcome-banner.bmp", await buildBmp(master, 164, 314));
emit("header-banner.bmp", await buildBmp(master, 150, 57));

console.log("✓ installer assets generated");
