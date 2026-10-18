/**
 * Typed key schema of pi's global `settings.json` (pi `docs/settings.md`).
 *
 * ONE list drives the server patch validation and the client form: each entry
 * carries the key, value kind, allowed options / range, pi's documented
 * default, category, label and hint. Defaults and labels are display data only
 * — the server never writes a default.
 *
 * Excludes `PI_MANAGED_SETTINGS_KEYS` (owned by the Default model control) and
 * every key that has its own editor or is JSON-only (see the spec's "Form rows
 * for every typed key"). Mirrors pi's docs at one point in time; the raw editor
 * deliberately does NOT use it (see design D2).
 *
 * See change: pi-settings-full-coverage (design D1).
 */

export type PiSettingKind = "bool" | "enum" | "mixed" | "int" | "string" | "stringArray";

export type PiSettingCategory =
  | "model"
  | "interaction"
  | "tools"
  | "sessions"
  | "terminal"
  | "network"
  | "shell"
  | "resources"
  | "updates";

/** Rendering/documentation order of the categories. */
export const PI_SETTING_CATEGORIES: readonly { id: PiSettingCategory; label: string }[] = [
  { id: "model", label: "Model and thinking" },
  { id: "interaction", label: "Interaction" },
  { id: "tools", label: "Tools" },
  { id: "sessions", label: "Sessions and context" },
  { id: "terminal", label: "Terminal and display" },
  { id: "network", label: "Network" },
  { id: "shell", label: "Shell" },
  { id: "resources", label: "Resources" },
  { id: "updates", label: "Updates and privacy" },
];

export interface PiSettingDef {
  /** Dotted pi key, e.g. `compaction.reserveTokens`. */
  key: string;
  kind: PiSettingKind;
  /** `enum` / `mixed` string options (a `mixed` value may also be `true` / `false`, see `mixedBool`). */
  options?: readonly string[];
  /** `mixed`: `true`/`false` are valid values besides `options`. */
  mixedBool?: boolean;
  /** `mixed` (terminal.images only): `false` is valid, `true` is not. */
  mixedFalseOnly?: boolean;
  min?: number;
  max?: number;
  /** `string`: an empty string is rejected (only `theme`). */
  nonEmpty?: boolean;
  /** pi's documented default; `null` when it is not a literal (shown as `defText`). */
  def: boolean | number | string | null;
  /** Display text for a non-literal default. */
  defText?: string;
  category: PiSettingCategory;
  label: string;
  hint: string;
}

const MODES = ["all", "one-at-a-time"] as const;

const bool = (key: string, def: boolean, category: PiSettingCategory, label: string, hint: string): PiSettingDef => ({
  key,
  kind: "bool",
  def,
  category,
  label,
  hint,
});
const intKey = (
  key: string,
  def: number | null,
  category: PiSettingCategory,
  label: string,
  hint: string,
  extra: Pick<PiSettingDef, "min" | "max" | "defText"> = { min: 0 },
): PiSettingDef => ({ key, kind: "int", def, category, label, hint, ...extra });
const str = (
  key: string,
  def: string | null,
  category: PiSettingCategory,
  label: string,
  hint: string,
  defText?: string,
): PiSettingDef => ({ key, kind: "string", def, category, label, hint, ...(defText ? { defText } : {}) });
const enumKey = (
  key: string,
  options: readonly string[],
  def: string,
  category: PiSettingCategory,
  label: string,
  hint: string,
): PiSettingDef => ({ key, kind: "enum", options, def, category, label, hint });

/** Every typed key. Order = render order inside a category. */
export const PI_SETTINGS_SCHEMA: readonly PiSettingDef[] = [
  // Model and thinking
  bool("hideThinkingBlock", false, "model", "Hide thinking blocks", "Hide thinking blocks in pi's transcript"),
  bool("showCacheMissNotices", false, "model", "Cache notices", "Notices for cache misses, cache warming, compaction usage and provider recovery"),
  enumKey("cacheWarming", ["off", "streaming", "idle"], "streaming", "model", "Cache warming", "Keep provider prompt caches warm during runs, or between runs with idle"),
  intKey("thinkingBudgets.minimal", null, "model", "Thinking budget: minimal", "Token budget for the minimal thinking level", { min: 0, defText: "built-in" }),
  intKey("thinkingBudgets.low", null, "model", "Thinking budget: low", "Token budget for the low thinking level", { min: 0, defText: "built-in" }),
  intKey("thinkingBudgets.medium", null, "model", "Thinking budget: medium", "Token budget for the medium thinking level", { min: 0, defText: "built-in" }),
  intKey("thinkingBudgets.high", null, "model", "Thinking budget: high", "Token budget for the high thinking level", { min: 0, defText: "built-in" }),
  {
    key: "enabledModels",
    kind: "stringArray",
    def: null,
    defText: "all models",
    category: "model",
    label: "Model cycling scope",
    hint: "Models pi cycles through (Ctrl+P) and the dashboard model picker lists",
  },

  // Interaction
  enumKey("steeringMode", MODES, "one-at-a-time", "interaction", "Steering mode", "How queued steering messages are delivered"),
  enumKey("followUpMode", MODES, "one-at-a-time", "interaction", "Follow-up mode", "How queued follow-up messages are delivered"),
  str("externalEditor", null, "interaction", "External editor", "Command opened by the external-editor keybinding", "$VISUAL, $EDITOR, then platform default"),
  enumKey("doubleEscapeAction", ["tree", "fork", "none"], "tree", "interaction", "Double Escape action", "Action for double Escape with an empty editor"),
  enumKey("treeFilterMode", ["default", "no-tools", "user-only", "labeled-only", "all"], "default", "interaction", "Tree filter", "Initial filter used by /tree"),
  enumKey("defaultProjectTrust", ["ask", "always", "never"], "ask", "interaction", "Default project trust", "Fallback project-trust behavior"),

  // Tools
  enumKey("codemode.mode", ["on", "only"], "on", "tools", "Codemode mode", "How the codemode tool presents tools while it is active"),
  intKey("codemode.inlineBudget", 3000, "tools", "Codemode inline budget", "Estimated tokens the codemode tool description may spend on tool declarations"),

  // Sessions and context
  str("sessionDir", null, "sessions", "Session directory", "Session storage directory", "agent session directory"),
  bool("compaction.enabled", true, "sessions", "Auto-compaction", "Compact long conversations automatically"),
  intKey("compaction.reserveTokens", 16384, "sessions", "Compaction reserve tokens", "Tokens reserved for the model response"),
  intKey("compaction.keepRecentTokens", 20000, "sessions", "Compaction keep-recent tokens", "Recent tokens retained without summarization"),
  intKey("branchSummary.reserveTokens", 16384, "sessions", "Branch summary reserve tokens", "Tokens reserved when summarizing branch history"),
  bool("branchSummary.skipPrompt", false, "sessions", "Skip branch summary prompt", "Skip the branch-summary prompt and default to no summary"),

  // Terminal and display
  {
    ...str("theme", "system", "terminal", "Terminal theme", "Built-in or custom pi theme name; system derives colors from the terminal"),
    nonEmpty: true,
  },
  {
    key: "quietStartup",
    kind: "mixed",
    options: ["header"],
    mixedBool: true,
    def: false,
    category: "terminal",
    label: "Quiet startup",
    hint: "true hides the startup header and resource listing; header keeps the header only",
  },
  intKey("editorPaddingX", 0, "terminal", "Editor padding", "Horizontal editor padding in cells", { min: 0, max: 3 }),
  intKey("autocompleteMaxVisible", 5, "terminal", "Autocomplete entries", "Visible autocomplete entries", { min: 3, max: 20 }),
  bool("showHardwareCursor", false, "terminal", "Hardware cursor", "Show the terminal cursor while pi positions it for input methods"),
  bool("terminal.showImages", true, "terminal", "Inline images", "Display inline images when supported"),
  intKey("terminal.imageWidthCells", 60, "terminal", "Image width", "Preferred inline image width in terminal cells", { min: 1 }),
  bool("terminal.clearOnShrink", false, "terminal", "Clear on shrink", "Clear empty rows when rendered content shrinks"),
  bool("terminal.showTerminalProgress", false, "terminal", "Terminal progress", "Show OSC 9;4 progress in the terminal tab"),
  {
    key: "terminal.hyperlinks",
    kind: "mixed",
    mixedBool: true,
    options: ["auto"],
    def: "auto",
    category: "terminal",
    label: "Hyperlinks",
    hint: "Override OSC 8 hyperlink detection",
  },
  {
    key: "terminal.images",
    kind: "mixed",
    options: ["kitty", "iterm2", "auto"],
    mixedFalseOnly: true,
    def: "auto",
    category: "terminal",
    label: "Image protocol",
    hint: "Override inline-image protocol detection",
  },
  {
    key: "terminal.trueColor",
    kind: "mixed",
    mixedBool: true,
    options: ["auto"],
    def: "auto",
    category: "terminal",
    label: "True color",
    hint: "Override true-color detection",
  },
  bool("images.autoResize", true, "terminal", "Resize images", "Resize images to at most 2000 by 2000 pixels before sending them to a model"),
  bool("images.blockImages", false, "terminal", "Block images", "Prevent images from being sent to models"),
  str("markdown.codeBlockIndent", "  ", "terminal", "Code block indent", "Prefix used to indent rendered code blocks"),
  enumKey("markdown.mermaid", ["off", "final", "streaming"], "streaming", "terminal", "Mermaid rendering", "Mermaid rendering mode"),

  // Network
  enumKey("transport", ["auto", "sse", "websocket", "websocket-cached"], "auto", "network", "Transport", "Preferred transport for providers that support several"),
  str("httpProxy", null, "network", "HTTP proxy", "Proxy URL applied as HTTP_PROXY and HTTPS_PROXY for pi's HTTP clients", "none"),
  intKey("httpIdleTimeoutMs", 300000, "network", "HTTP idle timeout (ms)", "HTTP header and body idle timeout; 0 disables"),
  intKey("websocketConnectTimeoutMs", 15000, "network", "WebSocket connect timeout (ms)", "WebSocket connection timeout; 0 disables"),

  // Shell
  str("shellPath", null, "shell", "Shell path", "Custom shell executable path", "platform default"),
  str("shellCommandPrefix", null, "shell", "Shell command prefix", "Prefix prepended to every shell command", "none"),

  // Resources
  bool("enableSkillCommands", true, "resources", "Skill commands", "Register skills as /skill:name commands"),

  // Updates and privacy
  bool("collapseChangelog", false, "updates", "Condensed changelog", "Show a condensed changelog after an update"),
  bool("enableInstallTelemetry", true, "updates", "Install telemetry", "Anonymous install/update reporting and selected provider attribution headers"),
  bool("enableAnalytics", false, "updates", "Analytics", "Opt in to analytics data sharing"),
  bool("warnings.anthropicExtraUsage", true, "updates", "Anthropic extra-usage warning", "Warn when Anthropic subscription authentication may use paid extra usage"),
];

/** Blocks addressed by dotted leaf keys; a patch never sets a whole block. */
export const PI_SETTINGS_BLOCKS: readonly string[] = [
  "compaction",
  "branchSummary",
  "codemode",
  "terminal",
  "images",
  "markdown",
  "warnings",
  "thinkingBudgets",
];

const BY_KEY: ReadonlyMap<string, PiSettingDef> = new Map(PI_SETTINGS_SCHEMA.map((d) => [d.key, d]));

export const getPiSettingDef = (key: string): PiSettingDef | undefined => BY_KEY.get(key);

/** `[block, leaf]` for a dotted key, or `[key]` for a top-level one. */
export function splitPiSettingKey(key: string): [string, string] | [string] {
  const dot = key.indexOf(".");
  return dot < 0 ? [key] : [key.slice(0, dot), key.slice(dot + 1)];
}

type KindCheck = (def: PiSettingDef, v: unknown) => string | null;

const checkInt: KindCheck = (def, v) => {
  const lo = def.min ?? 0;
  const ok = typeof v === "number" && Number.isInteger(v) && v >= lo && (def.max === undefined || v <= def.max);
  if (ok) return null;
  if (def.max !== undefined) return `must be an integer from ${lo} to ${def.max}`;
  return lo > 0 ? `must be an integer of at least ${lo}` : "must be a non-negative integer";
};

const checkString: KindCheck = (def, v) => {
  if (typeof v !== "string") return "must be a string";
  return def.nonEmpty && v.length === 0 ? "must be a non-empty string" : null;
};

// `[]` is valid on the wire (pi treats an empty `enabledModels` as "all models"); only the editor
// refuses to SAVE an empty "Selected only" selection.
const checkStringArray: KindCheck = (_def, v) =>
  Array.isArray(v) && v.every((x) => typeof x === "string" && x.length > 0) ? null : "must be an array of non-empty strings";

const checkEnum: KindCheck = (def, v) =>
  typeof v === "string" && (def.options ?? []).includes(v)
    ? null
    : `must be one of ${(def.options ?? []).map((o) => `"${o}"`).join(", ")}`;

const checkMixed: KindCheck = (def, v) => {
  const accepted = (def.mixedBool && typeof v === "boolean") || (def.mixedFalseOnly && v === false);
  if (accepted || (typeof v === "string" && (def.options ?? []).includes(v))) return null;
  const literals = def.mixedBool ? ["true", "false"] : def.mixedFalseOnly ? ["false"] : [];
  return `must be ${[...literals, ...(def.options ?? []).map((o) => `"${o}"`)].join(", ")}`;
};

const KIND_CHECKS: Record<PiSettingKind, KindCheck> = {
  bool: (_def, v) => (typeof v === "boolean" ? null : "must be a boolean"),
  int: checkInt,
  string: checkString,
  stringArray: checkStringArray,
  enum: checkEnum,
  mixed: checkMixed,
};

/** Validation message for a value of `def`, or `null` when it is acceptable. */
export function checkPiSettingValue(def: PiSettingDef, v: unknown): string | null {
  return KIND_CHECKS[def.kind](def, v);
}
