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
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
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

// Phase 1 of change: eliminate-electron-runtime-install (R3 dep lift).
// pi/openspec/tsx are regular `dependencies` of packages/server/package.json.
// They get materialized under resources/server/node_modules/ by the
// `npm install --omit=dev` step below — same as every other workspace
// dep. No synthetic dependency block needed at this layer.
// `offline-packages.json` is vestigial and removed in Phase 5.

// ── clean & re-create target structure ───────────────────────────────────
rmSync(SERVER_BUNDLE, { recursive: true, force: true });
mkdirSync(path.join(SERVER_BUNDLE, "packages"), { recursive: true });
// Client lands under packages/dist/client/ so the server can find it
// (server.ts resolves path.join(__dirname, '../../dist/client') from
// packages/server/src/).
mkdirSync(path.join(SERVER_BUNDLE, "packages", "dist", "client"), {
  recursive: true,
});

// ── copy workspace source ─────────────────────────────────────────────────────────
// dashboard-plugin-runtime: included so the server-side plugin loader
// (e.g. pluginRegistryHash exported from server/loader.ts) ships with the
// bundle. Without this, npm install resolves it from the registry, which
// can be older than the working-tree HEAD and miss symbols added in the
// current dev cycle (e.g. pluginRegistryHash). Symlink materialization
// below normalizes node_modules/@blackbelt-technology/* into a copy.
const BUNDLED_WORKSPACE_PKGS = [
  "server",
  "shared",
  "extension",
  "dashboard-plugin-runtime",
];
for (const pkg of BUNDLED_WORKSPACE_PKGS) {
  cpSync(
    path.join(PROJECT_DIR, "packages", pkg),
    path.join(SERVER_BUNDLE, "packages", pkg),
    { recursive: true, dereference: false },
  );
}

// ── copy first-party plugins ───────────────────────────────────────────────────────
// Monorepo plugin packages ship inside `resources/plugins/<id>/` so the
// runtime `findBundledPluginsDir()` walk-up locates them after extraction
// (lands at `~/.pi-dashboard/resources/plugins/`). Without this, every
// fresh Electron install sees zero plugins because:
//   1. `findMonorepoRoot()` can't find pnpm-workspace.yaml under the
//      managed dir,
//   2. `findInstalledPluginsDir()` looks at `~/.pi/dashboard/plugins/` which
//      only third-party installs populate,
//   3. `findBundledPluginsDir()` walks up from loader.ts for
//      `resources/plugins/` — the path we feed here.
//
// Fixture-only plugins (manifest.fixture === true, e.g. demo-plugin) are
// excluded — same rule as the build-time PLUGIN_REGISTRY filter in
// production builds.
// See change: add-plugin-activation-ui (deployment gap follow-up).
const BUNDLED_PLUGINS = [
  "roles-plugin",
  "jj-plugin",
  "flows-plugin",
  "honcho-plugin",
  "flows-anthropic-bridge-plugin",
];
const BUNDLED_PLUGINS_DIR = path.join(SERVER_BUNDLE, "resources", "plugins");
mkdirSync(BUNDLED_PLUGINS_DIR, { recursive: true });
for (const pluginDir of BUNDLED_PLUGINS) {
  const src = path.join(PROJECT_DIR, "packages", pluginDir);
  if (!existsSync(path.join(src, "package.json"))) continue;
  // Read manifest to honour fixture flag.
  try {
    const raw = JSON.parse(readFileSync(path.join(src, "package.json"), "utf-8"));
    if (raw?.["pi-dashboard-plugin"]?.fixture === true) continue;
  } catch {
    /* parse error — skip defensively */
  }
  const dst = path.join(BUNDLED_PLUGINS_DIR, pluginDir);
  cpSync(src, dst, { recursive: true, dereference: false });
}
console.log(
  `  Bundled ${BUNDLED_PLUGINS.length} first-party plugin(s) into resources/plugins/`,
);

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
// pi-coding-agent / openspec / tsx are declared as production dependencies
// here so the `npm install --omit=dev` step below materializes them under
// `resources/server/node_modules/`. The .app then ships a complete
// pre-installed runtime — no offline cacache, no runtime install into
// `~/.pi-dashboard/`. Versions come from `offline-packages.json` until
// Phase 5 of change: eliminate-electron-runtime-install collapses the pin
// source into a constant in this file.
//
// This reverses the prior architectural decision (D5 in change:
// fix-electron-windows-installer-and-server-bootstrap) which kept pi out of
// the bundle to defer to an in-place `/api/pi-core/update` upgrader. That
// upgrade path is removed in Phase 3; the bundle is now the single source
// of truth for pi/openspec/tsx versions, refreshed via electron-updater
// whole-.app replacement.
const bundlePkg = {
  name: "pi-dashboard-bundled-server",
  private: true,
  workspaces: BUNDLED_WORKSPACE_PKGS.map((p) => `packages/${p}`),
};
writeFileSync(
  path.join(SERVER_BUNDLE, "package.json"),
  JSON.stringify(bundlePkg, null, 2) + "\n",
);

// ── ship manual-launch helpers ────────────────────────────────────────
// Three self-locating scripts at the server-bundle root that boot the
// bundled dashboard server without the Electron wrapper and without a
// system Node install. See packages/electron/scripts/server-launch-helpers/
// README.md. Used by testers and CI smoke. Argv shape matches
// packages/shared/src/platform/node-spawn.ts::buildNodeImportArgvParts.
// See change: add-bundle-manual-launch-scripts.
const LAUNCH_HELPERS_DIR = path.join(
  ELECTRON_DIR,
  "scripts",
  "server-launch-helpers",
);
const LAUNCH_HELPER_FILES = [
  "start-server.cmd",
  "start-server.ps1",
  "start-server.sh",
  "README.md",
];
for (const name of LAUNCH_HELPER_FILES) {
  const src = path.join(LAUNCH_HELPERS_DIR, name);
  const dst = path.join(SERVER_BUNDLE, name);
  cpSync(src, dst);
  // Preserve executable bit on the .sh helper. Some host filesystems
  // (notably Docker bind-mounts from macOS) strip the bit during cpSync.
  if (name.endsWith(".sh") && process.platform !== "win32") {
    try { chmodSync(dst, 0o755); } catch { /* best-effort */ }
  }
}
console.log(
  `  Bundled ${LAUNCH_HELPER_FILES.length} launch helper(s) into server bundle root`,
);

// ── source-only short-circuit ────────────────────────────────────────────
// Strip dev-only files early — must run BEFORE the source-only
// short-circuit so Docker cross-builds also benefit. Two reasons:
//   1. These files don't belong in the production runtime bundle.
//   2. macOS xattrs (`@` flag) on these files confuse Docker Desktop's
//      filesystem virtualization, producing EACCES during electron-
//      forge's asar pack step.
for (const pkg of BUNDLED_WORKSPACE_PKGS) {
  // Top-level test / lint / config files
  for (const cfg of [
    "vitest.config.ts",
    "vitest.config.js",
    "vite.config.ts",
    "vite.config.js",
    ".eslintrc.cjs",
    ".eslintrc.json",
    "eslint.config.js",
    "eslint.config.mjs",
    "tsconfig.tsbuildinfo",
  ]) {
    rmSync(path.join(SERVER_BUNDLE, "packages", pkg, cfg), { force: true });
  }
  rmSync(path.join(SERVER_BUNDLE, "packages", pkg, "src", "__tests__"), {
    recursive: true,
    force: true,
  });
}
// Recursively strip TypeScript incremental build cache anywhere in the bundle.
walkPaths(SERVER_BUNDLE, (p, name) => {
  if (name === "tsconfig.tsbuildinfo" || name.endsWith(".tsbuildinfo")) {
    try { rmSync(p, { force: true }); } catch {}
  }
});
// On macOS hosts, recursively strip extended attributes from the entire
// bundle. Without this, Docker Desktop's filesystem layer can mis-translate
// the `com.apple.quarantine` xattr into broken Linux perms inside the
// container, surfacing as random EACCES on otherwise-valid files.
if (process.platform === "darwin") {
  try {
    spawnSync("xattr", ["-cr", SERVER_BUNDLE], { stdio: "ignore" });
  } catch { /* xattr is macOS-only and best-effort */ }
}

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

// ── GO/NO-GO: assert node-pty prebuilds for all required targets ────────
// Phase 1.1.k of eliminate-electron-runtime-install. node-pty@1.2.0-beta.13
// ships prebuilds for all six triples; if a future bump regresses the set,
// fail the build here rather than at user-install time.
{
  const prebuildsDir = path.join(SERVER_BUNDLE, "node_modules", "node-pty", "prebuilds");
  const required = ["darwin-arm64", "darwin-x64", "linux-x64", "win32-x64"];
  const advisory = ["linux-arm64", "win32-arm64"];
  const missingRequired = required.filter(
    (t) => !existsSync(path.join(prebuildsDir, t)),
  );
  const missingAdvisory = advisory.filter(
    (t) => !existsSync(path.join(prebuildsDir, t)),
  );
  if (missingRequired.length > 0) {
    console.error(
      `✗ node-pty prebuilds GO/NO-GO failed at ${prebuildsDir}`,
    );
    console.error(`  Missing required triples: ${missingRequired.join(", ")}`);
    console.error(
      `  Required set: ${required.join(", ")}. See change: ` +
        `eliminate-electron-runtime-install task 1.1.k and design.md F1.`,
    );
    process.exit(1);
  }
  console.log(
    `  node-pty prebuilds OK — ${required.length}/${required.length} required triples present` +
      (missingAdvisory.length > 0
        ? ` (advisory missing: ${missingAdvisory.join(", ")})`
        : " (all 6 triples present)"),
  );
}

// ── strip __tests__ from workspace source ────────────────────────────────
// Test config + __tests__ already stripped above (before source-only exit).
// This block kept for full-mode runs that need the same cleanup post-install.
for (const pkg of BUNDLED_WORKSPACE_PKGS) {
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

// ── materialize workspace symlinks under @blackbelt-technology/* ─────────
// npm workspaces creates symlinks like
//   node_modules/@blackbelt-technology/pi-dashboard-server -> ../../packages/server
// which are valid inside the bundle. BUT Node's `fs.cpSync(..., { recursive:
// true, dereference: false })` — used by Electron's `extractBundle` on first
// launch — has a quirk: it rewrites RELATIVE symlinks as ABSOLUTE paths
// pointing to the build host's source location. After extraction on a user's
// machine, those absolute paths resolve to nothing, breaking cliPath and
// everything pi-coding-agent depends on.
//
// docker-make.sh already does this replacement for Docker (Linux/Windows)
// builds. Replicate here so native-macOS builds (which run bundle-server.mjs
// directly via build-installer.sh, no docker-make.sh) also ship a
// symlink-free bundle. The smoke test
// `packages/electron/src/lib/__tests__/launch-source.smoke.test.ts` Tier A
// pins this invariant.
const BB_DIR = path.join(SERVER_BUNDLE, "node_modules", "@blackbelt-technology");
if (existsSync(BB_DIR)) {
  let materialized = 0;
  for (const name of readdirSync(BB_DIR)) {
    const linkPath = path.join(BB_DIR, name);
    let st;
    try { st = lstatSync(linkPath); } catch { continue; }
    if (!st.isSymbolicLink()) continue;
    let target;
    try { target = readlinkSync(linkPath); } catch { continue; }
    const absTarget = path.isAbsolute(target)
      ? target
      : path.resolve(path.dirname(linkPath), target);
    if (!existsSync(absTarget)) {
      console.log(`  ⚠ Symlink target missing, leaving as-is: ${name} → ${target}`);
      continue;
    }
    // Replace symlink with copy via tmp + rename for atomicity.
    const tmpPath = linkPath + ".materializing";
    rmSync(tmpPath, { recursive: true, force: true });
    cpSync(absTarget, tmpPath, { recursive: true, dereference: true });
    rmSync(linkPath, { force: true });
    renameSync(tmpPath, linkPath);
    materialized += 1;
  }
  if (materialized > 0) {
    console.log(`  Materialized ${materialized} workspace symlink(s) under @blackbelt-technology/`);
  }
}

// ── materialize pi-dashboard-web into node_modules ─────────────────────────
// server.ts resolves the client via:
//   createRequire(...).resolve("@blackbelt-technology/pi-dashboard-web/package.json")
// then joins "dist" off that package dir. To make this canonical lookup
// succeed in the extracted layout (~/.pi-dashboard/node_modules/...), copy
// the built client into node_modules/@blackbelt-technology/pi-dashboard-web/.
// packages/server/package.json doesn't declare pi-dashboard-web as a dep, so
// `npm install` above did NOT pull it from the registry; we must place it
// here explicitly. Mirrors the symlink-materialization above but for a
// package that isn't a transitive npm dep of the server.
//
// Without this, the server falls back to sibling-path arithmetic which
// silently misses the bundle's `packages/dist/client/` location.
if (clientSrc) {
  const webPkgDest = path.join(
    SERVER_BUNDLE,
    "node_modules",
    "@blackbelt-technology",
    "pi-dashboard-web",
  );
  rmSync(webPkgDest, { recursive: true, force: true });
  mkdirSync(webPkgDest, { recursive: true });
  cpSync(
    path.join(PROJECT_DIR, "packages", "client", "package.json"),
    path.join(webPkgDest, "package.json"),
  );
  cpSync(clientSrc, path.join(webPkgDest, "dist"), {
    recursive: true,
    dereference: false,
  });
  console.log(`  Materialized pi-dashboard-web into node_modules/@blackbelt-technology/`);
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
