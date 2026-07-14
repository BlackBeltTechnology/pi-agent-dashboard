/**
 * Agent-facing role/model tools (capability `agent-role-model-tools`).
 *
 * Three decoupled tools registered via `pi.registerTool` at bridge activation:
 *   - `list_models`  — READ. Assignable model catalogue from the IN-PROCESS
 *                      session registry (the exact ModelSelector source:
 *                      `cachedModelRegistry.getAvailable()`), roles-independent.
 *   - `list_roles`   — READ. `{ roles(bound-only), presets, activePreset }`.
 *   - `update_roles` — WRITE, action-dispatched, `ask_user`-confirmed. Mutates
 *                      the global `~/.pi/agent/providers.json` role slice.
 *
 * Model listing and role reading are DECOUPLED: `list_models` never touches the
 * role slice, so a missing/malformed `providers.json#roles` cannot break model
 * discovery.
 *
 * See change: add-agent-role-model-tools.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { getCustomProviderNames } from "./provider-register.js";
import {
  addRoleName,
  loadRoleConfig,
  removeRoleFromSchema,
  saveRoleConfig,
} from "./role-manager.js";

export interface RoleModelToolsDeps {
  /** Returns the in-process session ModelRegistry (bridge's cachedModelRegistry). */
  getRegistry: () => any;
}

// ── list_models row shape ───────────────────────────────────────────────────

export interface ModelRow {
  ref: string;
  provider: string;
  id: string;
  custom?: boolean;
  reasoning?: boolean;
  input?: string[];
  contextWindow?: number;
  cost?: unknown;
  excludedReason?: "no-credential" | "oauth-incompatible" | null;
}

function rowFromModel(m: any, custom: boolean): ModelRow {
  return {
    ref: `${m?.provider ?? ""}/${m?.id ?? ""}`,
    provider: m?.provider ?? "",
    id: m?.id ?? "",
    ...(custom ? { custom: true } : {}),
    reasoning: typeof m?.reasoning === "boolean" ? m.reasoning : undefined,
    input: Array.isArray(m?.input) ? m.input : undefined,
    contextWindow: typeof m?.contextWindow === "number" ? m.contextWindow : undefined,
    cost: m?.cost,
  };
}

/**
 * Build the model rows from the session registry. Default = reachability-
 * filtered (`getAvailable()`, the ModelSelector source). `annotated` = every
 * known model (`getAll()`) with an `excludedReason` for those not reachable
 * (pi's ModelRegistry has no `getAllAnnotated()`, so we derive it here).
 * Roles-independent: reads only the registry, never the role slice.
 */
export function buildModelRows(registry: any, annotated: boolean): ModelRow[] {
  if (!registry) return [];
  const custom = getCustomProviderNames();
  if (!annotated) {
    const avail: any[] = registry.getAvailable?.() ?? [];
    return avail.map((m) => rowFromModel(m, custom.has(m?.provider)));
  }
  const all: any[] = registry.getAll?.() ?? [];
  const avail: any[] = registry.getAvailable?.() ?? [];
  const availKeys = new Set(avail.map((m) => `${m?.provider}/${m?.id}`));
  return all.map((m) => {
    const row = rowFromModel(m, custom.has(m?.provider));
    row.excludedReason = availKeys.has(`${m?.provider}/${m?.id}`) ? null : "no-credential";
    return row;
  });
}

// ── list_models result envelope (registry-readiness discriminator) ──────────

export interface ModelsResult {
  models: ModelRow[];
  /** false iff the in-process registry is absent (not yet hydrated). */
  registryReady: boolean;
  /** Present only when registryReady === false. */
  reason?: string;
}

/**
 * Wrap `buildModelRows` in the readiness envelope. A falsy registry (the
 * spawn-before-discovery window) yields `registryReady: false` + a `reason`
 * instead of a silent empty catalogue, so an empty `models` is never ambiguous
 * between "registry not hydrated" (retry) and "registry hydrated, no reachable
 * models" (true answer). Additive/backward-compatible: consumers reading only
 * `models` are unaffected. See change: fix-list-models-empty-on-unhydrated-registry.
 */
export function buildModelsResult(registry: any, annotated: boolean): ModelsResult {
  if (!registry) {
    return {
      models: [],
      registryReady: false,
      reason: "model registry not yet hydrated in this session; retry shortly",
    };
  }
  return { models: buildModelRows(registry, annotated), registryReady: true };
}

// ── Registration ─────────────────────────────────────────────────────────────

export function registerRoleModelTools(pi: ExtensionAPI, deps: RoleModelToolsDeps): void {
  // ── list_models (read, roles-independent) ─────────────────────────────────
  pi.registerTool({
    name: "list_models",
    label: "List Models",
    description:
      "List the assignable model catalogue from this session's registry — the exact set the human Model Selector shows (including custom providers). Each row carries a `ref` (\"provider/id\") assignable via update_roles. Pass `annotated: true` to also include models excluded for lack of credentials (each with an `excludedReason`). Independent of roles — works even when no roles are configured. The result also carries `registryReady`: when `false` the in-process registry is not yet hydrated (empty `models` + a `reason`) — retry shortly, do NOT conclude no models exist. When `registryReady` is `true` and `models` is unexpectedly empty, try `annotated: true` to reveal `no-credential`/`oauth-incompatible` exclusions.",
    parameters: Type.Object({
      annotated: Type.Optional(
        Type.Boolean({
          description:
            "When true, include every known model (not just reachable ones), each with an `excludedReason` (\"no-credential\" / \"oauth-incompatible\") or null when included.",
        }),
      ),
    }),
    async execute(_id: any, params: any, _signal: any, _onUpdate: any, _ctx: any) {
      const annotated = params?.annotated === true;
      const result = buildModelsResult(deps.getRegistry(), annotated);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    },
  });

  // ── list_roles (read) ─────────────────────────────────────────────────────
  pi.registerTool({
    name: "list_roles",
    label: "List Roles",
    description:
      "List the configured role → model bindings, the preset names, and the active preset. Returns only roles with an assigned model (empty slots are omitted). No model catalogue — use list_models for that. Tolerates a missing/malformed role config (returns empty).",
    parameters: Type.Object({}),
    async execute(_id: any, _params: any, _signal: any, _onUpdate: any, _ctx: any) {
      const cfg = loadRoleConfig();
      const roles: Record<string, string> = {};
      for (const [k, v] of Object.entries(cfg.roles)) {
        if (typeof v === "string" && v.trim() !== "") roles[k] = v.trim();
      }
      const result = {
        roles,
        presets: cfg.rolePresets.map((p) => p.name),
        activePreset: cfg.activePreset,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    },
  });

  // ── update_roles (write, confirmed, dispatched) ───────────────────────────
  pi.registerTool({
    name: "update_roles",
    label: "Update Roles",
    description:
      "Wire roles and presets. Actions: set_role {role, ref, preset?} (assigns a model ref to a role; creates the role if new; targets a named preset when `preset` given, else the active map), remove_role {role} (purges the role from the schema, the active map, and every preset), create_preset {name}, load_preset {name}, delete_preset {name}. EVERY action mutates the global ~/.pi/agent/providers.json shared by all sessions, so each requires user confirmation before writing.",
    parameters: Type.Object({
      action: Type.Union(
        [
          Type.Literal("set_role"),
          Type.Literal("remove_role"),
          Type.Literal("create_preset"),
          Type.Literal("load_preset"),
          Type.Literal("delete_preset"),
        ],
        { description: "Which mutation to perform." },
      ),
      role: Type.Optional(Type.String({ description: "Role name (set_role, remove_role)." })),
      ref: Type.Optional(
        Type.String({ description: "Model ref \"provider/id\" (set_role). Use list_models to find valid refs." }),
      ),
      preset: Type.Optional(
        Type.String({ description: "Target preset name for set_role (writes into that preset without loading it)." }),
      ),
      name: Type.Optional(
        Type.String({ description: "Preset name (create_preset, load_preset, delete_preset)." }),
      ),
    }),
    async execute(_id: any, params: any, _signal: any, _onUpdate: any, ctx: any) {
      const fail = (error: string) => ({
        content: [{ type: "text", text: JSON.stringify({ success: false, error }) }],
        details: { success: false, error },
      });
      const ok = () => ({
        content: [{ type: "text", text: JSON.stringify({ success: true }) }],
        details: { success: true },
      });

      const action: string = params?.action;

      // Confirmation gate — every mutating action. `providers.json` is shared
      // machine-wide; confirm before any write.
      const confirmMsg = describeAction(params);
      const confirmed = await ctx?.ui?.confirm?.(
        "Update global roles?",
        `${confirmMsg}\n\nThis edits ~/.pi/agent/providers.json, shared by all sessions on this machine.`,
      );
      if (!confirmed) return { ...fail("User declined the change."), details: { success: false } };

      try {
        const cfg = loadRoleConfig();
        switch (action) {
          case "set_role": {
            const role = String(params?.role ?? "").trim();
            const ref = String(params?.ref ?? "").trim();
            if (!role || !ref) return fail("set_role requires `role` and `ref`.");
            addRoleName(cfg, role);
            const preset = typeof params?.preset === "string" ? params.preset.trim() : "";
            if (preset) {
              const p = cfg.rolePresets.find((x) => x.name === preset);
              if (!p) return fail(`Preset "${preset}" not found.`);
              p.roles[role] = ref;
            } else {
              cfg.roles[role] = ref;
              if (cfg.activePreset) {
                const p = cfg.rolePresets.find((x) => x.name === cfg.activePreset);
                if (p) p.roles = { ...cfg.roles };
              }
            }
            saveRoleConfig(cfg);
            return ok();
          }
          case "remove_role": {
            const role = String(params?.role ?? "").trim();
            if (!role) return fail("remove_role requires `role`.");
            removeRoleFromSchema(cfg, role);
            saveRoleConfig(cfg);
            return ok();
          }
          case "create_preset": {
            const name = String(params?.name ?? "").trim();
            if (!name) return fail("create_preset requires `name`.");
            const idx = cfg.rolePresets.findIndex((p) => p.name === name);
            const preset = { name, roles: { ...cfg.roles } };
            if (idx >= 0) cfg.rolePresets[idx] = preset;
            else cfg.rolePresets.push(preset);
            saveRoleConfig(cfg);
            return ok();
          }
          case "load_preset": {
            const name = String(params?.name ?? "").trim();
            if (!name) return fail("load_preset requires `name`.");
            const p = cfg.rolePresets.find((x) => x.name === name);
            if (!p) return fail(`Preset "${name}" not found.`);
            cfg.roles = { ...p.roles };
            cfg.activePreset = name;
            saveRoleConfig(cfg);
            return ok();
          }
          case "delete_preset": {
            const name = String(params?.name ?? "").trim();
            if (!name) return fail("delete_preset requires `name`.");
            const before = cfg.rolePresets.length;
            cfg.rolePresets = cfg.rolePresets.filter((p) => p.name !== name);
            if (cfg.rolePresets.length === before) return fail(`Preset "${name}" not found.`);
            if (cfg.activePreset === name) cfg.activePreset = null;
            saveRoleConfig(cfg);
            return ok();
          }
          default:
            return fail(`Unknown action "${action}".`);
        }
      } catch (err: any) {
        return fail(err?.message ?? String(err));
      }
    },
  });
}

function describeAction(params: any): string {
  switch (params?.action) {
    case "set_role":
      return params?.preset
        ? `Set role "${params?.role}" → "${params?.ref}" in preset "${params?.preset}".`
        : `Set role "${params?.role}" → "${params?.ref}".`;
    case "remove_role":
      return `Remove role "${params?.role}" from every preset.`;
    case "create_preset":
      return `Save the current roles as preset "${params?.name}".`;
    case "load_preset":
      return `Load preset "${params?.name}" (replaces the active roles).`;
    case "delete_preset":
      return `Delete preset "${params?.name}".`;
    default:
      return `Perform "${params?.action}".`;
  }
}
