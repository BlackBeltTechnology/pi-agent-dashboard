/**
 * Re-declared `MemoryConfig` shape, per-field descriptors, DEFAULTS, and the
 * server-side validator — the security boundary for the PUT route.
 *
 * The plugin does NOT depend on the external `pi-hermes-memory` package
 * (design D3, mirrors goal-plugin's treatment of pi-goal-hermes). This module
 * re-declares the field set, their types/enums/bounds, and the DEFAULTS map
 * (the values in the extension's `DEFAULT_CONFIG`). A drift risk (D-R1) is
 * accepted + documented.
 *
 * SOURCE-VERSION PIN: mirrored from `pi-hermes-memory@0.8.1`
 * `src/types.ts` (MemoryConfig) + `src/config.ts` (DEFAULT_CONFIG). Re-check
 * this field set + DEFAULTS on every hermes upgrade (risk D-R1).
 *
 * See change: add-hermes-memory-settings-plugin.
 */

/** Re-declared hermes `MemoryConfig` (mirror of the extension's types.ts). */
export interface MemoryConfig {
  memoryMode: "policy-only" | "legacy-inject";
  memoryPolicyStyle?: "full" | "compact" | "custom" | "none";
  memoryPolicyCustomText?: string;
  memoryCharLimit: number;
  userCharLimit: number;
  projectCharLimit: number;
  nudgeInterval: number;
  reviewRecentMessages?: number;
  reviewEnabled: boolean;
  reviewTransport?: "direct" | "subprocess";
  flushOnCompact: boolean;
  flushOnShutdown: boolean;
  flushMinTurns: number;
  flushRecentMessages?: number;
  memoryDir?: string;
  projectsMemoryDir?: string;
  sessionSearch?: { variant: "legacy" | "anchors" };
  llmModelOverride?: string;
  llmThinkingOverride?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  childExtensionPaths?: string[];
  memoryOverflowStrategy?: "auto-consolidate" | "reject" | "fifo-evict";
  autoConsolidate: boolean;
  correctionDetection: boolean;
  correctionStrongPatterns?: string[];
  correctionWeakPatterns?: string[];
  correctionNegativePatterns?: string[];
  correctionDirectiveWords?: string[];
  failureInjectionEnabled: boolean;
  failureInjectionMaxAgeDays: number;
  failureInjectionMaxEntries: number;
  nudgeToolCalls: number;
  consolidationTimeoutMs: number;
}

/** Per-field descriptor driving validation + form rendering. */
export type FieldDescriptor =
  | { kind: "boolean" }
  | { kind: "number"; integer: boolean; min: number }
  | { kind: "string" }
  | { kind: "enum"; values: readonly string[] }
  | { kind: "stringArray" }
  | { kind: "regexArray" }
  | { kind: "sessionSearch" };

const NON_NEG_INT: FieldDescriptor = { kind: "number", integer: true, min: 0 };

/**
 * The complete, allowlisted `MemoryConfig` field set. Key presence here is the
 * unknown-key gate: a body key absent from this map is rejected.
 */
export const FIELD_DESCRIPTORS: Record<keyof MemoryConfig, FieldDescriptor> = {
  memoryMode: { kind: "enum", values: ["policy-only", "legacy-inject"] },
  memoryPolicyStyle: { kind: "enum", values: ["full", "compact", "custom", "none"] },
  memoryPolicyCustomText: { kind: "string" },
  memoryCharLimit: NON_NEG_INT,
  userCharLimit: NON_NEG_INT,
  projectCharLimit: NON_NEG_INT,
  nudgeInterval: NON_NEG_INT,
  reviewRecentMessages: NON_NEG_INT,
  reviewEnabled: { kind: "boolean" },
  reviewTransport: { kind: "enum", values: ["direct", "subprocess"] },
  flushOnCompact: { kind: "boolean" },
  flushOnShutdown: { kind: "boolean" },
  flushMinTurns: NON_NEG_INT,
  flushRecentMessages: NON_NEG_INT,
  memoryDir: { kind: "string" },
  projectsMemoryDir: { kind: "string" },
  sessionSearch: { kind: "sessionSearch" },
  llmModelOverride: { kind: "string" },
  llmThinkingOverride: { kind: "enum", values: ["off", "minimal", "low", "medium", "high", "xhigh"] },
  childExtensionPaths: { kind: "stringArray" },
  memoryOverflowStrategy: { kind: "enum", values: ["auto-consolidate", "reject", "fifo-evict"] },
  autoConsolidate: { kind: "boolean" },
  correctionDetection: { kind: "boolean" },
  correctionStrongPatterns: { kind: "regexArray" },
  correctionWeakPatterns: { kind: "regexArray" },
  correctionNegativePatterns: { kind: "regexArray" },
  correctionDirectiveWords: { kind: "stringArray" },
  failureInjectionEnabled: { kind: "boolean" },
  failureInjectionMaxAgeDays: NON_NEG_INT,
  failureInjectionMaxEntries: NON_NEG_INT,
  nudgeToolCalls: NON_NEG_INT,
  consolidationTimeoutMs: NON_NEG_INT,
};

/** Allowlisted key set (validation gate + GET field enumeration). */
export const KNOWN_KEYS: readonly (keyof MemoryConfig)[] = Object.keys(
  FIELD_DESCRIPTORS,
) as (keyof MemoryConfig)[];

/**
 * Built-in defaults — mirror of the extension's `DEFAULT_CONFIG`. Optional
 * fields the extension leaves unset (custom text, dir overrides, model /
 * thinking overrides, correction-pattern overrides) are absent here and read
 * back as `undefined`.
 */
export const DEFAULTS: Partial<MemoryConfig> = {
  memoryMode: "policy-only",
  memoryPolicyStyle: "full",
  memoryCharLimit: 5000,
  userCharLimit: 5000,
  projectCharLimit: 5000,
  nudgeInterval: 10,
  reviewRecentMessages: 0,
  reviewEnabled: true,
  reviewTransport: "direct",
  flushOnCompact: true,
  flushOnShutdown: true,
  flushMinTurns: 6,
  flushRecentMessages: 0,
  memoryOverflowStrategy: "auto-consolidate",
  autoConsolidate: true,
  correctionDetection: true,
  failureInjectionEnabled: true,
  failureInjectionMaxAgeDays: 7,
  failureInjectionMaxEntries: 5,
  consolidationTimeoutMs: 60000,
  nudgeToolCalls: 15,
  projectsMemoryDir: "projects-memory",
  sessionSearch: { variant: "legacy" },
};

export interface ValidationError {
  field: string;
  message: string;
}

const SESSION_SEARCH_VARIANTS = ["legacy", "anchors"];

const err = (field: string, message: string): ValidationError => ({ field, message });

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

function validateNumber(key: string, value: unknown, desc: { integer: boolean; min: number }): ValidationError | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return err(key, `${key} must be a finite number`);
  if (value < desc.min) return err(key, `${key} must be >= ${desc.min}`);
  if (desc.integer && !Number.isInteger(value)) return err(key, `${key} must be an integer`);
  return null;
}

function validateRegexArray(key: string, value: unknown): ValidationError | null {
  if (!isStringArray(value)) return err(key, `${key} must be an array of regex strings`);
  for (const pattern of value) {
    try {
      new RegExp(pattern);
    } catch {
      return err(key, `${key} contains an invalid regular expression: ${pattern}`);
    }
  }
  return null;
}

function validateSessionSearch(key: string, value: unknown): ValidationError | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return err(key, `${key} must be an object`);
  const variant = (value as { variant?: unknown }).variant;
  return typeof variant === "string" && SESSION_SEARCH_VARIANTS.includes(variant)
    ? null
    : err(key, `${key}.variant must be one of: ${SESSION_SEARCH_VARIANTS.join(", ")}`);
}

/** Validate one present field against its descriptor. Returns an error or null. */
function validateField(key: string, value: unknown, desc: FieldDescriptor): ValidationError | null {
  switch (desc.kind) {
    case "boolean":
      return typeof value === "boolean" ? null : err(key, `${key} must be a boolean`);
    case "string":
      return typeof value === "string" ? null : err(key, `${key} must be a string`);
    case "number":
      return validateNumber(key, value, desc);
    case "enum":
      return typeof value === "string" && desc.values.includes(value)
        ? null
        : err(key, `${key} must be one of: ${desc.values.join(", ")}`);
    case "stringArray":
      return isStringArray(value) ? null : err(key, `${key} must be an array of strings`);
    case "regexArray":
      return validateRegexArray(key, value);
    case "sessionSearch":
      return validateSessionSearch(key, value);
  }
}

/**
 * Validate a submitted config object: reject non-objects, unknown keys, and any
 * present field whose value violates its descriptor (type / enum / numeric
 * bound / uncompilable regex). Only present keys are checked — missing keys are
 * allowed (the client sends the full resolved config, but validation never
 * forces presence). This is the security boundary: nothing reaches disk until
 * this returns `ok: true`.
 */
export function validateHermesConfig(body: unknown): { ok: boolean; errors: ValidationError[] } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, errors: [{ field: "", message: "config body must be a JSON object" }] };
  }
  const errors: ValidationError[] = [];
  const known = new Set<string>(KNOWN_KEYS as string[]);
  for (const [key, value] of Object.entries(body)) {
    if (!known.has(key)) {
      errors.push({ field: key, message: `unknown key: ${key}` });
      continue;
    }
    const err = validateField(key, value, FIELD_DESCRIPTORS[key as keyof MemoryConfig]);
    if (err) errors.push(err);
  }
  return { ok: errors.length === 0, errors };
}
