/**
 * Hand-rolled manifest validator (no Zod dependency).
 * Validates PluginManifest and PluginClaim objects.
 */
import {
  SLOT_DEFINITIONS,
  VALID_SETTINGS_TABS,
  type SlotId,
  type SettingsTab,
} from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/slot-types.js";
import type {
  PluginManifest,
  PluginClaim,
  PluginRequirements,
} from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/manifest-types.js";

export class ManifestValidationError extends Error {
  constructor(
    public readonly pluginId: string,
    public readonly reason: string,
  ) {
    super(`[plugin:${pluginId}] Manifest validation failed: ${reason}`);
    this.name = "ManifestValidationError";
  }
}

const VALID_SLOT_IDS = new Set<string>(Object.keys(SLOT_DEFINITIONS));

function validateClaim(claim: unknown, pluginId: string, index: number): PluginClaim {
  if (!claim || typeof claim !== "object") {
    throw new ManifestValidationError(pluginId, `claims[${index}] is not an object`);
  }
  const c = claim as Record<string, unknown>;

  // slot is required and must be a known SlotId
  if (typeof c.slot !== "string") {
    throw new ManifestValidationError(pluginId, `claims[${index}].slot is required`);
  }
  if (!VALID_SLOT_IDS.has(c.slot)) {
    throw new ManifestValidationError(
      pluginId,
      `claims[${index}].slot "${c.slot}" is not a known slot id. Valid ids: ${[...VALID_SLOT_IDS].join(", ")}`,
    );
  }
  const slotId = c.slot as SlotId;

  // shell-overlay-route: require component + top-level path; default sessionParam.
  // Accepts legacy `config.path` / `config.sessionParam` (warns) for backward
  // compat. See change: fix-flows-plugin-polish (path-as-first-class-claim-field).
  if (slotId === "shell-overlay-route") {
    if (typeof c.component !== "string" || !c.component.trim()) {
      throw new ManifestValidationError(
        pluginId,
        `claims[${index}] slot "shell-overlay-route" requires a non-empty "component"`,
      );
    }
    const cfg = (c.config && typeof c.config === "object" && !Array.isArray(c.config))
      ? (c.config as Record<string, unknown>)
      : null;
    const pathVal = typeof c.path === "string" ? c.path : (cfg?.path as string | undefined);
    if (typeof pathVal !== "string" || !pathVal.startsWith("/")) {
      throw new ManifestValidationError(
        pluginId,
        `claims[${index}] slot "shell-overlay-route" requires top-level "path" (a string starting with "/")`,
      );
    }
    const sessionParamVal =
      typeof c.sessionParam === "string"
        ? c.sessionParam
        : (cfg?.sessionParam as string | undefined);
    if (sessionParamVal !== undefined && typeof sessionParamVal !== "string") {
      throw new ManifestValidationError(
        pluginId,
        `claims[${index}] slot "shell-overlay-route" sessionParam must be a string if provided`,
      );
    }
    // Normalize: lift legacy config.path / config.sessionParam to top-level.
    if (typeof c.path !== "string") c.path = pathVal;
    if (typeof c.sessionParam !== "string" && typeof sessionParamVal === "string") {
      c.sessionParam = sessionParamVal;
    }
  }

  // settings-section: validate optional tab field
  if (slotId === "settings-section" && c.tab !== undefined) {
    if (!VALID_SETTINGS_TABS.includes(c.tab as SettingsTab)) {
      throw new ManifestValidationError(
        pluginId,
        `claims[${index}].tab "${c.tab}" is not a valid settings tab. Valid tabs: ${VALID_SETTINGS_TABS.join(", ")}`,
      );
    }
  }

  // optional string fields
  for (const field of [
    "component",
    "command",
    "trigger",
    "toolName",
    "path",
    "sessionParam",
    "predicate",
    "shouldRender",
  ] as const) {
    if (c[field] !== undefined && typeof c[field] !== "string") {
      throw new ManifestValidationError(
        pluginId,
        `claims[${index}].${field} must be a string if provided`,
      );
    }
  }

  return {
    slot: slotId,
    ...(typeof c.component === "string" ? { component: c.component } : {}),
    ...(typeof c.command === "string" ? { command: c.command } : {}),
    ...(typeof c.trigger === "string" ? { trigger: c.trigger } : {}),
    ...(typeof c.toolName === "string" ? { toolName: c.toolName } : {}),
    ...(typeof c.path === "string" ? { path: c.path } : {}),
    ...(typeof c.sessionParam === "string" ? { sessionParam: c.sessionParam } : {}),
    ...(typeof c.tab === "string" ? { tab: c.tab as SettingsTab } : {}),
    ...(typeof c.predicate === "string" ? { predicate: c.predicate } : {}),
    ...(typeof c.shouldRender === "string" ? { shouldRender: c.shouldRender } : {}),
    ...(c.config && typeof c.config === "object" && !Array.isArray(c.config)
      ? { config: c.config as Record<string, unknown> }
      : {}),
  };
}

/**
 * Validate a raw pi-dashboard-plugin manifest object.
 * Throws ManifestValidationError for any violation.
 * Returns the validated PluginManifest on success.
 */
export function validateManifest(raw: unknown, fallbackId = "unknown"): PluginManifest {
  if (!raw || typeof raw !== "object") {
    throw new ManifestValidationError(fallbackId, "manifest is not an object");
  }
  const m = raw as Record<string, unknown>;

  // id: required, kebab-case string
  if (typeof m.id !== "string" || !m.id.trim()) {
    throw new ManifestValidationError(fallbackId, 'manifest.id is required (kebab-case string)');
  }
  const pluginId = m.id;

  // displayName: required string
  if (typeof m.displayName !== "string" || !m.displayName.trim()) {
    throw new ManifestValidationError(pluginId, "manifest.displayName is required");
  }

  // priority: optional number
  if (m.priority !== undefined && typeof m.priority !== "number") {
    throw new ManifestValidationError(pluginId, "manifest.priority must be a number");
  }
  const priority = typeof m.priority === "number" ? m.priority : 1000;
  if (priority < 0 || priority > 10000) {
    console.warn(`[plugin:${pluginId}] priority ${priority} is outside recommended range [0, 10000]`);
  }

  // optional string paths
  for (const field of ["client", "server", "bridge", "configSchema"] as const) {
    if (m[field] !== undefined && typeof m[field] !== "string") {
      throw new ManifestValidationError(pluginId, `manifest.${field} must be a string if provided`);
    }
  }

  // requires: optional declarative requirements (see change: add-plugin-activation-ui).
  let requires: PluginRequirements | undefined;
  if (m.requires !== undefined) {
    if (!m.requires || typeof m.requires !== "object" || Array.isArray(m.requires)) {
      throw new ManifestValidationError(pluginId, "manifest.requires must be an object if provided");
    }
    const r = m.requires as Record<string, unknown>;
    const out: PluginRequirements = {};
    for (const field of ["piExtensions", "binaries", "services"] as const) {
      const arr = r[field];
      if (arr === undefined) continue;
      if (!Array.isArray(arr)) {
        throw new ManifestValidationError(
          pluginId,
          `manifest.requires.${field} must be a string array if provided`,
        );
      }
      const seen = new Set<string>();
      const normalised: string[] = [];
      for (let i = 0; i < arr.length; i++) {
        const v = arr[i];
        if (typeof v !== "string" || v.trim() === "") {
          throw new ManifestValidationError(
            pluginId,
            `manifest.requires.${field}[${i}] must be a non-empty, non-whitespace string`,
          );
        }
        if (seen.has(v)) {
          throw new ManifestValidationError(
            pluginId,
            `manifest.requires.${field} contains duplicate entry "${v}"`,
          );
        }
        seen.add(v);
        normalised.push(v);
      }
      out[field] = normalised;
    }
    if (Object.keys(out).length > 0) requires = out;
  }

  // dependsOn: optional string array. Reject self-reference + duplicates +
  // non-string entries. Cycle detection is deferred to discovery (soft-fail).
  // See change: add-plugin-activation-ui (Layer 2).
  let dependsOn: string[] | undefined;
  if (m.dependsOn !== undefined) {
    if (!Array.isArray(m.dependsOn)) {
      throw new ManifestValidationError(pluginId, "manifest.dependsOn must be a string array if provided");
    }
    const seen = new Set<string>();
    const normalised: string[] = [];
    for (let i = 0; i < m.dependsOn.length; i++) {
      const v = m.dependsOn[i];
      if (typeof v !== "string" || v.trim() === "") {
        throw new ManifestValidationError(
          pluginId,
          `manifest.dependsOn[${i}] must be a non-empty string`,
        );
      }
      if (v === pluginId) {
        throw new ManifestValidationError(
          pluginId,
          `manifest.dependsOn contains self-reference "${pluginId}"`,
        );
      }
      if (seen.has(v)) {
        throw new ManifestValidationError(
          pluginId,
          `manifest.dependsOn contains duplicate entry "${v}"`,
        );
      }
      seen.add(v);
      normalised.push(v);
    }
    if (normalised.length > 0) dependsOn = normalised;
  }

  // claims: required array
  if (!Array.isArray(m.claims)) {
    throw new ManifestValidationError(pluginId, "manifest.claims must be an array");
  }

  const claims: PluginClaim[] = m.claims.map((c, i) => validateClaim(c, pluginId, i));

  // Check for duplicate (slot, toolName) or (slot, command) pairs within one plugin
  const toolRendererNames = new Set<string>();
  const commandRoutes = new Set<string>();
  for (const claim of claims) {
    if (claim.slot === "tool-renderer" && claim.toolName) {
      if (toolRendererNames.has(claim.toolName)) {
        throw new ManifestValidationError(
          pluginId,
          `duplicate tool-renderer claim for toolName "${claim.toolName}"`,
        );
      }
      toolRendererNames.add(claim.toolName);
    }
    if (claim.slot === "command-route" && claim.command) {
      if (commandRoutes.has(claim.command)) {
        throw new ManifestValidationError(
          pluginId,
          `duplicate command-route claim for command "${claim.command}"`,
        );
      }
      commandRoutes.add(claim.command);
    }
  }

  // shell-overlay-route: detect duplicate path within a plugin.
  // See change: fix-flows-plugin-polish (path-as-first-class-claim-field).
  {
    const overlayPaths = new Set<string>();
    for (const claim of claims) {
      if (claim.slot !== "shell-overlay-route") continue;
      const p = claim.path ?? null;
      if (!p) continue;
      if (overlayPaths.has(p)) {
        throw new ManifestValidationError(
          pluginId,
          `duplicate shell-overlay-route claim for path "${p}"`,
        );
      }
      overlayPaths.add(p);
    }
  }

  return {
    id: pluginId,
    displayName: m.displayName,
    priority,
    claims,
    ...(typeof m.client === "string" ? { client: m.client } : {}),
    ...(typeof m.server === "string" ? { server: m.server } : {}),
    ...(typeof m.bridge === "string" ? { bridge: m.bridge } : {}),
    ...(typeof m.configSchema === "string" ? { configSchema: m.configSchema } : {}),
    ...(m.fixture === true ? { fixture: true } : {}),
    ...(requires ? { requires } : {}),
    ...(dependsOn ? { dependsOn } : {}),
  };
}
