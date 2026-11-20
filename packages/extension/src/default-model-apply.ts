/**
 * Apply the dashboard Settings default model (and thinking level) to a
 * brand-new pi session. Extracted from bridge.ts so it is unit-testable.
 *
 * `defaultModel` may be a concrete `provider/id` or an `@role[:level]` ref.
 * A role ref is resolved against the CURRENT role map on every call (startup
 * and the pending retry) — no cache, so a preset load changes the next new
 * session's model. Unresolved role → no `setModel`, no pending retry, one log
 * line; pi keeps its own default.
 *
 * Level after `setModel`: non-empty `defaultThinkingLevel` > ref suffix >
 * role level > none. See change: default-model-follows-role (D1, D2, D6).
 */
import { type RoleConfig, resolveDefaultModel } from "@blackbelt-technology/pi-dashboard-shared/role-schema.js";

interface DefaultModelConfig {
  defaultModel?: string;
  defaultThinkingLevel?: string;
}

export interface ApplyDefaultModelDeps {
  loadConfig: () => DefaultModelConfig;
  readRoles: () => Pick<RoleConfig, "roles">;
  registry: { find(provider: string, id: string): unknown } | null | undefined;
  setModel: (model: unknown) => Promise<unknown>;
  setThinkingLevel?: (level: string) => void;
  /** Called after `setModel` (and level) resolve. */
  onApplied?: () => void;
  log: (msg: string) => void;
}

/** Returns the pending model string when the model is not in the registry yet, else `null`. */
export function applyDefaultModel(deps: ApplyDefaultModelDeps): string | null {
  const cfg = deps.loadConfig();
  const value = cfg.defaultModel;
  if (!value || !deps.registry) return null;

  let provider: string;
  let modelId: string;
  let roleLevel: string | undefined;
  if (value.startsWith("@")) {
    let roles: Pick<RoleConfig, "roles">;
    try {
      roles = deps.readRoles();
    } catch {
      roles = { roles: {} };
    }
    const r = resolveDefaultModel(value, roles);
    if (r.kind !== "role") {
      deps.log(`[default-model] unresolved role ${value}; using pi default`);
      return null;
    }
    provider = r.provider;
    modelId = r.id;
    roleLevel = r.level;
  } else {
    const slashIdx = value.indexOf("/");
    if (slashIdx <= 0) return null;
    provider = value.slice(0, slashIdx);
    modelId = value.slice(slashIdx + 1);
  }

  try {
    const found = deps.registry.find(provider, modelId);
    if (found) {
      deps
        .setModel(found)
        .then(() => {
          // setModel preserves the current level, so an explicit call is
          // required. Empty `defaultThinkingLevel` = adopt the role's level
          // (role default) / do not override (concrete default).
          const level = cfg.defaultThinkingLevel || roleLevel;
          if (level) deps.setThinkingLevel?.(level);
          deps.onApplied?.();
        })
        .catch(() => {});
      return null; // applied
    }
  } catch {
    /* ignore */
  }
  return value; // not found yet — pending (re-resolved on retry)
}
