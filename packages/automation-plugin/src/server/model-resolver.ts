/**
 * Model resolution at spawn time.
 *
 * `model` may be a bare provider/model id (passthrough) or an `@role` alias.
 * `@role` is resolved against `~/.pi/agent/providers.json#roles` (the same
 * map the roles plugin writes). An unresolvable role falls back to the
 * configured default model AND surfaces a run error — never a silent pick.
 *
 * See change: add-automation-plugin.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface ResolveResult {
  /** Concrete provider/model id to spawn with (empty → shell default). */
  model: string;
  /** Set when an `@role` could not be resolved; the run records this error. */
  error?: string;
}

/** Read `roles` from `~/.pi/agent/providers.json`. Returns `{}` on any failure. */
export function readRolesFromDisk(homeDir: string = os.homedir()): Record<string, string> {
  const p = path.join(homeDir, ".pi", "agent", "providers.json");
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf-8")) as { roles?: Record<string, string> };
    return raw.roles ?? {};
  } catch {
    return {};
  }
}

export interface ResolveOptions {
  /** Role map (injectable for tests). Defaults to on-disk providers.json. */
  readRoles?: () => Record<string, string>;
  /** Configured fallback model id when an `@role` is unresolved. */
  defaultModel?: string;
}

/**
 * Resolve an automation `model` field. `@role` → concrete model via the role
 * map; bare ids pass through. Unresolved `@role` → `{ model: defaultModel,
 * error }`.
 */
export function resolveModel(model: string, opts: ResolveOptions = {}): ResolveResult {
  const trimmed = model.trim();
  if (!trimmed.startsWith("@")) {
    return { model: trimmed };
  }
  const roleName = trimmed.slice(1);
  const roles = (opts.readRoles ?? readRolesFromDisk)();
  const resolved = roles[roleName];
  if (resolved && resolved.length > 0) {
    return { model: resolved };
  }
  return {
    model: opts.defaultModel ?? "",
    error: `unresolved role "${trimmed}"${opts.defaultModel ? ` — falling back to default model "${opts.defaultModel}"` : " — no default model configured"}`,
  };
}
