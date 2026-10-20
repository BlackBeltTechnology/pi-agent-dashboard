/**
 * Hand-rolled manifest validator (no Zod dependency).
 * Validates PluginManifest and PluginClaim objects.
 */

import {
  PANE_TAB_PREFIX_RE,
  RESERVED_PANE_TAB_PREFIXES,
} from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/editor-pane-tab.js";
import { isValidEventTypePattern } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/event-type-owners.js";
import { isValidHostApiRange } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/host-api.js";
import {
  FILE_HANDLER_COPY_SUFFIX_RE,
  FILE_HANDLER_EXT_RE,
  FILE_HANDLER_ID_RE,
  FILE_HANDLER_KEEPALIVE_MAX,
  FILE_HANDLER_LABEL_MAX,
  FILE_HANDLER_NOTICE_MAX,
  HANDLER_MAX_BYTES,
} from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/file-handler.js";
import type {
  PluginClaim,
  PluginManifest,
  PluginRequirements,
  ProjectTypeRule,
  SettingsNavHint,
} from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/manifest-types.js";
import {
  MAX_MARKERS_PER_TYPE,
  MAX_PROJECT_TYPES,
  markerPatternError,
  PROJECT_NAME_RE,
} from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/project-markers.js";
import {
  type SettingsTab,
  SLOT_DEFINITIONS,
  type SlotId,
} from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/slot-types.js";
import { isUnclaimableHandlerExt } from "@blackbelt-technology/pi-dashboard-shared/file-kind.js";

/** Valid `resource-page-section` `resourceType` values. See change: add-skill-atlas-screen. */
const RESOURCE_PAGE_TYPES: ReadonlySet<string> = new Set(["skill", "agent", "extension", "prompt", "theme"]);

/**
 * Validate the optional `projectTypes` marker rules (fatal on any violation).
 * See change: add-project-scoped-apps.
 */
function validateProjectTypes(raw: unknown, pluginId: string): ProjectTypeRule[] {
  if (!Array.isArray(raw)) {
    throw new ManifestValidationError(pluginId, "manifest.projectTypes must be an array if provided");
  }
  if (raw.length > MAX_PROJECT_TYPES) {
    throw new ManifestValidationError(
      pluginId,
      `manifest.projectTypes has ${raw.length} entries (max ${MAX_PROJECT_TYPES})`,
    );
  }
  return raw.map((entry, i) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new ManifestValidationError(pluginId, `manifest.projectTypes[${i}] must be an object`);
    }
    const e = entry as Record<string, unknown>;
    if (typeof e.type !== "string" || !PROJECT_NAME_RE.test(e.type)) {
      throw new ManifestValidationError(
        pluginId,
        `manifest.projectTypes[${i}].type must match ${PROJECT_NAME_RE.source}`,
      );
    }
    if (!Array.isArray(e.markers) || e.markers.length < 1 || e.markers.length > MAX_MARKERS_PER_TYPE) {
      throw new ManifestValidationError(
        pluginId,
        `manifest.projectTypes[${i}].markers must hold 1 to ${MAX_MARKERS_PER_TYPE} patterns`,
      );
    }
    const markers = e.markers.map((m: unknown, j: number) => {
      const violation = markerPatternError(m);
      if (violation !== null) {
        throw new ManifestValidationError(
          pluginId,
          `manifest.projectTypes[${i}].markers[${j}] "${String(m)}" ${violation}`,
        );
      }
      return m as string;
    });
    return { type: e.type, markers };
  });
}

export class ManifestValidationError extends Error {
  public readonly pluginId: string;
  public readonly reason: string;

  constructor(
    pluginId: string,
    reason: string,
  ) {
    super(`[plugin:${pluginId}] Manifest validation failed: ${reason}`);
    this.pluginId = pluginId;
    this.reason = reason;
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
  const normalized = v.normalize("NFKC");
  // Checked BEFORE trimming: `trim()` strips boundary newlines/tabs/BOM, which
  // would otherwise launder a control character into a valid label.
  if (CONTROL_OR_FORMAT.test(normalized)) return { error: "contains a Unicode control/format character" };
  const value = normalized.trim();
  if (opts.required && !value) return { error: "must be a non-empty string" };
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

/** The normalized `editor-pane-file-handler` fields of a claim. */
type FileHandlerFields = Pick<
  PluginClaim,
  "id" | "extensions" | "mode" | "label" | "keepAlive" | "maxBytes" | "firstOverwriteNotice" | "copySuffix" | "validator"
>;

/**
 * Validate + normalize the `editor-pane-file-handler` claim fields (fatal on
 * any violation). Text-backed or frozen-deny-listed extensions are rejected via
 * `isUnclaimableHandlerExt` (the text set stays derived from `fileKind`). See change: add-editor-pane-file-handlers (D1).
 */
function validateFileHandlerClaim(c: Record<string, unknown>, pluginId: string, index: number): FileHandlerFields {
  const at = `claims[${index}] slot "editor-pane-file-handler"`;
  const fail = (msg: string): never => {
    throw new ManifestValidationError(pluginId, `${at} ${msg}`);
  };
  if (typeof c.component !== "string" || !c.component.trim()) fail('requires a non-empty "component"');
  if (typeof c.id !== "string" || !FILE_HANDLER_ID_RE.test(c.id)) {
    fail(`.id must match ${FILE_HANDLER_ID_RE} (got ${JSON.stringify(c.id)})`);
  }
  if (!Array.isArray(c.extensions) || c.extensions.length === 0) fail('"extensions" must be a non-empty array');
  const extensions = c.extensions as unknown[];
  for (const ext of extensions) {
    if (typeof ext !== "string" || !FILE_HANDLER_EXT_RE.test(ext)) {
      fail(`extension ${JSON.stringify(ext)} must match ${FILE_HANDLER_EXT_RE} (lower-case, single segment, leading dot)`);
    }
    if (isUnclaimableHandlerExt(ext as string)) {
      fail(`extension "${ext}" is a text-backed file kind (edited through /api/file/write) or reserved (secrets, scripts, plain text) and cannot be claimed`);
    }
  }
  if (c.mode !== "preview" && c.mode !== "edit") fail('"mode" must be "preview" or "edit"');
  if (typeof c.label !== "string" || !c.label.trim() || c.label.length > FILE_HANDLER_LABEL_MAX) {
    fail(`"label" must be a non-empty string of at most ${FILE_HANDLER_LABEL_MAX} chars`);
  }
  let keepAlive: { max: number } | undefined;
  if (c.keepAlive !== undefined) {
    const k = c.keepAlive as { max?: unknown } | null;
    const max = k && typeof k === "object" ? k.max : undefined;
    if (typeof max !== "number" || !Number.isInteger(max) || max < 1 || max > FILE_HANDLER_KEEPALIVE_MAX) {
      fail(`"keepAlive" must be { max: 1..${FILE_HANDLER_KEEPALIVE_MAX} }`);
    }
    keepAlive = { max: max as number };
  }
  if (
    c.maxBytes !== undefined &&
    (typeof c.maxBytes !== "number" || !Number.isInteger(c.maxBytes) || c.maxBytes < 1 || c.maxBytes > HANDLER_MAX_BYTES)
  ) {
    fail(`"maxBytes" must be an integer in 1..${HANDLER_MAX_BYTES}`);
  }
  if (
    c.firstOverwriteNotice !== undefined &&
    (typeof c.firstOverwriteNotice !== "string" || !c.firstOverwriteNotice.trim() || c.firstOverwriteNotice.length > FILE_HANDLER_NOTICE_MAX)
  ) {
    fail(`"firstOverwriteNotice" must be a non-empty string of at most ${FILE_HANDLER_NOTICE_MAX} chars`);
  }
  if (c.validator !== undefined && typeof c.validator !== "boolean") fail('"validator" must be a boolean');
  const copySuffixGiven = c.copySuffix !== undefined;
  if (copySuffixGiven && (typeof c.copySuffix !== "string" || !FILE_HANDLER_COPY_SUFFIX_RE.test(c.copySuffix))) {
    fail(`"copySuffix" must match ${FILE_HANDLER_COPY_SUFFIX_RE}`);
  }
  if (c.mode === "edit" && !copySuffixGiven) fail('mode "edit" requires "copySuffix"');
  return {
    id: c.id as string,
    extensions: [...(extensions as string[])],
    mode: c.mode as "preview" | "edit",
    label: c.label as string,
    ...(keepAlive ? { keepAlive } : {}),
    ...(typeof c.maxBytes === "number" ? { maxBytes: c.maxBytes } : {}),
    ...(typeof c.firstOverwriteNotice === "string" ? { firstOverwriteNotice: c.firstOverwriteNotice } : {}),
    ...(typeof c.copySuffix === "string" ? { copySuffix: c.copySuffix } : {}),
    ...(typeof c.validator === "boolean" ? { validator: c.validator } : {}),
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

  // login-provider (identity plane, D16): component-only contract — the browser
  // login mechanics are a single React component core renders with a phase prop.
  // No function is carried through the manifest; only a non-empty component.
  if (slotId === "login-provider") {
    if (typeof c.component !== "string" || !c.component.trim()) {
      throw new ManifestValidationError(
        pluginId,
        `claims[${index}] slot "login-provider" requires a non-empty "component"`,
      );
    }
    return { slot: slotId, component: c.component } as PluginClaim;
  }

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
    // Wildcards: only a literal trailing `/*?` (optional rest) is accepted, so
    // one claim covers an embedded app's sub-routes. Any other `*` — inner, or
    // a trailing `/*` (mandatory rest) — is fatal. See change: add-plugin-app-host.
    const starIdx = pathVal.indexOf("*");
    if (starIdx !== -1 && !(pathVal.endsWith("/*?") && starIdx === pathVal.length - 2)) {
      throw new ManifestValidationError(
        pluginId,
        `claims[${index}] slot "shell-overlay-route" path "${pathVal}" may only use a wildcard as a literal trailing "/*?"`,
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
    // A "content" claim has no dismissal gesture: its back action and mobile
    // depth come only from the declared depth. See change: add-plugin-app-host.
    if (c.depth === undefined && c.presentation === "content") {
      throw new ManifestValidationError(
        pluginId,
        `claims[${index}] slot "shell-overlay-route" presentation "content" requires "depth" (1 or 2)`,
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
      c.presentation !== "dialog" &&
      c.presentation !== "content"
    ) {
      throw new ManifestValidationError(
        pluginId,
        `claims[${index}] slot "shell-overlay-route" presentation must be "page" or "dialog" or "content" if provided`,
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

  // editor-pane-tab: require a non-empty `component` and a well-formed,
  // non-reserved `pathPrefix`; `labelComponent` optional string. Cross-plugin
  // prefix collisions are checked at registry generation (vite plugin), the
  // `customType` precedent. See change: add-browser-editor-pane-tab (D1).
  if (slotId === "editor-pane-tab") {
    if (typeof c.component !== "string" || !c.component.trim()) {
      throw new ManifestValidationError(
        pluginId,
        `claims[${index}] slot "editor-pane-tab" requires a non-empty "component"`,
      );
    }
    if (typeof c.pathPrefix !== "string" || !c.pathPrefix) {
      throw new ManifestValidationError(
        pluginId,
        `claims[${index}] slot "editor-pane-tab" requires a "pathPrefix"`,
      );
    }
    if (!PANE_TAB_PREFIX_RE.test(c.pathPrefix)) {
      throw new ManifestValidationError(
        pluginId,
        `claims[${index}] slot "editor-pane-tab" pathPrefix "${c.pathPrefix}" must match ${PANE_TAB_PREFIX_RE}`,
      );
    }
    if (RESERVED_PANE_TAB_PREFIXES.has(c.pathPrefix)) {
      throw new ManifestValidationError(
        pluginId,
        `claims[${index}] slot "editor-pane-tab" pathPrefix "${c.pathPrefix}" is reserved for a built-in tab`,
      );
    }
    if (c.labelComponent !== undefined && (typeof c.labelComponent !== "string" || !c.labelComponent.trim())) {
      throw new ManifestValidationError(
        pluginId,
        `claims[${index}] slot "editor-pane-tab" labelComponent must be a non-empty string if provided`,
      );
    }
  }

  // editor-pane-file-handler: id/extensions/mode/label + optional bounds.
  // See change: add-editor-pane-file-handlers (D1).
  const fileHandler = slotId === "editor-pane-file-handler" ? validateFileHandlerClaim(c, pluginId, index) : undefined;

  // resource-page-section: optional `resourceType` must name a resource page.
  // See change: add-skill-atlas-screen.
  if (slotId === "resource-page-section" && c.resourceType !== undefined && !RESOURCE_PAGE_TYPES.has(c.resourceType as string)) {
    throw new ManifestValidationError(
      pluginId,
      `claims[${index}] slot "resource-page-section" resourceType must be one of ${[...RESOURCE_PAGE_TYPES].join(", ")}`,
    );
  }

  // shell-headless: always mounted, never gated. A predicate/shouldRender is
  // never invoked there, so reject it instead of silently ignoring it.
  // See change: fix-empty-status-subcard.
  if (slotId === "shell-headless") {
    for (const gate of ["predicate", "shouldRender"] as const) {
      if (c[gate] !== undefined) {
        throw new ManifestValidationError(
          pluginId,
          `claims[${index}] slot "shell-headless" must not declare "${gate}" (headless claims are always mounted)`,
        );
      }
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
    "resultPending",
  ] as const) {
    if (c[field] !== undefined && typeof c[field] !== "string") {
      throw new ManifestValidationError(
        pluginId,
        `claims[${index}].${field} must be a string if provided`,
      );
    }
  }

  // tool-renderer fields: `expandWhileRunning` is a boolean, and both fields are
  // meaningless on any other slot. See change: decouple-plugins-from-core (D5 item 7).
  if (c.expandWhileRunning !== undefined && typeof c.expandWhileRunning !== "boolean") {
    throw new ManifestValidationError(pluginId, `claims[${index}].expandWhileRunning must be a boolean if provided`);
  }
  if (slotId !== "tool-renderer") {
    for (const field of ["expandWhileRunning", "resultPending"] as const) {
      if (c[field] !== undefined) {
        throw new ManifestValidationError(
          pluginId,
          `claims[${index}] slot "${slotId}" must not declare "${field}" (tool-renderer claims only)`,
        );
      }
    }
  }

  // Lazy component module: package-relative `./…` path, no `..` segment, only
  // meaningful next to a `component`. See change: lazy-plugin-claim-modules.
  if (c.module !== undefined) {
    if (typeof c.module !== "string" || !c.module.trim()) {
      throw new ManifestValidationError(
        pluginId,
        `claims[${index}].module must be a non-empty string if provided`,
      );
    }
    if (!c.module.startsWith("./") || c.module.split(/[\\/]/).includes("..")) {
      throw new ManifestValidationError(
        pluginId,
        `claims[${index}].module "${c.module}" must be a package-relative path starting with "./" and containing no ".." segment`,
      );
    }
    if (typeof c.component !== "string" || !c.component.trim()) {
      throw new ManifestValidationError(
        pluginId,
        `claims[${index}].module requires a non-empty "component"`,
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
    ...(typeof c.module === "string" ? { module: c.module } : {}),
    ...(typeof c.command === "string" ? { command: c.command } : {}),
    ...(typeof c.trigger === "string" ? { trigger: c.trigger } : {}),
    ...(typeof c.toolName === "string" ? { toolName: c.toolName } : {}),
    ...(typeof c.customType === "string" ? { customType: c.customType } : {}),
    ...(slotId === "editor-pane-tab" && typeof c.pathPrefix === "string" ? { pathPrefix: c.pathPrefix } : {}),
    ...(slotId === "resource-page-section" && typeof c.resourceType === "string"
      ? { resourceType: c.resourceType as NonNullable<PluginClaim["resourceType"]> }
      : {}),
    ...(slotId === "editor-pane-tab" && typeof c.labelComponent === "string"
      ? { labelComponent: c.labelComponent }
      : {}),
    ...(fileHandler ?? {}),
    ...(typeof c.path === "string" ? { path: c.path } : {}),
    ...(typeof c.sessionParam === "string" ? { sessionParam: c.sessionParam } : {}),
    ...(c.depth === 1 || c.depth === 2 ? { depth: c.depth } : {}),
    ...(typeof c.parentPath === "string" ? { parentPath: c.parentPath } : {}),
    ...(c.presentation === "page" || c.presentation === "dialog" || c.presentation === "content"
      ? { presentation: c.presentation }
      : {}),
    ...(typeof c.tab === "string" ? { tab: c.tab as SettingsTab } : {}),
    ...(navHint ? { nav: navHint } : {}),
    ...(typeof c.predicate === "string" ? { predicate: c.predicate } : {}),
    ...(typeof c.shouldRender === "string" ? { shouldRender: c.shouldRender } : {}),
    ...(c.expandWhileRunning === true ? { expandWhileRunning: true } : {}),
    ...(typeof c.resultPending === "string" ? { resultPending: c.resultPending } : {}),
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
  for (const field of ["client", "clientBundle", "clientStyles", "server", "bridge", "configSchema"] as const) {
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
  const paneTabPrefixes = new Set<string>();
  const fileHandlerIds = new Set<string>();
  for (const claim of claims) {
    if (claim.slot === "editor-pane-file-handler" && claim.id) {
      if (fileHandlerIds.has(claim.id)) {
        throw new ManifestValidationError(
          pluginId,
          `duplicate editor-pane-file-handler claim for id "${claim.id}"`,
        );
      }
      fileHandlerIds.add(claim.id);
    }
    if (claim.slot === "editor-pane-tab" && claim.pathPrefix) {
      if (paneTabPrefixes.has(claim.pathPrefix)) {
        throw new ManifestValidationError(
          pluginId,
          `duplicate editor-pane-tab claim for pathPrefix "${claim.pathPrefix}"`,
        );
      }
      paneTabPrefixes.add(claim.pathPrefix);
    }
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

  // vaultBindings: optional list of env-style names. See change: add-credential-vault (D4).
  let vaultBindings: string[] | undefined;
  if (m.vaultBindings !== undefined) {
    if (
      !Array.isArray(m.vaultBindings) ||
      !m.vaultBindings.every((n) => typeof n === "string" && /^[A-Z_][A-Z0-9_]*$/.test(n))
    ) {
      throw new ManifestValidationError(pluginId, "manifest.vaultBindings must be an array of env-style names (^[A-Z_][A-Z0-9_]*$)");
    }
    vaultBindings = [...(m.vaultBindings as string[])];
  }

  const projectTypes = m.projectTypes !== undefined ? validateProjectTypes(m.projectTypes, pluginId) : undefined;

  // eventTypes: exact names or `prefix_*`. See change: decouple-plugins-from-core (D5).
  let eventTypes: string[] | undefined;
  if (m.eventTypes !== undefined) {
    if (
      !Array.isArray(m.eventTypes) ||
      !m.eventTypes.every((t) => typeof t === "string" && isValidEventTypePattern(t))
    ) {
      throw new ManifestValidationError(
        pluginId,
        'manifest.eventTypes must be an array of exact event names or "prefix_*" patterns',
      );
    }
    eventTypes = [...(m.eventTypes as string[])];
  }

  // hostApi: `^MAJOR.MINOR[.PATCH]` or exact. See change: decouple-plugins-from-core (D7).
  if (m.hostApi !== undefined && !isValidHostApiRange(m.hostApi)) {
    throw new ManifestValidationError(
      pluginId,
      'manifest.hostApi must be a caret range "^MAJOR.MINOR[.PATCH]" or an exact "MAJOR.MINOR.PATCH" version',
    );
  }

  return {
    id: pluginId,
    displayName: m.displayName,
    priority,
    claims,
    ...(typeof m.client === "string" ? { client: m.client } : {}),
    ...(typeof m.clientBundle === "string" ? { clientBundle: m.clientBundle } : {}),
    ...(typeof m.clientStyles === "string" ? { clientStyles: m.clientStyles } : {}),
    ...(typeof m.server === "string" ? { server: m.server } : {}),
    ...(typeof m.bridge === "string" ? { bridge: m.bridge } : {}),
    ...(typeof m.configSchema === "string" ? { configSchema: m.configSchema } : {}),
    ...(m.defaultEnabled === true || m.defaultEnabled === false ? { defaultEnabled: m.defaultEnabled } : {}),
    ...(typeof m.i18nCatalog === "string" ? { i18nCatalog: m.i18nCatalog } : {}),
    ...(m.fixture === true ? { fixture: true } : {}),
    ...(requires ? { requires } : {}),
    ...(dependsOn ? { dependsOn } : {}),
    ...(vaultBindings ? { vaultBindings } : {}),

    ...(projectTypes ? { projectTypes } : {}),
    ...(eventTypes ? { eventTypes } : {}),
    ...(typeof m.hostApi === "string" ? { hostApi: m.hostApi } : {}),
  };
}
