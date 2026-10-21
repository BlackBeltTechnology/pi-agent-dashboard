#!/usr/bin/env node
/**
 * assert-bundled-bash-resolvable.mjs — build-time proof that the SHIPPED
 * pi-coding-agent resolves the SHIPPED bundled bash.exe on Windows.
 *
 * Why: pi's getShellConfig() (bash tool, `!`, `!cmd`) resolves only a file named
 * `bash.exe` — `%ProgramFiles%\Git\bin\bash.exe`, then the first `where bash.exe`
 * hit. On a host without Git for Windows it silently picks the WSL launcher in
 * System32. The bundle therefore ships `usr/bin/bash.exe` (copy of sh.exe) and the
 * spawn PATH puts `usr/bin` ahead of System32 (windowsBashSource "bundled").
 * This gate proves it against the real artifacts, never a re-implementation of
 * the PATH logic (a replica can pass while production differs, cf. #720).
 *
 * What it does (win32 only; exit 0 elsewhere):
 *   1. Loads `normalizeEnvPathKey`, `ensureWindowsSystemPath`,
 *      `ensureBundledGitOnPath`, `resolvePiShell` from the SHIPPED shared source
 *      via the bundle's jiti, and pi's `getShellConfig` via `import()` of the
 *      shipped pi dist.
 *   2. Builds the child env in `buildSpawnEnv` order: inherited env, PATH key
 *      normalised, `ProgramFiles*` + `ProgramW6432` pointed at an empty dir (no Git for Windows),
 *      a stub host dir holding a `bash.exe` on PATH (deterministic stand-in for a
 *      host shell, independent of what the runner ships), then the two helpers.
 *   3. Runs a child Node (cwd = empty temp dir, so `where.exe`'s cwd-first search
 *      finds nothing) twice:
 *        bashSource "bundled" → pi's shell MUST equal the bundle's usr\bin\bash.exe
 *        bashSource "host"    → pi's shell MUST equal the stub's bash.exe
 *      and in both the shipped `resolvePiShell` replica MUST agree with pi.
 *   4. Exec checks only when the target arch equals the runner arch (the
 *      win32-arm64 leg builds on an x64 runner and cannot execute arm64 binaries):
 *        bundled run → `echo "$BASH_VERSION"; set -o` through pi's returned shell:
 *                      non-empty version and `posix … off`.
 *        host run    → bundled git still works with usr\bin last: `git --version`
 *                      and a commit through a `#!/bin/sh` pre-commit hook.
 *
 * Env: GIT_TARGET_ARCH (x64|arm64, default process.arch);
 *      BUNDLE_RESOURCES_DIR (default <electron>/resources — tests point it at a
 *      bundle copy with usr/bin/bash.exe deleted to prove the gate goes red).
 *
 * Node-native, no shell (no `shell: bash` on Windows runners).
 * See change: fix-windows-bundled-bash-exe (design D4).
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ELECTRON_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SELF = fileURLToPath(import.meta.url);

/** Normalise a Windows path for comparison: backslashes, no trailing sep, lower-case. */
export function normWin(p) {
  return String(p ?? "")
    .replace(/\//g, "\\")
    .replace(/\\+$/, "")
    .toLowerCase();
}

/** Layout of the shipped bundle under `resourcesDir`. Pure. */
export function bundleLayout(resourcesDir) {
  const server = path.join(resourcesDir, "server");
  const nm = path.join(server, "node_modules");
  const platformDir = path.join(nm, "@blackbelt-technology", "pi-dashboard-shared", "src", "platform");
  return {
    gitDir: path.join(resourcesDir, "git"),
    serverPkg: path.join(server, "package.json"),
    jitiDir: path.join(nm, "jiti"),
    piEntry: path.join(nm, "@earendil-works", "pi-coding-agent", "dist", "index.js"),
    platformDir,
    helpers: {
      envPathKey: path.join(platformDir, "env-path-key.ts"),
      windowsPath: path.join(platformDir, "ensure-windows-path.ts"),
      bundledGit: path.join(platformDir, "ensure-bundled-git.ts"),
      resolvePiShell: path.join(platformDir, "resolve-pi-shell.ts"),
    },
  };
}

function fail(message) {
  console.error(`\u2717 assert-bundled-bash-resolvable: ${message}`);
  process.exit(1);
}

async function loadShared(layout) {
  for (const [what, p] of [
    ["jiti", layout.jitiDir],
    ["pi entry", layout.piEntry],
    ...Object.entries(layout.helpers),
  ]) {
    if (!existsSync(p)) fail(`bundle layout changed — update gate. Missing ${what}: ${p}`);
  }
  const require = createRequire(layout.serverPkg);
  const { createJiti } = require("jiti");
  const jiti = createJiti(import.meta.url, { interopDefault: true });
  return {
    normalizeEnvPathKey: (await jiti.import(layout.helpers.envPathKey)).normalizeEnvPathKey,
    ensureWindowsSystemPath: (await jiti.import(layout.helpers.windowsPath)).ensureWindowsSystemPath,
    ensureBundledGitOnPath: (await jiti.import(layout.helpers.bundledGit)).ensureBundledGitOnPath,
    resolvePiShell: (await jiti.import(layout.helpers.resolvePiShell)).resolvePiShell,
  };
}

/** Child mode: resolve with the SHIPPED pi + replica, print one JSON line. */
async function childMain(resourcesDir) {
  const layout = bundleLayout(resourcesDir);
  const out = { pi: null, piArgs: null, error: null, replica: null, diag: null };
  try {
    const w = spawnSync("where", ["bash.exe"], { encoding: "utf8", timeout: 10_000, windowsHide: true });
    out.diag = {
      cwd: process.cwd(),
      programFiles: process.env.ProgramFiles ?? null,
      programFilesX86: process.env["ProgramFiles(x86)"] ?? null,
      pathHead: String(process.env.PATH ?? "").split(";").slice(0, 8),
      where: String(w.stdout ?? "").trim().split(/\r?\n/),
    };
  } catch {
    /* diagnostics only */
  }
  try {
    const pi = await import(pathToFileURL(layout.piEntry).href);
    const cfg = pi.getShellConfig();
    out.pi = cfg.shell;
    out.piArgs = cfg.args;
  } catch (err) {
    out.error = String(err?.message ?? err).split("\n")[0];
  }
  try {
    const { resolvePiShell } = await loadShared(layout);
    out.replica = resolvePiShell({ env: process.env })?.path ?? null;
  } catch (err) {
    out.replicaError = String(err?.message ?? err);
  }
  process.stdout.write(`${JSON.stringify(out)}\n`);
}

function buildEnv(shared, layout, { emptyDir, stubDir, bashSource }) {
  let env = shared.normalizeEnvPathKey({ ...process.env }, "win32");
  // `ProgramW6432` too: the OS re-derives a 64-bit child's `ProgramFiles` from it
  // (measured on windows-latest: overriding ProgramFiles alone is ignored).
  for (const key of Object.keys(env)) {
    if (/^(programfiles(\(x86\))?|programw6432)$/i.test(key)) delete env[key];
  }
  env.ProgramFiles = emptyDir;
  env["ProgramFiles(x86)"] = emptyDir;
  env.ProgramW6432 = emptyDir;
  env.PATH = `${stubDir};${env.PATH ?? ""}`;
  env.GATE_RESOURCES_DIR = path.dirname(layout.gitDir);
  env = shared.ensureWindowsSystemPath(env, { platform: "win32" });
  env = shared.ensureBundledGitOnPath(env, {
    platform: "win32",
    source: "bundled",
    gitDir: layout.gitDir,
    bashSource,
  });
  return env;
}

function runChild(env, cwd, resourcesDir) {
  const r = spawnSync(process.execPath, [SELF, "--child", resourcesDir], {
    env,
    cwd,
    encoding: "utf8",
    timeout: 60_000,
    windowsHide: true,
  });
  if (r.status !== 0) fail(`child process failed (${r.status}): ${(r.stderr || r.stdout || "").trim()}`);
  const line = (r.stdout || "").trim().split(/\r?\n/).pop() ?? "";
  try {
    return JSON.parse(line);
  } catch {
    return fail(`child printed no JSON: ${JSON.stringify(r.stdout)}`);
  }
}

function printDiag(label, got) {
  console.error(`  [${label}] child diagnostics: ${JSON.stringify(got.diag, null, 2)}`);
}

function checkResolution(label, got, expected) {
  if (got.error || normWin(got.pi) !== normWin(expected)) printDiag(label, got);
  if (got.error) fail(`[${label}] pi getShellConfig() threw: ${got.error} (expected ${expected})`);
  if (normWin(got.pi) !== normWin(expected)) {
    fail(`[${label}] pi resolved ${got.pi}, expected ${expected}`);
  }
  if (got.replicaError) fail(`[${label}] shipped resolvePiShell failed to load: ${got.replicaError}`);
  if (normWin(got.replica) !== normWin(got.pi)) {
    fail(`[${label}] shipped resolvePiShell (${got.replica}) disagrees with pi (${got.pi}) — replica drifted`);
  }
  console.log(`  [${label}] pi shell = ${got.pi}`);
}

function execBundledBash(env, got) {
  const r = spawnSync(got.pi, [...(got.piArgs ?? ["-c"]), 'echo "VERSION=$BASH_VERSION"; set -o'], {
    env,
    encoding: "utf8",
    timeout: 60_000,
    windowsHide: true,
  });
  if (r.status !== 0) fail(`[bundled] bash exec exit ${r.status}: ${(r.stderr || "").trim()}`);
  const version = /^VERSION=(.+)$/m.exec(r.stdout || "")?.[1]?.trim();
  if (!version) fail(`[bundled] $BASH_VERSION is empty — shell is not running as bash`);
  if (!/^posix\s+off\s*$/m.test(r.stdout || "")) fail(`[bundled] expected 'posix off' in bash mode:\n${r.stdout}`);
  console.log(`  [bundled] bash ${version}, posix off`);
}

function execBundledGitHook(env, tmpRoot) {
  const v = spawnSync("git", ["--version"], { env, encoding: "utf8", timeout: 30_000, windowsHide: true });
  if (v.status !== 0) fail(`[host] bundled git --version failed: ${(v.stderr || "").trim()}`);
  const repo = path.join(tmpRoot, "hook-repo");
  mkdirSync(repo, { recursive: true });
  const git = (...args) => spawnSync("git", args, { env, cwd: repo, encoding: "utf8", timeout: 60_000, windowsHide: true });
  for (const args of [
    ["init", "-q"],
    ["config", "user.email", "gate@example.invalid"],
    ["config", "user.name", "gate"],
    ["config", "core.autocrlf", "false"],
  ]) {
    const r = git(...args);
    if (r.status !== 0) fail(`[host] git ${args.join(" ")} failed: ${(r.stderr || "").trim()}`);
  }
  const hooksDir = path.join(repo, ".git", "hooks");
  mkdirSync(hooksDir, { recursive: true });
  writeFileSync(path.join(hooksDir, "pre-commit"), "#!/bin/sh\necho HOOK_RAN_OK\n", { mode: 0o755 });
  writeFileSync(path.join(repo, "a.txt"), "x\n");
  git("add", "a.txt");
  const c = git("commit", "-q", "-m", "gate");
  const text = `${c.stdout || ""}${c.stderr || ""}`;
  if (c.status !== 0) fail(`[host] git commit failed with usr\\bin last: ${text.trim()}`);
  if (!text.includes("HOOK_RAN_OK")) fail(`[host] #!/bin/sh pre-commit hook did not run:\n${text}`);
  console.log(`  [host] ${(v.stdout || "").trim()}; commit through #!/bin/sh hook OK`);
}

async function main() {
  if (process.platform !== "win32") {
    console.log("  [bash-gate] not win32 — skipping");
    return;
  }
  const resourcesDir = path.resolve(process.env.BUNDLE_RESOURCES_DIR ?? path.join(ELECTRON_DIR, "resources"));
  const layout = bundleLayout(resourcesDir);
  const usrBin = path.join(layout.gitDir, "usr", "bin");
  const shExe = path.join(usrBin, "sh.exe");
  const bundledBash = path.join(usrBin, "bash.exe");
  if (!existsSync(shExe)) fail(`bundle has no usr\\bin\\sh.exe (${shExe})`);

  const shared = await loadShared(layout);
  const tmpRoot = mkdtempSync(path.join(tmpdir(), "bash-gate-"));
  try {
    const emptyDir = path.join(tmpRoot, "no-git");
    const stubDir = path.join(tmpRoot, "stub-host");
    const cwd = path.join(tmpRoot, "cwd");
    for (const d of [emptyDir, stubDir, cwd]) mkdirSync(d, { recursive: true });
    const stubBash = path.join(stubDir, "bash.exe");
    // Resolution-only stand-in for a host shell (never executed: its DLLs live in usr\bin).
    copyFileSync(shExe, stubBash);

    const where = spawnSync("where.exe", ["where.exe"], { encoding: "utf8", windowsHide: true });
    console.log(`  [bash-gate] System32\\bash.exe present on runner: ${existsSync("C:\\Windows\\System32\\bash.exe")}`);
    if (where.status !== 0) fail("where.exe is not resolvable on this runner");

    const targetArch = (process.env.GIT_TARGET_ARCH || process.arch) === "arm64" ? "arm64" : "x64";
    const canExec = targetArch === process.arch;

    // ── bashSource "bundled": pi must pick the bundled bash.exe ───────────
    const bundledEnv = buildEnv(shared, layout, { emptyDir, stubDir, bashSource: "bundled" });
    const bundledRun = runChild(bundledEnv, cwd, resourcesDir);
    checkResolution("bundled", bundledRun, bundledBash);

    // ── bashSource "host": pi must pick the host's first bash.exe (the stub) ─
    const hostEnv = buildEnv(shared, layout, { emptyDir, stubDir, bashSource: "host" });
    const hostRun = runChild(hostEnv, cwd, resourcesDir);
    checkResolution("host", hostRun, stubBash);

    if (canExec) {
      execBundledBash(bundledEnv, bundledRun);
      execBundledGitHook(hostEnv, tmpRoot);
    } else {
      console.log(`  [bash-gate] exec skipped (cross-arch: target ${targetArch} on ${process.arch} runner) — resolution verified only`);
    }
    console.log("\u2713 assert-bundled-bash-resolvable: pi resolves the bundled bash.exe in both modes");
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === SELF) {
  if (process.argv[2] === "--child") {
    childMain(process.argv[3]).catch((err) => {
      console.error(err?.stack ?? err);
      process.exit(1);
    });
  } else {
    main().catch((err) => fail(err?.stack ?? String(err)));
  }
}
