/**
 * Server-side helpers for the worktree-bootstrap step.
 *
 * Three concerns:
 *   1. `detectBootstrapRequirement(repoRoot)` — pure heuristic deciding
 *      whether a freshly-created worktree of `repoRoot` needs its own
 *      `node_modules` to host a working pi bridge. Required iff the repo's
 *      `.pi/settings.json` declares a `packages[]` entry whose `source`
 *      (resolved relative to `.pi/`) points into the repo itself (or any
 *      descendant) AND the entry's `extensions[]` list references at least
 *      one path under that source. Fail-open on every error.
 *   2. `pickInstallCommand(worktreePath)` — picks the install command by
 *      lockfile presence in the new worktree. Returns `null` when no
 *      recognized lockfile is present.
 *   3. `runBootstrap(worktreePath, onProgress)` — spawns the install
 *      command, captures a 4 KB stdout/stderr ring buffer, streams
 *      throttled progress lines, and resolves on exit.
 *
 * Pure 1+2 here; 3 lives below and uses child_process. See change:
 * harden-worktree-spawn.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";

// ── 1. detectBootstrapRequirement ────────────────────────────────────────

export interface BootstrapRequirement {
  required: boolean;
}

/**
 * Reads `<repoRoot>/.pi/settings.json` and returns `{ required: true }`
 * iff at least one `packages[]` entry is shaped like
 * `{ source: <path-into-repo>, extensions: [<...>] }`. All errors and
 * unrecognized shapes return `{ required: false }` (fail-open).
 */
export function detectBootstrapRequirement(repoRoot: string): BootstrapRequirement {
  const settingsPath = path.join(repoRoot, ".pi", "settings.json");
  let raw: string;
  try {
    raw = fs.readFileSync(settingsPath, "utf8");
  } catch {
    return { required: false };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { required: false };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { required: false };
  }
  const pkgs = (parsed as { packages?: unknown }).packages;
  if (!Array.isArray(pkgs)) return { required: false };

  // The `.pi/settings.json` source field is resolved relative to the
  // `.pi/` directory (where the settings file lives), NOT the repo root.
  // For pi-agent-dashboard's own `source: ".."`, that resolves to repoRoot.
  const settingsDir = path.join(repoRoot, ".pi");
  const repoRootResolved = path.resolve(repoRoot);

  for (const entry of pkgs) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const e = entry as { source?: unknown; extensions?: unknown };
    if (typeof e.source !== "string") continue;
    if (!Array.isArray(e.extensions) || e.extensions.length === 0) continue;
    // Reject extensions that aren't strings.
    if (!e.extensions.every((x) => typeof x === "string")) continue;

    const resolved = path.resolve(settingsDir, e.source);
    if (!isPathInside(repoRootResolved, resolved)) continue;

    // At least one extension references a worktree-local path? The
    // extension entries are `+<rel-path>` or bare paths; either way we
    // treat the presence of any non-empty string as referencing the
    // resolved source dir.
    return { required: true };
  }
  return { required: false };
}

function isPathInside(parent: string, child: string): boolean {
  // `child === parent` counts as inside (the source IS the repo root).
  const rel = path.relative(parent, child);
  if (rel === "") return true;
  return !rel.startsWith("..") && !path.isAbsolute(rel);
}

// ── 2. pickInstallCommand ────────────────────────────────────────────────

export interface InstallCommand {
  cmd: string;
  args: string[];
  lockfile: string;
}

/**
 * Picks the install command for a worktree by lockfile presence.
 * Precedence: npm > pnpm > yarn > bun (most common in the dashboard
 * monorepo first). Returns null when no recognized lockfile is present.
 */
export function pickInstallCommand(worktreePath: string): InstallCommand | null {
  const has = (name: string) => {
    try { return fs.statSync(path.join(worktreePath, name)).isFile(); }
    catch { return false; }
  };
  if (has("package-lock.json")) {
    return { cmd: "npm", args: ["ci"], lockfile: "package-lock.json" };
  }
  if (has("pnpm-lock.yaml")) {
    return { cmd: "pnpm", args: ["install", "--frozen-lockfile"], lockfile: "pnpm-lock.yaml" };
  }
  if (has("yarn.lock")) {
    return { cmd: "yarn", args: ["install", "--frozen-lockfile"], lockfile: "yarn.lock" };
  }
  if (has("bun.lock")) {
    return { cmd: "bun", args: ["install", "--frozen-lockfile"], lockfile: "bun.lock" };
  }
  if (has("bun.lockb")) {
    return { cmd: "bun", args: ["install", "--frozen-lockfile"], lockfile: "bun.lockb" };
  }
  return null;
}

// ── 3. runBootstrap ──────────────────────────────────────────────────────

export interface BootstrapProgress {
  /** Most recent ≤ 4 KB tail of combined stdout/stderr. */
  line: string;
}

export interface BootstrapResult {
  ok: boolean;
  durationMs: number;
  code?: string;
  /** Last ≤ 4 KB of combined output, regardless of exit status. */
  stderr?: string;
  /** The install command actually invoked. */
  command?: string;
}

export interface RunBootstrapOptions {
  /** Throttle interval for `onProgress` invocations. Default 250 ms. */
  throttleMs?: number;
  /** Max bytes of stdout/stderr tail to retain. Default 4 KB. */
  tailBytes?: number;
  /** Hard timeout in ms. Default 10 min. */
  timeoutMs?: number;
  /** Override the install command resolver (for tests). */
  pickCommand?: (worktreePath: string) => InstallCommand | null;
  /** Override environment (defaults to `process.env`). */
  env?: NodeJS.ProcessEnv;
}

const DEFAULT_THROTTLE_MS = 250;
const DEFAULT_TAIL_BYTES = 4 * 1024;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Runs the picked install command in `worktreePath`. Streams throttled
 * progress (last `tailBytes` of combined stdout/stderr) to `onProgress`,
 * resolves with `{ ok, durationMs, stderr?, command? }` on exit.
 */
export async function runBootstrap(
  worktreePath: string,
  onProgress: (p: BootstrapProgress) => void,
  opts: RunBootstrapOptions = {},
): Promise<BootstrapResult> {
  const throttleMs = opts.throttleMs ?? DEFAULT_THROTTLE_MS;
  const tailBytes = opts.tailBytes ?? DEFAULT_TAIL_BYTES;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pick = opts.pickCommand ?? pickInstallCommand;

  const picked = pick(worktreePath);
  if (!picked) {
    return { ok: false, durationMs: 0, code: "no_lockfile", command: undefined };
  }
  const commandStr = `${picked.cmd} ${picked.args.join(" ")}`;

  // 4 KB ring buffer for combined stdout+stderr.
  let tail = "";
  const appendToTail = (chunk: string) => {
    tail = (tail + chunk);
    if (tail.length > tailBytes) tail = tail.slice(tail.length - tailBytes);
  };

  // Throttle: at most one onProgress per throttleMs. Always flush the last
  // partial on exit.
  let lastEmit = 0;
  let pendingTimer: NodeJS.Timeout | null = null;
  const emit = () => {
    lastEmit = Date.now();
    if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
    try { onProgress({ line: tail }); } catch { /* swallow */ }
  };
  const scheduleEmit = () => {
    const since = Date.now() - lastEmit;
    if (since >= throttleMs) { emit(); return; }
    if (pendingTimer) return;
    pendingTimer = setTimeout(emit, throttleMs - since);
  };

  // First progress event names the resolved command for log visibility.
  onProgress({ line: `> ${commandStr}\n` });
  appendToTail(`> ${commandStr}\n`);

  const start = Date.now();
  return await new Promise<BootstrapResult>((resolve) => {
    let settled = false;
    const child = spawn(picked.cmd, picked.args, {
      cwd: worktreePath,
      env: opts.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timer = setTimeout(() => {
      if (settled) return;
      try { child.kill("SIGTERM"); } catch { /* noop */ }
      // Give it a moment to die gracefully; then force.
      setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* noop */ } }, 2000);
    }, timeoutMs);

    child.stdout?.on("data", (b: Buffer) => { appendToTail(b.toString("utf8")); scheduleEmit(); });
    child.stderr?.on("data", (b: Buffer) => { appendToTail(b.toString("utf8")); scheduleEmit(); });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
      appendToTail(`\n${err.message}`);
      emit();
      resolve({
        ok: false, durationMs: Date.now() - start, code: "spawn_error",
        stderr: tail, command: commandStr,
      });
    });

    child.on("exit", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
      // Always flush the final tail before resolving.
      emit();
      const ok = code === 0;
      resolve({
        ok,
        durationMs: Date.now() - start,
        code: ok ? undefined : (signal ? `signal_${signal}` : "install_nonzero_exit"),
        stderr: ok ? undefined : tail,
        command: commandStr,
      });
    });
  });
}
