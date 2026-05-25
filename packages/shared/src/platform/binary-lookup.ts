/**
 * Unified binary resolution for all dashboard components.
 * Replaces scattered whichSync/resolvePiCommand/resolveTsxCommand implementations
 * with a single configurable resolver.
 */
import { execSync, spawnSync, buildSafeArgv } from "./exec.js";
import { ensureWindowsSystemPath } from "./ensure-windows-path.js";
import { existsSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
import os from "node:os";
import { MANAGED_BIN, MANAGED_DIR } from "../managed-paths.js";

// ── jiti loader resolution constants ──────────────────────────────────────

/**
 * Pi-coding-agent package names searched for a managed-install jiti.
 * Upstream first, legacy fork second. Mirrors the prior
 * `resolveJitiFromPi` wrapper that lived in two electron files.
 */
export const MANAGED_PI_PACKAGES = [
  "@earendil-works/pi-coding-agent",
  "@mariozechner/pi-coding-agent",
] as const;

/**
 * jiti provider package names tried inside every anchor's resolution
 * chain. Upstream `jiti` first; legacy `@mariozechner/jiti` fallback.
 * Carried over verbatim from `resolve-jiti.ts`.
 */
export const JITI_PACKAGES = ["jiti", "@mariozechner/jiti"] as const;

/**
 * Test seam: a function that takes a package specifier (e.g.
 * `"jiti/package.json"`) and returns the resolved path. Production
 * supplies `createRequire(<anchor>).resolve`; tests supply a stub.
 * Carried over verbatim from `resolve-jiti.ts`.
 */
export type JitiResolver = (specifier: string) => string;

/**
 * Pure helper: given a jiti package.json path, return the file:// URL
 * of its register hook. Handles Windows-style drive letters regardless
 * of host OS (`pathToFileURL` on POSIX URL-encodes backslashes).
 *
 * Mirrors the prior helper from the deleted `resolve-jiti.ts`.
 */
function jitiRegisterUrl(pkgJsonPath: string): string {
  const isWindowsStyle = /^[A-Za-z]:[\\/]/.test(pkgJsonPath);
  if (isWindowsStyle) {
    const registerPath = path.win32.join(
      path.win32.dirname(pkgJsonPath),
      "lib",
      "jiti-register.mjs",
    );
    return `file:///${registerPath.replace(/\\/g, "/")}`;
  }
  const registerPath = path.join(path.dirname(pkgJsonPath), "lib", "jiti-register.mjs");
  return pathToFileURL(registerPath).href;
}

/**
 * Walk JITI_PACKAGES with the supplied resolver and return the first
 * hit's register URL. Optional `pathExists` guard rejects hits whose
 * `lib/jiti-register.mjs` is absent on disk (corrupt installs). When
 * `pathExists` is omitted, the package.json hit alone is sufficient
 * — used by the argv/system-pi anchors which already realpath'd a
 * trustworthy node_modules tree.
 */
function walkJiti(
  resolver: JitiResolver,
  pathExists?: (p: string) => boolean,
): string | null {
  for (const jiti of JITI_PACKAGES) {
    try {
      const pkgJson = resolver(`${jiti}/package.json`);
      if (pathExists) {
        const registerPath = path.join(path.dirname(pkgJson), "lib", "jiti-register.mjs");
        if (!pathExists(registerPath)) continue;
      }
      return jitiRegisterUrl(pkgJson);
    } catch { /* next */ }
  }
  return null;
}

/**
 * Internal deps for `ToolResolver.resolveJiti`. Underscore-prefixed
 * fields are test seams — production callers pass only `anchor` /
 * `resolver`.
 */
export interface ResolveJitiOpts {
  /** Caller-supplied anchor inside a node_modules tree (e.g. cliPath). */
  anchor?: string;
  /**
   * When true, skip the managed-pi / system-pi / argv anchors and try
   * ONLY `opts.anchor`. Used for health-probing a specific extracted
   * tree where finding jiti elsewhere does not prove the tree itself
   * is healthy.
   */
  anchorOnly?: boolean;
  /**
   * Test seam: replaces `createRequire(<anchor>).resolve` at every
   * probe site. Production omits — actual `createRequire` is used.
   */
  resolver?: JitiResolver;
  /** Test seam: replaces `existsSync` for managed-pi pkg.json + register guards. */
  _pathExists?: (p: string) => boolean;
  /** Test seam: replaces `realpathSync` for system-pi + argv anchors. */
  _realpath?: (p: string) => string;
  /** Test seam: replaces this resolver's `which("pi")` call. */
  _whichPi?: () => string | null;
  /** Test seam: replaces `process.argv[1]`. */
  _argv1?: string | undefined;
  /** Test seam: replaces `~/.pi-dashboard` root used to probe managed-pi. */
  _managedDir?: string;
}

// ── AppImage self-hit guard (Linux power-user mode safety) ────────────────

/**
 * Optional environment overrides for {@link isAppImageSelfHit}. Tests
 * inject explicit values so the helper can exercise both branches
 * without mutating `process.env` or `process.execPath`. Production
 * callers omit `opts` and the helper reads from the live process.
 *
 * See change: fix-electron-appimage-cli-self-detection (D1).
 */
export interface AppImageSelfHitOpts {
  /** Override `process.execPath`. Default: `process.execPath`. */
  execPath?: string;
  /** Override `process.env.APPDIR`. Default: `process.env.APPDIR`. */
  appDir?: string | undefined;
  /** Override `process.env.APPIMAGE`. Default: `process.env.APPIMAGE`. */
  appImage?: string | undefined;
}

/** Defensive realpath — returns the input on any error (broken symlink / ENOENT). */
function safeRealpath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/**
 * Returns `true` when `candidatePath` is the running process's own
 * Electron launcher binary — the bug class that motivates this helper:
 * AppImage's runtime prepends its squashfs mount (`/tmp/.mount_*`) to
 * `PATH` of the Electron child, and `packagerConfig.executableName =
 * "pi-dashboard"` makes the launcher a name-collision with the dashboard
 * CLI. Trusting the first `which pi-dashboard` hit therefore spawns the
 * Electron app recursively as if it were the CLI.
 *
 * A path is considered a self-hit when ANY of the following is true:
 *   - `realpath(candidatePath) === realpath(execPath)`, OR
 *   - `candidatePath` lives under the directory named by `appDir`, OR
 *   - `realpath(candidatePath) === realpath(appImage)`.
 *
 * `realpath` calls are wrapped in try/catch so broken symlinks / ENOENT
 * fall back to literal string comparisons. The helper never throws.
 *
 * Production callers (`whereStrategy`, `detectPiDashboardCli`,
 * `detectPi`, `detectSystemNode`) omit `opts`. Tests pass explicit
 * overrides via `opts`.
 *
 * See change: fix-electron-appimage-cli-self-detection (D1).
 */
export function isAppImageSelfHit(
  candidatePath: string,
  opts?: AppImageSelfHitOpts,
): boolean {
  if (!candidatePath) return false;

  const execPath = opts && "execPath" in opts ? opts.execPath : process.execPath;
  const appDir = opts && "appDir" in opts ? opts.appDir : process.env.APPDIR;
  const appImage = opts && "appImage" in opts ? opts.appImage : process.env.APPIMAGE;

  const realCandidate = safeRealpath(candidatePath);

  // Rule 1: realpath equals process.execPath
  if (execPath) {
    const realExec = safeRealpath(execPath);
    if (realCandidate === realExec) return true;
    if (candidatePath === execPath) return true;
  }

  // Rule 2: candidate lives under APPDIR (the AppImage squashfs mount).
  // We compare the candidate's realpath against APPDIR's realpath so a
  // symlink under the mount is still recognized as a self-hit.
  if (appDir) {
    const realAppDir = safeRealpath(appDir);
    const sep = path.sep;
    // Append separator so /tmp/.mount_PI doesn't accidentally match
    // /tmp/.mount_PIxx-elsewhere via prefix.
    const prefix = realAppDir.endsWith(sep) ? realAppDir : realAppDir + sep;
    if (realCandidate === realAppDir || realCandidate.startsWith(prefix)) return true;
    // Literal fallback (broken symlinks / ENOENT keep a useful answer).
    const litPrefix = appDir.endsWith(sep) ? appDir : appDir + sep;
    if (candidatePath === appDir || candidatePath.startsWith(litPrefix)) return true;
  }

  // Rule 3: realpath equals APPIMAGE (the .AppImage file the user clicked).
  if (appImage) {
    const realAppImage = safeRealpath(appImage);
    if (realCandidate === realAppImage) return true;
    if (candidatePath === appImage) return true;
  }

  return false;
}

/**
 * Well-known globalThis symbol for the default `ToolRegistry`.
 *
 * The registry publishes itself here when first constructed (see
 * `tool-registry/index.ts::getDefaultRegistry`). Delegation avoids a
 * static import cycle (tool-registry strategies already import from
 * this file).
 *
 * See change: consolidate-windows-spawn-and-platform-handlers.
 */
const GLOBAL_REGISTRY_KEY = Symbol.for("pi-dashboard.tool-registry");
interface LazyRegistry {
  has(n: string): boolean;
  resolveExecutor(n: string): { ok: boolean; argv: string[] };
}
function tryGetRegistry(): LazyRegistry | null {
  const reg = (globalThis as unknown as { [k: symbol]: LazyRegistry | undefined })[GLOBAL_REGISTRY_KEY];
  return reg ?? null;
}

export interface ResolverContext {
  /** Extra bin dirs to search before system PATH (e.g., bundled Node dir). */
  extraBinDirs?: string[];
  /** Current process.execPath — used for Node resolution in server/extension. */
  processExecPath?: string;
  /** Use login shell fallback for GUI apps on macOS/Linux. */
  useLoginShell?: boolean;
}

/**
 * Unified tool resolver. All binary lookups follow:
 * managed bin → extraBinDirs → system PATH → login shell (if enabled)
 */
export class ToolResolver {
  private ctx: ResolverContext;

  constructor(ctx: ResolverContext = {}) {
    this.ctx = ctx;
  }

  /**
   * Resolve a binary by name. Returns absolute path or null.
   * Search order: managed bin → extra dirs → system PATH → login shell.
   */
  which(name: string): string | null {
    const ext = process.platform === "win32" ? ".cmd" : "";

    // 1. Managed install
    const managed = path.join(MANAGED_BIN, name + ext);
    if (existsSync(managed)) return managed;

    // 2. Extra bin dirs
    for (const dir of this.ctx.extraBinDirs ?? []) {
      const candidate = path.join(dir, name + ext);
      if (existsSync(candidate)) return candidate;
    }

    // 3. System PATH
    const systemPath = whichSync(name);
    if (systemPath) return systemPath;

    // 4. Login shell fallback (macOS/Linux GUI apps)
    if (this.ctx.useLoginShell && process.platform !== "win32") {
      return whichViaLoginShell(name);
    }

    return null;
  }

  /**
   * Resolve pi as spawn-ready argv `[cmd, ...prefixArgs]`.
   *
   * Fully delegates to `ToolRegistry.resolveExecutor("pi")`, which
   * owns per-OS discovery + interpreter assembly (on Windows: find
   * `pi-coding-agent/dist/cli.js` via managed/bare-import/npm-global
   * and prepend `node.exe`; on Unix: find `pi` binary on PATH).
   *
   * Returns null when the registry is not yet constructed AND pi is
   * not on PATH (very early boot / standalone tests). Production code
   * always has the registry available before spawn.
   */
  resolvePi(): string[] | null {
    const registry = tryGetRegistry();
    if (registry?.has("pi")) {
      const exec = registry.resolveExecutor("pi");
      if (exec.ok && exec.argv.length > 0) return exec.argv;
    }
    // No registry in this process (e.g. legacy bootstrap) — fall back
    // to PATH lookup so the method still works for non-server callers.
    const piPath = this.which("pi");
    return piPath ? [piPath] : null;
  }

  /**
   * Resolve tsx as [cmd, ...prefixArgs].
   * On Windows, avoids .cmd by returning [node.exe, tsx/dist/cli.mjs].
   */
  resolveTsx(): string[] | null {
    if (process.platform === "win32") {
      const tsxCli = path.join(MANAGED_DIR, "node_modules", "tsx", "dist", "cli.mjs");
      if (existsSync(tsxCli)) {
        const node = this.resolveNode();
        if (node) return [node, tsxCli];
      }
    }

    const tsxPath = this.which("tsx");
    if (tsxPath) return [tsxPath];
    return null;
  }

  /**
   * Resolve Node.js binary path.
   * Checks processExecPath, extra dirs, managed, system PATH, login shell.
   */
  resolveNode(): string | null {
    // If running inside a Node process, use its own binary
    if (this.ctx.processExecPath) {
      return this.ctx.processExecPath;
    }

    // Extra dirs (e.g., bundled Node)
    for (const dir of this.ctx.extraBinDirs ?? []) {
      const nodeName = process.platform === "win32" ? "node.exe" : "node";
      const candidate = path.join(dir, nodeName);
      if (existsSync(candidate)) return candidate;
    }

    return this.which("node");
  }

  /**
   * Resolve pi's jiti register hook as a `file://` URL.
   *
   * Resolution order (first hit wins):
   *   1. Managed pi install — `~/.pi-dashboard/node_modules/<pkg>` for
   *      every entry of `MANAGED_PI_PACKAGES` (upstream first, legacy
   *      fallback). Each candidate's pkg.json is the createRequire
   *      anchor; walk `JITI_PACKAGES` from there.
   *   2. System pi via `this.which("pi")` (realpathed to escape
   *      symlinks like `/usr/local/bin/pi → .../dist/cli.js`).
   *   3. Caller-supplied `opts.anchor` (e.g. an electron `cliPath`).
   *   4. `process.argv[1]` (the running pi/node entry; populated for
   *      bridge-extension callers).
   *
   * Returns null when none yield a jiti install. Preserves the
   * Windows drive-letter URL-wrapping contract that previously lived
   * on the prior `buildJitiRegisterUrl` helper in `resolve-jiti.ts`.
   *
   * Tests inject `_pathExists` / `_realpath` / `_whichPi` / `_argv1`
   * / `_managedDir` and a flat `resolver` to exercise individual
   * anchors deterministically.
   *
   * Subsumes the previous `resolveJitiImport`, `resolveJitiFromAnchor`,
   * `pickJitiRegisterUrl`, `pickJitiFromAnchor`, `buildJitiRegisterUrl`,
   * and the duplicate `resolveJitiFromPi` wrappers in electron.
   */
  resolveJiti(opts: ResolveJitiOpts = {}): string | null {
    const pathExists = opts._pathExists ?? existsSync;
    const realpath = opts._realpath ?? realpathSync;
    const whichPi = opts._whichPi ?? (() => this.which("pi"));
    const argv1 = "_argv1" in opts ? opts._argv1 : process.argv[1];
    const managedDir = opts._managedDir ?? MANAGED_DIR;

    const makeResolver = (anchor: string): JitiResolver | null => {
      if (opts.resolver) return opts.resolver;
      try {
        const req = createRequire(anchor);
        return (spec) => req.resolve(spec);
      } catch {
        return null;
      }
    };

    // anchor-only short-circuit: skip every anchor except opts.anchor.
    if (opts.anchorOnly) {
      if (!opts.anchor) return null;
      if (!pathExists(opts.anchor)) return null;
      const r = makeResolver(opts.anchor);
      if (!r) return null;
      return walkJiti(r, pathExists);
    }

    // 1. Managed pi installs.
    for (const pkg of MANAGED_PI_PACKAGES) {
      const pkgJson = path.join(managedDir, "node_modules", pkg, "package.json");
      if (!pathExists(pkgJson)) continue;
      const resolver = makeResolver(pkgJson);
      if (!resolver) continue;
      const url = walkJiti(resolver, pathExists);
      if (url) return url;
    }

    // 2. System pi.
    const piPath = whichPi();
    if (piPath) {
      let realPi: string;
      try { realPi = realpath(piPath); } catch { realPi = piPath; }
      const resolver = makeResolver(realPi);
      if (resolver) {
        const url = walkJiti(resolver, pathExists);
        if (url) return url;
      }
    }

    // 3. Caller-supplied anchor.
    if (opts.anchor && pathExists(opts.anchor)) {
      const resolver = makeResolver(opts.anchor);
      if (resolver) {
        const url = walkJiti(resolver, pathExists);
        if (url) return url;
      }
    }

    // 4. process.argv[1] (or test override).
    if (argv1) {
      let realArgv: string;
      try { realArgv = realpath(argv1); } catch { realArgv = argv1; }
      const resolver = makeResolver(realArgv);
      if (resolver) {
        const url = walkJiti(resolver, pathExists);
        if (url) return url;
      }
    }

    return null;
  }

  /**
   * Build a spawn environment with managed bin, node bin, extra dirs,
   * and common user bin dirs prepended to PATH.
   *
   * On Windows, additionally guarantees canonical system directories
   * (System32, Wbem, PowerShell, WindowsApps) are present via
   * `ensureWindowsSystemPath`. See change:
   * fix-windows-path-system32-missing.
   */
  buildSpawnEnv(
    base: NodeJS.ProcessEnv = process.env,
    opts: { platform?: NodeJS.Platform; exists?: (p: string) => boolean } = {},
  ): NodeJS.ProcessEnv {
    // Strip Electron-specific vars so spawned child processes (pi sessions,
    // npm installs) don't accidentally run as Electron-node mode.
    const ELECTRON_VARS_TO_STRIP = new Set([
      "ELECTRON_RUN_AS_NODE",
      "ELECTRON_DEFAULT_ERROR_MODE",
      "ELECTRON_ENABLE_STACK_DUMPING",
    ]);
    const strippedBase: NodeJS.ProcessEnv = {};
    for (const [k, v] of Object.entries(base)) {
      if (!ELECTRON_VARS_TO_STRIP.has(k)) strippedBase[k] = v;
    }
    base = strippedBase;

    const currentPath = base.PATH || "";
    const parts: string[] = [];

    // Managed bin
    if (!currentPath.includes(MANAGED_BIN)) {
      parts.push(MANAGED_BIN);
    }

    // Current node binary dir
    const nodeBin = this.ctx.processExecPath
      ? path.dirname(this.ctx.processExecPath)
      : null;
    if (nodeBin && !currentPath.includes(nodeBin)) {
      parts.push(nodeBin);
    }

    // Extra bin dirs
    for (const dir of this.ctx.extraBinDirs ?? []) {
      if (!currentPath.includes(dir)) {
        parts.push(dir);
      }
    }

    // Common user bin directories (desktop launchers miss these)
    for (const dir of getUserBinDirs()) {
      if (!currentPath.includes(dir)) {
        parts.push(dir);
      }
    }

    const out = parts.length === 0
      ? base
      : { ...base, PATH: `${parts.join(path.delimiter)}${path.delimiter}${currentPath}` };
    return ensureWindowsSystemPath(out, opts);
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Run `where|which <target>` and return ALL stdout lines (trimmed,
 * non-empty), or `[]`.
 *
 * Uses `spawnSync` via `buildSafeArgv` — no shell interpretation at
 * all. `execSync("where tmux")` used to route through cmd.exe (because
 * execSync takes a shell command string); spawnSync with argv bypasses
 * that entirely. Guaranteed no cmd.exe console flash.
 *
 * See change: consolidate-windows-spawn-and-platform-handlers.
 */
function whereAllLines(whichCmd: string, target: string): string[] {
  try {
    const { argv, spawnOptions } = buildSafeArgv(whichCmd, [target]);
    const result = spawnSync<string>(argv[0], argv.slice(1), {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      ...spawnOptions,
    });
    if (result.status !== 0) return [];
    const text = typeof result.stdout === "string" ? result.stdout : String(result.stdout ?? "");
    return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/** Extract the file extension (lower-cased, including the dot) from a path, or "". */
function extOf(p: string): string {
  const slash = Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/"));
  const dot = p.lastIndexOf(".");
  return dot > slash ? p.slice(dot).toLowerCase() : "";
}

/**
 * Resolve a command on PATH.
 *
 * Unix: the first `which <name>` hit is authoritative.
 *
 * Windows: `where <name>` lists ALL PATH matches — a directory may contain
 * both a bash shim (extensionless, e.g. `pi`) and a Windows-native form
 * (`pi.cmd`). Node's `spawn()` cannot execute extensionless shims on
 * Windows without `shell: true`, so we pick the first line whose extension
 * is in PATHEXT. Falls back to the first line if none match (preserves
 * whatever the user set up).
 *
 * Single `where` invocation — no per-extension probe loop — to keep
 * resolution fast (especially when the command is missing entirely).
 */
function whichSync(cmd: string): string | null {
  const isWin = process.platform === "win32";
  if (!isWin) {
    const lines = whereAllLines("which", cmd);
    return lines[0] ?? null;
  }

  const lines = whereAllLines("where", cmd);
  if (lines.length === 0) return null;

  // If the caller already specified an extension, trust their pick.
  const callerHasExt = /\.[A-Za-z0-9]+$/.test(cmd);
  if (callerHasExt) return lines[0];

  // Preference order: PATHEXT (user's actual Windows search path) or a
  // standard default. Lower-cased for case-insensitive matching.
  const pathextRaw = process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC;.PS1";
  const pathext = pathextRaw.split(";").map((e) => e.trim().toLowerCase()).filter(Boolean);

  // Pick the first line whose extension matches PATHEXT, scanning by
  // preference order (lower index = more preferred).
  let best: string | null = null;
  let bestRank = Infinity;
  for (const line of lines) {
    const rank = pathext.indexOf(extOf(line));
    if (rank === -1) continue;
    if (rank < bestRank) {
      best = line;
      bestRank = rank;
    }
  }
  if (best) return best;

  // No PATHEXT-matching entry — fall back to first line (could be a bash
  // shim). The runner layer handles the `.cmd` / `.bat` spawn-via-shell
  // case separately; extensionless shims will still ENOENT but that's
  // the right signal to the caller.
  return lines[0];
}

/** Resolve a command via login shell (picks up nvm/volta/homebrew paths). */
function whichViaLoginShell(cmd: string): string | null {
  const shell = process.env.SHELL || "/bin/zsh";
  try {
    const raw = execSync(`${shell} -ilc "which ${cmd}"`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5000,
      windowsHide: true,
    });
    const output = (typeof raw === "string" ? raw : String(raw)).trim();
    // Extract absolute path from potentially noisy login shell output
    const pathLine = output.split("\n").find(l => l.trim().startsWith("/"));
    return pathLine?.trim() || null;
  } catch {
    return null;
  }
}

/** Common user bin directories not on PATH for desktop launchers. */
function getUserBinDirs(): string[] {
  const home = os.homedir();
  return [
    path.join(home, ".local", "bin"),
    path.join(home, ".npm-global", "bin"),
    "/usr/local/bin",
  ].filter(d => existsSync(d));
}
