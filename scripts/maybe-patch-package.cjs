#!/usr/bin/env node
// Conditionally runs `patch-package` only when both (a) the patch-package
// module is resolvable and (b) a `patches/` directory exists in cwd.
//
// Why: this repo wires `patch-package` into the root `postinstall` so dev
// installs (and CI `npm ci`) replay patches in node_modules. End-users who
// run `npm install --omit=dev` against the published tarball have neither
// `patch-package` in node_modules nor a `patches/` dir (it isn't published).
// Without this guard the postinstall fails with exit 127 (`patch-package:
// not found`), breaking standalone installs and Docker smoke tests.
//
// See change: fix-electron-appimage-maker (regression of CI standalone-install-smoke).

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const patchesDir = path.resolve(process.cwd(), "patches");
if (!fs.existsSync(patchesDir)) {
  process.exit(0);
}

let patchPackageBin;
try {
  // Resolve the patch-package binary path via its package.json's `bin` field
  // without invoking npm; works on Windows where `which patch-package` is unreliable.
  const pkgJsonPath = require.resolve("patch-package/package.json");
  const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
  const binEntry = typeof pkgJson.bin === "string"
    ? pkgJson.bin
    : (pkgJson.bin && pkgJson.bin["patch-package"]);
  if (!binEntry) {
    process.exit(0);
  }
  patchPackageBin = path.resolve(path.dirname(pkgJsonPath), binEntry);
} catch {
  // patch-package not installed (e.g. `npm install --omit=dev`). No-op.
  process.exit(0);
}

const result = spawnSync(process.execPath, [patchPackageBin], { stdio: "inherit" });
process.exit(result.status ?? 1);
