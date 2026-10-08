/**
 * Model resolution at spawn time.
 *
 * `model` may be a bare provider/model id (passthrough) or an `@role` alias.
 * `@role` is resolved against `~/.pi/agent/providers.json#roles` through the
 * shared resolver. An unresolvable role falls back to the
 * configured default model AND surfaces a run error — never a silent pick.
 *
 * See changes: add-automation-plugin, add-role-aware-model-refs.
 */
import { readRoleConfigFromDisk } from "@blackbelt-technology/pi-dashboard-shared/role-config-disk.js";
import { joinRef, resolveModelRef } from "@blackbelt-technology/pi-dashboard-shared/role-schema.js";

export interface ResolveResult {
  /** Concrete provider/model id to spawn with (empty → shell default). */
  model: string;
  /** Set when an `@role` could not be resolved; the run records this error. */
  error?: string;
}

export interface ResolveOptions {
  /** Role map (injectable for tests). Defaults to on-disk providers.json. */
  readRoles?: () => Record<string, string>;
  /** Configured fallback model id when an `@role` is unresolved. */
  defaultModel?: string;
}

/**
 * Resolve an automation `model` field through the shared resolver. `@role` /
 * `@role:level` → `provider/id[:level]` (ref level > role level); bare ids pass
 * through verbatim. Unresolved `@role` → `{ model: defaultModel, error }`.
 */
export function resolveModel(model: string, opts: ResolveOptions = {}): ResolveResult {
  const trimmed = model.trim();
  if (!trimmed.startsWith("@")) {
    return { model: trimmed };
  }
  const roles = opts.readRoles ? opts.readRoles() : readRoleConfigFromDisk().roles;
  const r = resolveModelRef(trimmed, { roles });
  if (!r.unresolved && r.model) {
    return { model: joinRef(r.model, r.level) };
  }
  return {
    model: opts.defaultModel ?? "",
    error: `unresolved role "${trimmed}"${opts.defaultModel ? ` — falling back to default model "${opts.defaultModel}"` : " — no default model configured"}`,
  };
}
