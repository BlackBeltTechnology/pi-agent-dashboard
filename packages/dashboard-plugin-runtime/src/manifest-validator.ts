/**
 * Hand-rolled manifest validator (no Zod dependency).
 * Validates PluginManifest and PluginClaim objects.
 */

import type {
  PluginClaim,
  PluginManifest,
  PluginRequirements,
  SettingsNavHint,
} from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/manifest-types.js";
import {
  type SettingsTab,
  SLOT_DEFINITIONS,
  type SlotId,
} from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/slot-types.js";

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

const NAV_LABEL_MAX = 40;
const NAV_DESCRIPTION_MAX = 200;
/** Unicode control (Cc) + format (Cf): bidi overrides, LRM/RLM, ZWSP, BOM, newlines. */
const CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}]/u;

/**
 * Normalise one `nav` text field (NFKC + trim) and check it. Returns the
 * value (`""` when blank/absent and optional) or an error reason.
 */
function navText(
  v: unknown,
  opts: { required: boolean; max?: number },
): { value: string } | { error: string } {
  if (v === undefined && !opts.required) return { value: "" };
  if (typeof v !== "string") return { error: opts.required ? "must be a non-empty string" : "must be a string if provided" };
  const value = v.normalize("NFKC").trim();
  if (opts.required && !value) return { error: "must be a non-empty string" };
  if (CONTROL_OR_FORMAT.test(value)) return { error: "contains a Unicode control/format character" };
  if (opts.max !== undefined && value.length > opts.max) return { error: `exceeds ${opts.max} characters` };
  return { value };
}

/**
 * Validate a `settings-section` claim's optional `nav` promotion hint.
 * Drop-don't-throw: an invalid hint returns `undefined` after ONE warning
 * naming plugin id, claim index and offending field; a placement hint must
 * never unload a plugin. See change: promote-model-roles-settings (D7).
 */
function validateNavHint(raw: unknown, pluginId: string, index: number): SettingsNavHint | undefined {
  const drop = (field: string, why: string): undefined => {
    console.warn(
      `[plugin:${pluginId}] claims[${index}].${field} ${why}; ignoring the settings-section nav hint`,
    );
    return undefined;
  };
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return drop("nav", "must be a plain object");
  }
  const n = raw as Record<string, unknown>;
  const fields = {
    group: navText(n.group, { required: true }),
    label: navText(n.label, { required: true, max: NAV_LABEL_MAX }),
    description: navText(n.description, { required: false, max: NAV_DESCRIPTION_MAX }),
  };
  for (const [field, r] of Object.entries(fields)) {
    if ("error" in r) return drop(`nav.${field}`, r.error);
  }
  if (n.order !== undefined && (typeof n.order !== "number" || !Number.isFinite(n.order))) {
    return drop("nav.order", "must be a finite number if provided");
  }
  const value = (r: { value: string } | { error: string }) => ("value" in r ? r.value : "");
  const description = value(fields.description);
  return {
    group: value(fields.group),
    label: value(fields.label),
    ...(description ? { description } : {}),
    ...(typeof n.order === "number" ? { order: n.order } : {}),
  };
}

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
    // depth: optional 1 | 2. Missing depth defaults to overlay (2) so the
    // contributed route descriptor backs to cards instead of the old dead
    // no-op; warn so authors declare it. See change:
    // fix-plugin-and-scoped-back-navigation.
    if (c.depth !== undefined && c.depth !== 1 && c.depth !== 2) {
      throw new ManifestValidationError(
        pluginId,
        `claims[${index}] slot "shell-overlay-route" depth must be 1 or 2 if provided`,
      );
    }
    if (c.depth === undefined) {
      console.warn(
        `[plugin:${pluginId}] claims[${index}] shell-overlay-route claim omits "depth"; defaulting to 2 (overlay → cards). Declare "depth" (1 or 2) for correct back navigation.`,
      );
    }
    // parentPath: optional string starting with "/".
    if (c.parentPath !== undefined) {
      if (typeof c.parentPath !== "string" || !c.parentPath.startsWith("/")) {
        throw new ManifestValidationError(
          pluginId,
          `claims[${index}] slot "shell-overlay-route" parentPath must be a string starting with "/" if provided`,
        );
      }
    }
    // presentation: optional "page" | "dialog". Unlike `depth`, an unknown
    // value is FATAL rather than a warn-and-default: a typo like "modal" would
    // otherwise silently fall back to the dialog default, and the author would
    // see the behaviour they asked to opt OUT of. See change:
    // add-route-backed-overlay-dialogs.
    if (
      c.presentation !== undefined &&
      c.presentation !== "page" &&
      c.presentation !== "dialog"
    ) {
      throw new ManifestValidationError(
        pluginId,
        `claims[${index}] slot "shell-overlay-route" presentation must be "page" or "dialog" if provided`,
      );
    }
  }

  // custom-entry-renderer: require a non-empty `customType` + `component`.
  // The claim is keyed by `customType` (exact match); a missing/blank key could
  // never resolve, and a missing component has nothing to render.
  // See change: add-custom-entry-renderer-slot.
  if (slotId === "custom-entry-renderer") {
    if (typeof c.customType !== "string" || !c.customType.trim()) {
      throw new ManifestValidationError(
        pluginId,
        `claims[${index}] slot "custom-entry-renderer" requires a non-empty "customType"`,
      );
    }
    if (typeof c.component !== "string" || !c.component.trim()) {
      throw new ManifestValidationError(
        pluginId,
        `claims[${index}] slot "custom-entry-renderer" requires a non-empty "component"`,
      );
    }
  }

  // settings-section: `tab` is accepted but inert. Every `settings-section`
  // claim renders on its owning plugin's page (`/settings/plugins/<id>`), so
  // rejecting an unknown VALUE would fail a manifest over a field nothing
  // reads. The TYPE is still enforced: `tab` is copied onto the normalized
  // claim, so a non-string would violate the manifest type it is cast to.
  // See change: plugin-settings-pages (design D3).
  if (slotId === "settings-section" && c.tab !== undefined && typeof c.tab !== "string") {
    throw new ManifestValidationError(
      pluginId,
      `claims[${index}].tab must be a string if provided`,
    );
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

  // settings-section: optional `nav` promotion hint (non-fatal). `nav` on any
  // other slot is dropped silently. See change: promote-model-roles-settings.
  const navHint =
    slotId === "settings-section" && "nav" in c && c.nav !== undefined
      ? validateNavHint(c.nav, pluginId, index)
      : undefined;

  return {
    slot: slotId,
    ...(typeof c.component === "string" ? { component: c.component } : {}),
    ...(typeof c.command === "string" ? { command: c.command } : {}),
    ...(typeof c.trigger === "string" ? { trigger: c.trigger } : {}),
    ...(typeof c.toolName === "string" ? { toolName: c.toolName } : {}),
    ...(typeof c.customType === "string" ? { customType: c.customType } : {}),
    ...(typeof c.path === "string" ? { path: c.path } : {}),
    ...(typeof c.sessionParam === "string" ? { sessionParam: c.sessionParam } : {}),
    ...(c.depth === 1 || c.depth === 2 ? { depth: c.depth } : {}),
    ...(typeof c.parentPath === "string" ? { parentPath: c.parentPath } : {}),
    ...(c.presentation === "page" || c.presentation === "dialog"
      ? { presentation: c.presentation }
      : {}),
    ...(typeof c.tab === "string" ? { tab: c.tab as SettingsTab } : {}),
    ...(navHint ? { nav: navHint } : {}),
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
    for (const field of ["piExtensions", "binaries", "services", "paths"] as const) {
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

  // defaultEnabled: optional boolean. When false the plugin ships disabled
  // (fresh install / no config entry). See change: add-browser-relay (GAP B).
  if (m.defaultEnabled !== undefined && typeof m.defaultEnabled !== "boolean") {
    throw new ManifestValidationError(pluginId, "manifest.defaultEnabled must be a boolean if provided");
  }

  // claims: required array
  if (!Array.isArray(m.claims)) {
    throw new ManifestValidationError(pluginId, "manifest.claims must be an array");
  }

  const claims: PluginClaim[] = m.claims.map((c, i) => validateClaim(c, pluginId, i));

  // Check for duplicate (slot, toolName) or (slot, command) pairs within one plugin
  const toolRendererNames = new Set<string>();
  const commandRoutes = new Set<string>();
  const customEntryTypes = new Set<string>();
  for (const claim of claims) {
    if (claim.slot === "custom-entry-renderer" && claim.customType) {
      if (customEntryTypes.has(claim.customType)) {
        throw new ManifestValidationError(
          pluginId,
          `duplicate custom-entry-renderer claim for customType "${claim.customType}"`,
        );
      }
      customEntryTypes.add(claim.customType);
    }
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
    ...(m.defaultEnabled === true || m.defaultEnabled === false ? { defaultEnabled: m.defaultEnabled } : {}),
    ...(typeof m.i18nCatalog === "string" ? { i18nCatalog: m.i18nCatalog } : {}),
    ...(m.fixture === true ? { fixture: true } : {}),
    ...(requires ? { requires } : {}),
    ...(dependsOn ? { dependsOn } : {}),
  };
}
