/**
 * `ensureTools` — the library face of tool ensuring (design D4/D5).
 *
 * Default stance is RECOMMEND-ONLY: a missing tool never installs
 * anything. With explicit `autoInstall: true`, the ONLY executable
 * string is a resolved first-party `installHints.commands[pkgmgr]` value
 * from the registry definition — a skill manifest can never contribute
 * one. Hints flagged `requiresConfirm` (network fetch / image build)
 * demand a per-invocation confirmation even under opt-in; no confirmation
 * callback (headless) means auto-deny.
 *
 * Report matrix (see __tests__/ensure-tools.test.ts):
 *   present → "present" · required missing, no hint → "blocked" ·
 *   required missing, hint, no opt-in → "recommended" (ok:false) ·
 *   required missing, install ran → "installed" | "blocked" ·
 *   optional missing → "degraded".  ok ⇔ every required entry present/installed.
 *
 * See change: add-skill-tool-provisioning.
 */
import { execAsync } from "../platform/exec.js";
import { ToolResolver } from "../platform/binary-lookup.js";
import type { ToolRegistry } from "./registry.js";
import { getDefaultRegistry } from "./default-registry.js";
import type { StrategyDeps } from "./strategies.js";
import { UnknownToolError } from "./types.js";
import type {
  InstallHints,
  PlatformInstallHint,
  Resolution,
} from "./types.js";

/** What the registry did (or would do) about a tool's absence. */
export type EnsureAction =
  | "present"
  | "recommended"
  | "installed"
  | "degraded"
  | "blocked";

/** One `{ id, optional? }` spec — the same shape as a manifest entry's core. */
export interface EnsureToolSpec {
  id: string;
  optional?: boolean;
}

/** One row of an EnsureReport: the tool's Resolution + ensure outcome. */
export type EnsureToolEntry = Resolution & {
  optional: boolean;
  action: EnsureAction;
};

export interface EnsureReport {
  ok: boolean;
  tools: EnsureToolEntry[];
}

export interface EnsureOptions {
  /** Registry to resolve against. Default: the process-wide singleton. */
  registry?: ToolRegistry;
  /** Injectable strategy deps (which/readEnv/…); default: live probes. */
  deps?: StrategyDeps;
  /** Opt-in auto-run of first-party hints. Default: recommend-only. */
  autoInstall?: boolean;
  /**
   * Confirmation gate for `requiresConfirm` hints. Absent (headless) →
   * auto-deny. Return true to allow this invocation's install.
   */
  confirm?: (request: { tool: string; command: string }) => boolean | Promise<boolean>;
  /** Command runner. Default: child_process.exec (see {@link EnsureOptions.cwd}). Injectable for tests. */
  exec?: (command: string, cwd?: string) => { ok: boolean } | Promise<{ ok: boolean }> | void | Promise<void>;
  /** Working directory for the default exec runner (e.g. the manifest package root). */
  cwd?: string;
  /** Platform for hint lookup. Default: the registry's platform. */
  platform?: NodeJS.Platform;
}

/** Host package manager = the first commands key whose binary is on PATH. */
function detectPkgMgr(commands: Record<string, string>, which: (n: string) => string | null): string | null {
  for (const key of Object.keys(commands)) {
    if (which(key)) return key;
  }
  return null;
}

function defaultExec(command: string, cwd?: string): Promise<{ ok: boolean }> {
  return execAsync(command, { timeout: 10 * 60_000, cwd })
    .then(() => ({ ok: true }))
    .catch(() => ({ ok: false }));
}

const defaultWhich = (() => {
  let resolver: ToolResolver | null = null;
  return (name: string): string | null => {
    resolver ??= new ToolResolver({ processExecPath: process.execPath, useLoginShell: true });
    return resolver.which(name);
  };
})();

/** The hint for the host platform, if any. */
function hostHint(
  hints: InstallHints | undefined,
  platform: NodeJS.Platform,
): PlatformInstallHint | undefined {
  if (hints === undefined) return undefined;
  if (platform === "darwin" || platform === "win32" || platform === "linux") {
    return hints[platform];
  }
  return undefined;
}

/**
 * Ensure a set of tools resolves; never throws for missing tools — the
 * report IS the outcome (facades decide what to do with `blocked`).
 */
export async function ensureTools(
  tools: readonly EnsureToolSpec[],
  opts: EnsureOptions = {},
): Promise<EnsureReport> {
  // `default-registry.js` (not index.js): index re-exports this module,
  // and Biome noImportCycles rejects the round trip even via import().
  const registry = opts.registry ?? getDefaultRegistry();
  const platform = opts.platform ?? registry.getPlatform();
  const which = opts.deps?.which ?? defaultWhich;
  const runCommand = opts.exec ?? defaultExec;
  // One list() pass resolves (and caches) every tool once and carries the
  // first-party hints — the only runnable strings in the auto-run path.
  const hintsByName = new Map(registry.list().map((t) => [t.name, t.installHints]));
  const entries: EnsureToolEntry[] = [];

  for (const spec of tools) {
    const optional = spec.optional ?? false;
    let resolution: Resolution;
    try {
      resolution = registry.resolve(spec.id);
    } catch (e) {
      if (!(e instanceof UnknownToolError)) throw e;
      // Never reject for an unregistered id — report it as missing so the
      // report IS the outcome (facades decide what "blocked" means).
      resolution = {
        name: spec.id,
        ok: false,
        path: null,
        source: null,
        tried: [],
        resolvedAt: Date.now(),
      };
    }
    let action: EnsureAction;

    if (resolution.ok) {
      action = "present";
    } else {
      const hint = hostHint(hintsByName.get(spec.id), platform);
      const commands = hint?.commands;
      const pkgmgr = commands ? detectPkgMgr(commands, which) : null;
      const candidate = commands && pkgmgr ? commands[pkgmgr] : undefined;

      // Opt-in auto-run: the ONLY executable string is the first-party
      // hint; requiresConfirm hints demand a per-invocation confirmation
      // (no callback → headless → auto-deny).
      const mayAutoRun = candidate !== undefined && opts.autoInstall === true;
      let confirmed = false;
      if (mayAutoRun) {
        confirmed = hint?.requiresConfirm
          ? opts.confirm
            ? await opts.confirm({ tool: spec.id, command: candidate! })
            : false
          : true;
      }
      if (mayAutoRun && confirmed) {
        const result = await runCommand(candidate!, opts.cwd);
        const execOk = result === undefined || result.ok !== false;
        if (execOk) {
          registry.rescan(spec.id);
          resolution = registry.resolve(spec.id);
        }
      }

      if (resolution.ok) {
        action = "installed";
      } else if (optional) {
        // Optional tools never block — absence degrades, whatever the path.
        action = "degraded";
      } else if (candidate !== undefined && opts.autoInstall) {
        // An eligible remedy existed but the install was denied or failed.
        action = "blocked";
      } else if (candidate !== undefined) {
        // Eligible first-party remedy, auto-run not opted into.
        action = "recommended";
      } else {
        action = "blocked";
      }
    }

    entries.push({ ...resolution, optional, action });
  }

  const ok = entries.every((e) => e.optional || e.action === "present" || e.action === "installed");
  return { ok, tools: entries };
}
