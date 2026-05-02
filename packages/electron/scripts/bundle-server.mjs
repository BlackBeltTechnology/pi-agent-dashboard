#!/usr/bin/env node
/**
 * Bundle the dashboard server into Electron's resources.
 * Creates resources/server/ with the server source, shared types,
 * and a minimal node_modules with production dependencies.
 *
 * For cross-platform builds, use --source-only to skip npm install
 * (native modules must be built on the target platform).
 *
 * Usage:
 *   node packages/electron/scripts/bundle-server.mjs
 *   node packages/electron/scripts/bundle-server.mjs --source-only
 *
 * Replaces bundle-server.sh — same operations, no MSYS/bash dependency.
 * `cp -R` → `fs.cpSync`, `find` → recursive `readdir`, `chmod` →
 * `fs.chmodSync`, `du` → recursive size sum, `xattr -d` → spawn (macOS
 * only). Path math via `path.resolve` / `path.join` so Win32 drive
 * letters and POSIX absolute paths both round-trip correctly.
 *
 * See change: eliminate-bash-on-windows-runners.
 */
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
  chmodSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ELECTRON_DIR = path.resolve(__dirname, "..");
const PROJECT_DIR = path.resolve(ELECTRON_DIR, "..", "..");
const SERVER_BUNDLE = path.join(ELECTRON_DIR, "resources", "server");

// ── parse args ────────────────────────────────────────────────────────────
const SOURCE_ONLY = process.argv.slice(2).includes("--source-only");

console.log("→ Bundling dashboard server...");

// ── clean & re-create target structure ───────────────────────────────────
rmSync(SERVER_BUNDLE, { recursive: true, force: true });
mkdirSync(path.join(SERVER_BUNDLE, "packages"), { recursive: true });
// Client lands under packages/dist/client/ so the server can find it
// (server.ts resolves path.join(__dirname, '../../dist/client') from
// packages/server/src/).
mkdirSync(path.join(SERVER_BUNDLE, "packages", "dist", "client"), {
  recursive: true,
});

// ── copy workspace source ────────────────────────────────────────────────
for (const pkg of ["server", "shared", "extension"]) {
  cpSync(
    path.join(PROJECT_DIR, "packages", pkg),
    path.join(SERVER_BUNDLE, "packages", pkg),
    { recursive: true, dereference: false },
  );
}

// ── locate built client ──────────────────────────────────────────────────
const clientCandidates = [
  path.join(PROJECT_DIR, "dist", "client"),
  path.join(PROJECT_DIR, "packages", "dist"),
  path.join(PROJECT_DIR, "packages", "client", "dist"),
];
let clientSrc = "";
for (const c of clientCandidates) {
  if (existsSync(path.join(c, "index.html"))) {
    clientSrc = c;
    break;
  }
}
if (clientSrc) {
  cpSync(clientSrc, path.join(SERVER_BUNDLE, "packages", "dist", "client"), {
    recursive: true,
    dereference: false,
  });
  console.log(`  Client copied from ${clientSrc}`);
} else {
  console.log(
    "  WARNING: No built client found — server will run in API-only mode",
  );
}

// ── synthetic workspace package.json ─────────────────────────────────────
// NOTE: intentionally NO "type": "module" here — node_modules contain CJS
// packages (e.g. node-pty) that break if loaded as ESM.
//
// pi-coding-agent is intentionally NOT declared as a dependency here.
// Architectural rationale: the dashboard ships pi/tsx/openspec via the
// offline cacache (`offline-packages.json` + `offline-packages/`) which
// `installStandalone()` extracts into `~/.pi-dashboard/` on first run.
// At runtime, server-lifecycle.ts resolves tsx (preferred) and jiti
// (fallback) from the managed dir first, then system pi. Bundling pi
// inside this tree would duplicate it (~10MB) and create version-drift
// risk against the offline cacache pin. The original D5 in the design
// proposed this; pushed back during review — see change:
// fix-electron-windows-installer-and-server-bootstrap (D5 reconsidered).
const bundlePkg = {
  name: "pi-dashboard-bundled-server",
  private: true,
  workspaces: ["packages/server", "packages/shared", "packages/extension"],
};
writeFileSync(
  path.join(SERVER_BUNDLE, "package.json"),
  JSON.stringify(bundlePkg, null, 2) + "\n",
);

// ── source-only short-circuit ────────────────────────────────────────────
if (SOURCE_ONLY) {
  console.log("  Source-only mode — skipping npm install (run on target platform)");
  const sizeH = humanBytes(dirSizeBytes(SERVER_BUNDLE));
  console.log(`✓ Server source bundled (${sizeH}) at ${SERVER_BUNDLE}`);
  process.exit(0);
}

// ── npm install --omit=dev ───────────────────────────────────────────────
// When TARGET_ARCH is set (cross-arch macOS local builds via --mac-both),
// we forward it as `npm_config_target_arch` so native module prebuilds
// (notably node-pty's prebuilds/darwin-<arch>/pty.node) are downloaded
// for the target arch rather than the host arch. Defense-in-depth
// alongside the `arch -x86_64` wrapper used by build-installer.sh on
// Apple Silicon hosts requesting --arch x64.
// See change: add-darwin-x64-build.
const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const targetArch = process.env.TARGET_ARCH;
const npmEnv = targetArch
  ? { ...process.env, npm_config_target_arch: targetArch }
  : process.env;
if (targetArch) {
  console.log(`  TARGET_ARCH=${targetArch} — setting npm_config_target_arch`);
}
const npmInstall = spawnSync(
  npmCmd,
  ["install", "--omit=dev", "--no-audit", "--no-fund"],
  {
    cwd: SERVER_BUNDLE,
    encoding: "utf8",
    env: npmEnv,
    // shell:true on Windows so npm.cmd is found via PATHEXT.
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "pipe"],
  },
);
// Mirror the bash script's `|| true`: print the tail and continue. Real
// failures are caught by the next-step file-shape checks.
const npmOut = (npmInstall.stdout || "") + (npmInstall.stderr || "");
const tail = npmOut.trim().split(/\r?\n/).slice(-5).join("\n");
if (tail) console.log(tail);

// ── strip __tests__ from workspace source ────────────────────────────────
for (const pkg of ["server", "shared", "extension"]) {
  rmSync(path.join(SERVER_BUNDLE, "packages", pkg, "src", "__tests__"), {
    recursive: true,
    force: true,
  });
}

// ── strip cruft from node_modules ────────────────────────────────────────
const NM = path.join(SERVER_BUNDLE, "node_modules");
if (existsSync(NM)) {
  // Files: *.md, *.map, CHANGELOG*, LICENSE*, *.d.ts
  // Dirs: __tests__, test
  walkAndPrune(NM, {
    fileMatch: (n) =>
      n.endsWith(".md") ||
      n.endsWith(".map") ||
      n.startsWith("CHANGELOG") ||
      n.startsWith("LICENSE") ||
      n.endsWith(".d.ts"),
    dirMatch: (n) => n === "__tests__" || n === "test",
  });
}

// ── fix spawn-helper +x on POSIX (npm hoisting may skip postinstall) ─────
if (process.platform !== "win32") {
  let fixed = 0;
  walkPaths(SERVER_BUNDLE, (p, name) => {
    if (name === "spawn-helper") {
      try {
        chmodSync(p, 0o755);
        fixed += 1;
      } catch {}
    }
  });
  if (fixed > 0) console.log(`  Fixed spawn-helper execute permissions (${fixed} file(s))`);
}

// ── strip macOS quarantine flags from native binaries ────────────────────
if (process.platform === "darwin") {
  const nodePtyDir = path.join(NM, "node-pty");
  if (existsSync(nodePtyDir)) {
    const targets = [];
    walkPaths(nodePtyDir, (p, name) => {
      if (name === "spawn-helper" || name.endsWith(".node")) targets.push(p);
    });
    for (const t of targets) {
      // xattr is macOS-only; ignore failures (xattr -d on a file without the
      // attr exits 1 but is harmless).
      spawnSync("xattr", ["-d", "com.apple.quarantine", t], { stdio: "ignore" });
    }
    if (targets.length > 0) {
      console.log(`  Removed quarantine flags from ${targets.length} node-pty binar(ies)`);
    }
  }
}

// ── final size report ────────────────────────────────────────────────────
const finalSize = humanBytes(dirSizeBytes(SERVER_BUNDLE));
console.log(`✓ Server bundled (${finalSize}) at ${SERVER_BUNDLE}`);

// ────────────────────────────────────────────────────────────────────────
// helpers
// ────────────────────────────────────────────────────────────────────────

/**
 * Recursively visit every file under `root`, calling `cb(absPath, name)`
 * for files only. Directories are descended but not yielded.
 */
function walkPaths(root, cb) {
  const stack = [root];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      entries = readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) {
        stack.push(full);
      } else if (e.isFile()) {
        try {
          cb(full, e.name);
        } catch {}
      }
    }
  }
}

/**
 * Recursively walk and delete files matching `fileMatch(name)` and
 * directories matching `dirMatch(name)`. Mirrors the original
 * bash `find ... -delete` and `find ... -exec rm -rf {} +` logic.
 */
function walkAndPrune(root, { fileMatch, dirMatch }) {
  // Two-pass: first collect targets so deletions don't disturb the walk.
  const fileTargets = [];
  const dirTargets = [];
  const stack = [root];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      entries = readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) {
        if (dirMatch(e.name)) {
          dirTargets.push(full);
        } else {
          stack.push(full);
        }
      } else if (e.isFile() && fileMatch(e.name)) {
        fileTargets.push(full);
      }
    }
  }
  for (const f of fileTargets) {
    try {
      unlinkSync(f);
    } catch {}
  }
  for (const d of dirTargets) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {}
  }
}

/**
 * Recursive directory size in bytes. Sums file sizes only; matches
 * `du -sh` semantics closely enough for the report. Defensively
 * try/catches every fs call so symlink loops / permission errors
 * don't abort the script.
 */
function dirSizeBytes(dir) {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      entries = readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) {
        stack.push(full);
      } else if (e.isFile()) {
        try {
          total += statSync(full).size;
        } catch {}
      }
    }
  }
  return total;
}

function humanBytes(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}K`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}M`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)}G`;
}
