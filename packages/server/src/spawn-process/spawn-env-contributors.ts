/**
 * Plugin spawn-env contributor registry.
 *
 * Trusted dashboard plugins may contribute environment variables to the pi
 * sessions the dashboard spawns (`ServerPluginContext.registerSpawnEnvContributor`).
 * `buildSpawnEnv` calls {@link applySpawnEnvContributors} AFTER its own shaping:
 *
 *   1. remove names a bridge recorded as plugin-projected (provenance marker),
 *      restricted to the names the contributing plugin declared (`supersede`)
 *   2. validate contributions (name regex, NUL, denylist)
 *   3. apply to names still absent from the env
 *
 * Failing contributors never block a spawn. Disabled plugins are filtered at
 * spawn time (the loader has no teardown hook).
 *
 * See change: add-context-mode-settings-plugin.
 */

export type ContributorMechanism = "headless" | "tmux" | "wt" | "wsl-tmux";

export interface SpawnEnvContributorOptions {
  /** Marker env var a bridge fills with the names it projected, plus the names this plugin may supersede. */
  supersede?: { marker: string; names: readonly string[] };
}

export type SpawnEnvContributorFn = (ctx: { mechanism: ContributorMechanism }) => Record<string, string>;

interface Entry {
  pluginId: string;
  fn: SpawnEnvContributorFn;
  opts?: SpawnEnvContributorOptions;
}

const NAME_RE = /^[A-Z_][A-Z0-9_]*$/;
const DENY_EXACT = new Set(["PATH", "HOME", "USERPROFILE", "SHELL", "CONTEXT_MODE_EMBEDDED_PLUGIN_TOOLS"]);
const DENY_PREFIXES = ["NODE_", "LD_", "DYLD_", "PI_DASHBOARD_", "ELECTRON_", "CONTEXT_MODE_BRIDGE_"];

const contributors = new Set<Entry>();
let isPluginEnabled: (pluginId: string) => boolean = () => true;

/** Wire the "is this plugin enabled in config" check (server.ts). Tests may inject. */
export function setSpawnEnvPluginEnabledCheck(fn: ((pluginId: string) => boolean) | null): void {
  isPluginEnabled = fn ?? (() => true);
}

/** Register a contributor; returns its unregister function. */
export function registerSpawnEnvContributor(
  pluginId: string,
  fn: SpawnEnvContributorFn,
  opts?: SpawnEnvContributorOptions,
): () => void {
  const entry: Entry = { pluginId, fn, opts };
  contributors.add(entry);
  return () => {
    contributors.delete(entry);
  };
}

/** Test-only: drop every registration. */
export function _resetSpawnEnvContributorsForTests(): void {
  contributors.clear();
  isPluginEnabled = () => true;
}

/** Legal contributed env var name (regex + denylist). */
function isContributableName(name: string): boolean {
  if (!NAME_RE.test(name)) return false;
  if (DENY_EXACT.has(name)) return false;
  return !DENY_PREFIXES.some((p) => name.startsWith(p));
}

function warn(pluginId: string, msg: string): void {
  console.warn(`[env-contributor] plugin "${pluginId}": ${msg}`);
}

function activeEntries(): Entry[] {
  return [...contributors].filter((c) => {
    try {
      return isPluginEnabled(c.pluginId);
    } catch {
      return false;
    }
  });
}

/** Step 2: provenance-marker removal, bounded by each plugin's declared names. */
function removeSuperseded(env: NodeJS.ProcessEnv, c: Entry): void {
  const sup = c.opts?.supersede;
  if (!sup || !isContributableName(sup.marker)) return;
  const allowed = new Set(sup.names);
  for (const name of (env[sup.marker] ?? "").split(",").map((s) => s.trim())) {
    if (allowed.has(name) && isContributableName(name)) delete env[name];
  }
  delete env[sup.marker];
}

/** Run one contributor; returns only its validated entries (warns on every rejection). */
function collect(c: Entry, mechanism: ContributorMechanism): Record<string, string> {
  let out: unknown;
  try {
    out = c.fn({ mechanism });
  } catch (err) {
    warn(c.pluginId, `contributor threw: ${err instanceof Error ? err.message : String(err)}`);
    return {};
  }
  if (out === null || typeof out !== "object" || Array.isArray(out)) {
    warn(c.pluginId, "contributor returned a non-object; skipped");
    return {};
  }
  const valid: Record<string, string> = {};
  for (const [name, value] of Object.entries(out as Record<string, unknown>)) {
    if (!isContributableName(name)) warn(c.pluginId, `rejected env name "${name}"`);
    else if (typeof value !== "string" || value.includes("\u0000")) warn(c.pluginId, `rejected value for "${name}"`);
    else valid[name] = value;
  }
  return valid;
}

/**
 * Mutate `env` with contributions for `mechanism`. Returns the entries that
 * were actually applied (the tmux path emits them as per-window `-e`).
 */
export function applySpawnEnvContributors(
  env: NodeJS.ProcessEnv,
  mechanism: ContributorMechanism,
): Record<string, string> {
  const active = activeEntries();
  for (const c of active) removeSuperseded(env, c);
  const applied: Record<string, string> = {};
  for (const c of active) {
    for (const [name, value] of Object.entries(collect(c, mechanism))) {
      if (env[name] !== undefined) continue;
      env[name] = value;
      applied[name] = value;
    }
  }
  return applied;
}
