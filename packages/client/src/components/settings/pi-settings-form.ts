/**
 * Pure form logic of the pi settings page: schema rows ↔ form strings ↔ typed
 * patch, field errors, and the extra (non-editable) rows.
 *
 * Form values are strings; `""` means "unset" (the control shows pi's default
 * and the key is absent from the file). A key is patched only when its form
 * value differs from the baseline, so an unknown stored value (e.g. a newer
 * pi's enum member) round-trips untouched.
 *
 * See change: pi-settings-full-coverage (design D1, D9, D11).
 */
import {
  checkPiSettingValue,
  PI_SETTINGS_SCHEMA,
  type PiSettingCategory,
  type PiSettingDef,
  splitPiSettingKey,
} from "@blackbelt-technology/pi-dashboard-shared/pi-settings-schema.js";
import type { PiSettingsPatch } from "../../lib/api/pi-settings-api.js";

/** `""` = unset. */
export type FormState = Record<string, string>;

/** Typed rows rendered by the form. `enabledModels` has its own editor. */
const FORM_DEFS: readonly PiSettingDef[] = PI_SETTINGS_SCHEMA.filter((d) => d.key !== "enabledModels");

const SCOPE_DEF = PI_SETTINGS_SCHEMA.find((d) => d.key === "enabledModels");
export const ENABLED_MODELS_DEF: PiSettingDef = SCOPE_DEF ?? {
  key: "enabledModels",
  kind: "stringArray",
  def: null,
  category: "model",
  label: "Model cycling scope",
  hint: "",
};

export function getSettingValue(settings: Record<string, unknown>, key: string): unknown {
  const parts = splitPiSettingKey(key);
  if (parts.length === 1) return settings[parts[0]];
  const block = settings[parts[0]];
  return block && typeof block === "object" && !Array.isArray(block) ? (block as Record<string, unknown>)[parts[1]] : undefined;
}

/** Stored value → form string; anything non-primitive is shown as its JSON so it is visible, never lost. */
function toFormString(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

export function toForm(settings: Record<string, unknown>): FormState {
  const f: FormState = {};
  for (const def of FORM_DEFS) f[def.key] = toFormString(getSettingValue(settings, def.key));
  return f;
}

/** Form string → typed patch value (`null` = delete the key). */
function parseField(def: PiSettingDef, raw: string): unknown {
  if (raw === "") return null;
  switch (def.kind) {
    case "bool":
      return raw === "true";
    case "int":
      return raw.trim() === "" ? Number.NaN : Number(raw);
    case "mixed":
      if (raw === "true" && def.mixedBool) return true;
      if (raw === "false" && (def.mixedBool || def.mixedFalseOnly)) return false;
      return raw;
    default:
      return raw;
  }
}

/** Message for an invalid value of a row (`label + reason`), or null. */
function fieldError(def: PiSettingDef, raw: string, label: string): string | null {
  if (raw === "") return null;
  const msg = checkPiSettingValue(def, parseField(def, raw));
  return msg ? `${label} ${msg}` : null;
}

/** Field errors of rows the user CHANGED (a stored out-of-range value must not block unrelated saves). */
export function changedFieldErrors(
  form: FormState,
  base: FormState,
  labelOf: (def: PiSettingDef) => string,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const def of FORM_DEFS) {
    if (form[def.key] === base[def.key]) continue;
    const msg = fieldError(def, form[def.key] ?? "", labelOf(def));
    if (msg) out[def.key] = msg;
  }
  return out;
}

/** Leaf diff of the form against its baseline, as a nested patch. Callers must validate first. */
export function buildFormPatch(form: FormState, base: FormState): PiSettingsPatch {
  const patch: Record<string, unknown> = {};
  for (const def of FORM_DEFS) {
    if (form[def.key] === base[def.key]) continue;
    const value = parseField(def, form[def.key] ?? "");
    const parts = splitPiSettingKey(def.key);
    if (parts.length === 1) {
      patch[parts[0]] = value;
    } else {
      const block = (patch[parts[0]] ?? {}) as Record<string, unknown>;
      block[parts[1]] = value;
      patch[parts[0]] = block;
    }
  }
  return patch;
}

/** Display text of a def's pi default (`Default (x)`). */
export function defaultText(def: PiSettingDef): string {
  if (def.def === null) return def.defText ?? "";
  if (typeof def.def === "boolean") return def.def ? "on" : "off";
  if (typeof def.def === "number") return def.def.toLocaleString("en-US");
  return def.def === "" ? "none" : def.def.trim() === "" ? `"${def.def}"` : def.def;
}

// ── Extra rows: keys with their own editor, or JSON-only ──────────────

type ExtraRowKind = "link" | "json" | "default-model";

export interface ExtraRow {
  /** Raw key(s) shown on the row. */
  key: string;
  /** Dotted settings key probed for "is it set in the file". */
  probe: string;
  kind: ExtraRowKind;
  category: PiSettingCategory;
  label: string;
  hint: string;
  /** `link`: settings page id the link opens. */
  page?: string;
  /** `link`: link text. */
  linkLabel?: string;
}

export const EXTRA_ROWS: readonly ExtraRow[] = [
  {
    key: "defaultProvider / defaultModel / defaultThinkingLevel",
    probe: "defaultModel",
    kind: "default-model",
    category: "model",
    label: "Default model",
    hint: "Startup model and thinking level, managed by the Default model control",
    page: "sessions",
    linkLabel: "Open Default model",
  },
  { key: "modelThinkingLevels", probe: "modelThinkingLevels", kind: "json", category: "model", label: "Per-model thinking levels", hint: "Startup thinking level per provider/model" },
  { key: "defaultTools", probe: "defaultTools", kind: "json", category: "tools", label: "Default tools", hint: "Tools enabled at startup; +name and -name entries adjust the defaults" },
  { key: "compaction.modelOverrides", probe: "compaction.modelOverrides", kind: "json", category: "sessions", label: "Compaction model overrides", hint: "Per-model compaction token settings" },
  { key: "tuiMode", probe: "tuiMode", kind: "json", category: "terminal", label: "TUI mode", hint: "pi's terminal UI only; the dashboard never sets it" },
  { key: "fullscreenExitOutput", probe: "fullscreenExitOutput", kind: "json", category: "terminal", label: "Fullscreen exit output", hint: "pi's terminal UI only" },
  { key: "fullscreenScrollbar", probe: "fullscreenScrollbar", kind: "json", category: "terminal", label: "Fullscreen scrollbar", hint: "pi's terminal UI only" },
  { key: "fullscreenCopyOnSelect", probe: "fullscreenCopyOnSelect", kind: "json", category: "terminal", label: "Fullscreen copy on select", hint: "pi's terminal UI only" },
  { key: "fullscreenWheelScrollLines", probe: "fullscreenWheelScrollLines", kind: "json", category: "terminal", label: "Fullscreen wheel scroll lines", hint: "pi's terminal UI only" },
  { key: "outputPad", probe: "outputPad", kind: "json", category: "terminal", label: "Output padding", hint: "pi's terminal UI only" },
  { key: "retry.*", probe: "retry", kind: "link", category: "network", label: "Retry", hint: "Agent-level and provider retry policy", page: "sessions", linkLabel: "Open Retry editor" },
  { key: "npmCommand", probe: "npmCommand", kind: "json", category: "shell", label: "npm command", hint: "Command and arguments used for npm package lookup and installation" },
  { key: "packages", probe: "packages", kind: "link", category: "resources", label: "Packages", hint: "npm, git or local pi package sources", page: "add-ons", linkLabel: "Open Add-ons" },
  { key: "extensions", probe: "extensions", kind: "link", category: "resources", label: "Extensions", hint: "Extension files or directories", page: "extensions", linkLabel: "Open Extensions" },
  { key: "skills", probe: "skills", kind: "link", category: "resources", label: "Skills", hint: "Skill files or directories", page: "skills", linkLabel: "Open Skills" },
  { key: "prompts", probe: "prompts", kind: "json", category: "resources", label: "Prompt templates", hint: "Prompt-template files or directories" },
  { key: "themes", probe: "themes", kind: "json", category: "resources", label: "Theme paths", hint: "Theme files or directories" },
];

/** Dashboard-managed keys shown in a collapsed read-only list. */
export const DASHBOARD_MANAGED_KEYS = ["dashboardPluginBridges", "_dashboardManagedPackages", "lastChangelogVersion"] as const;
