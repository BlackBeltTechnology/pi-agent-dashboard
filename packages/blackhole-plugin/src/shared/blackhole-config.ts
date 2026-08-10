/**
 * Re-declared `BlackholeConfig` / `ModelRef` shapes, per-field descriptors,
 * DEFAULTS, and the server-side validator — the security boundary for the PUT
 * route.
 *
 * The plugin does NOT depend on the external `pi-blackhole` package (design
 * D1, mirrors `hermes-memory-plugin` and `goal-plugin`). This module re-declares
 * the managed field set, their types/enums/bounds, and the DEFAULTS map. The
 * drift risk is accepted + documented; a snapshot test (see
 * `__tests__/blackhole-config.test.ts`) turns a pin bump into a forced review.
 *
 * SOURCE-VERSION PIN: pi-blackhole@0.4.5 — mirrored from
 * `src/core/unified-config.ts` (`UnifiedConfig`, `OmModelConfig`, `DEFAULTS`,
 * `positiveInt` / `nonNegativeInt` / `dropperPressureThreshold` coercers).
 * Re-check this field set, DEFAULTS and the bounds on every blackhole upgrade.
 *
 * See change: add-blackhole-plugin.
 */

/** Re-declared blackhole `OmModelConfig` (one entry of a fallback chain). */
export interface ModelRef {
  provider: string;
  id: string;
  thinking?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  /** Hours a model is skipped after a retryable error. `0` = disabled. */
  cooldownHours?: number;
  /** Context-window override. Absent = inherit from pi's model registry. */
  contextWindow?: number;
}

/** Re-declared blackhole `UnifiedConfig`, restricted to the MANAGED keys. */
export interface BlackholeConfig {
  compaction: "auto" | "manual" | "off";
  compactionEngine: "blackhole" | "pi-default";
  tailBehavior: "pi-default" | "minimal";
  midRunCompaction: "resume" | "pause" | "off";
  memory: boolean;
  sessionFallback: boolean;
  debug: boolean;
  debugLog: boolean;
  observeAfterTokens: number;
  reflectAfterTokens: number;
  compactAfterTokens: number;
  observationsPoolMaxTokens: number;
  observationsPoolTargetTokens: number;
  observerChunkMaxTokens: number;
  observerPreambleMaxTokens: number;
  reflectorInputMaxTokens: number;
  dropperInputMaxTokens: number;
  dropperPressureThreshold: number;
  agentMaxTurns: number;
  providerIdleTimeoutMs?: number;
  model?: ModelRef;
  observerModel?: ModelRef;
  reflectorModel?: ModelRef;
  dropperModel?: ModelRef;
  observerFallbackModels?: ModelRef[];
  reflectorFallbackModels?: ModelRef[];
  dropperFallbackModels?: ModelRef[];
}

/** Per-field descriptor driving validation + form-control derivation. */
export type FieldDescriptor =
  | { kind: "boolean" }
  | { kind: "enum"; values: readonly string[] }
  /** Integer with an INCLUSIVE lower bound (blackhole's positiveInt = min 1). */
  | { kind: "integer"; min: number }
  /** Finite number in the half-open interval `(0, 1]`. */
  | { kind: "fraction" }
  | { kind: "model" }
  | { kind: "modelArray" };

/** blackhole `positiveInt`: integer strictly greater than 0. */
const POSITIVE_INT: FieldDescriptor = { kind: "integer", min: 1 };
/** blackhole `nonNegativeInt`: integer greater than or equal to 0. */
const NON_NEGATIVE_INT: FieldDescriptor = { kind: "integer", min: 0 };

export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;

/**
 * The complete allowlist of MANAGED keys. Key presence here is the unknown-key
 * gate: a request key absent from this map is rejected. Keys blackhole owns but
 * this surface deliberately leaves alone (`skipForProviders`, `fullFoldAlways`,
 * `dropperPoolFullnessThreshold`, the deprecated `noAutoCompact` / `passive` /
 * `overrideDefaultCompaction`) are intentionally absent and are preserved
 * untouched by the read-modify-write in `server/config-io.ts`.
 */
export const FIELD_DESCRIPTORS: Record<keyof BlackholeConfig, FieldDescriptor> = {
  compaction: { kind: "enum", values: ["auto", "manual", "off"] },
  compactionEngine: { kind: "enum", values: ["blackhole", "pi-default"] },
  tailBehavior: { kind: "enum", values: ["pi-default", "minimal"] },
  midRunCompaction: { kind: "enum", values: ["resume", "pause", "off"] },
  memory: { kind: "boolean" },
  sessionFallback: { kind: "boolean" },
  debug: { kind: "boolean" },
  debugLog: { kind: "boolean" },
  observeAfterTokens: POSITIVE_INT,
  reflectAfterTokens: POSITIVE_INT,
  compactAfterTokens: POSITIVE_INT,
  observationsPoolMaxTokens: POSITIVE_INT,
  observationsPoolTargetTokens: POSITIVE_INT,
  observerChunkMaxTokens: POSITIVE_INT,
  observerPreambleMaxTokens: NON_NEGATIVE_INT,
  reflectorInputMaxTokens: POSITIVE_INT,
  dropperInputMaxTokens: POSITIVE_INT,
  dropperPressureThreshold: { kind: "fraction" },
  agentMaxTurns: POSITIVE_INT,
  providerIdleTimeoutMs: NON_NEGATIVE_INT,
  model: { kind: "model" },
  observerModel: { kind: "model" },
  reflectorModel: { kind: "model" },
  dropperModel: { kind: "model" },
  observerFallbackModels: { kind: "modelArray" },
  reflectorFallbackModels: { kind: "modelArray" },
  dropperFallbackModels: { kind: "modelArray" },
};

/** Allowlisted key set (validation gate + GET field enumeration). */
export const KNOWN_KEYS: readonly (keyof BlackholeConfig)[] = Object.keys(
  FIELD_DESCRIPTORS,
) as (keyof BlackholeConfig)[];

/**
 * Built-in defaults — mirror of blackhole's `DEFAULTS`. Keys blackhole leaves
 * unset (every model / fallback chain, `providerIdleTimeoutMs`) are absent here
 * and read back as `undefined`, meaning "inherit blackhole's own behaviour".
 */
export const DEFAULTS: Partial<BlackholeConfig> = {
  compaction: "auto",
  compactionEngine: "blackhole",
  tailBehavior: "minimal",
  midRunCompaction: "off",
  memory: true,
  sessionFallback: true,
  debug: false,
  debugLog: false,
  observeAfterTokens: 15_000,
  reflectAfterTokens: 25_000,
  compactAfterTokens: 81_000,
  observationsPoolMaxTokens: 20_000,
  observationsPoolTargetTokens: 10_000,
  observerChunkMaxTokens: 40_000,
  observerPreambleMaxTokens: 0,
  reflectorInputMaxTokens: 80_000,
  dropperInputMaxTokens: 80_000,
  dropperPressureThreshold: 0.7,
  agentMaxTurns: 16,
};

/** The per-worker chains this surface edits, in render order. */
export const WORKER_CHAINS = [
  { worker: "observer", primaryKey: "observerModel", fallbackKey: "observerFallbackModels" },
  { worker: "reflector", primaryKey: "reflectorModel", fallbackKey: "reflectorFallbackModels" },
  { worker: "dropper", primaryKey: "dropperModel", fallbackKey: "dropperFallbackModels" },
] as const;

export interface ValidationError {
  field: string;
  message: string;
}

const err = (field: string, message: string): ValidationError => ({ field, message });

/** Annotation keys (`_comment`, `_notes`, …) are carried through untouched. */
function isAnnotationKey(key: string): boolean {
  return key.startsWith("_");
}

function validateInteger(key: string, value: unknown, min: number): ValidationError | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return err(key, `${key} must be a finite number`);
  }
  if (!Number.isInteger(value)) return err(key, `${key} must be an integer`);
  if (value < min) return err(key, `${key} must be >= ${min}`);
  return null;
}

/** blackhole accepts `(0, 1]` — open at 0, closed at 1. */
function validateFraction(key: string, value: unknown): ValidationError | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return err(key, `${key} must be a finite number`);
  }
  if (value <= 0 || value > 1) return err(key, `${key} must be within (0, 1]`);
  return null;
}

const MODEL_FIELDS = new Set(["provider", "id", "thinking", "cooldownHours", "contextWindow"]);

/**
 * `null` explicitly UNSETS a model / chain key (the user cleared the base model,
 * or emptied a chain). `undefined` cannot express this — `JSON.stringify` drops
 * it, so the key would silently stay on disk. Scalars have no such spelling:
 * no scalar descriptor accepts `null`.
 */
function isExplicitUnset(value: unknown): boolean {
  return value === null;
}

/** Reject any key inside a model object that is neither a field nor an annotation. */
function unknownModelKey(key: string, m: Record<string, unknown>): ValidationError | null {
  const extra = Object.keys(m).find((k) => !MODEL_FIELDS.has(k) && !isAnnotationKey(k));
  return extra === undefined ? null : err(key, `${key} has unknown key: ${extra}`);
}

/** `provider` and `id` are the only required model fields (blackhole drops a model without them). */
function requiredModelStrings(key: string, m: Record<string, unknown>): ValidationError | null {
  for (const field of ["provider", "id"] as const) {
    const v = m[field];
    if (typeof v !== "string" || v.length === 0) {
      return err(key, `${key}.${field} must be a non-empty string`);
    }
  }
  return null;
}

function optionalModelFields(key: string, m: Record<string, unknown>): ValidationError | null {
  if (
    m.thinking !== undefined &&
    !(THINKING_LEVELS as readonly string[]).includes(m.thinking as string)
  ) {
    return err(key, `${key}.thinking must be one of: ${THINKING_LEVELS.join(", ")}`);
  }
  if (m.cooldownHours !== undefined) {
    // 0 is legal here and means "disabled" — blackhole's nonNegativeInt.
    const e = validateInteger(`${key}.cooldownHours`, m.cooldownHours, 0);
    if (e) return e;
  }
  if (m.contextWindow !== undefined) {
    const e = validateInteger(`${key}.contextWindow`, m.contextWindow, 1);
    if (e) return e;
  }
  return null;
}

function validateModel(key: string, value: unknown): ValidationError | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return err(key, `${key} must be an object`);
  }
  const m = value as Record<string, unknown>;
  return unknownModelKey(key, m) ?? requiredModelStrings(key, m) ?? optionalModelFields(key, m);
}

function validateModelArray(key: string, value: unknown): ValidationError | null {
  if (!Array.isArray(value)) return err(key, `${key} must be an array`);
  for (let i = 0; i < value.length; i++) {
    const e = validateModel(`${key}[${i}]`, value[i]);
    if (e) return e;
  }
  return null;
}

/** Validate one present field against its descriptor. Returns an error or null. */
function validateField(key: string, value: unknown, desc: FieldDescriptor): ValidationError | null {
  switch (desc.kind) {
    case "boolean":
      return typeof value === "boolean" ? null : err(key, `${key} must be a boolean`);
    case "enum":
      return typeof value === "string" && desc.values.includes(value)
        ? null
        : err(key, `${key} must be one of: ${desc.values.join(", ")}`);
    case "integer":
      return validateInteger(key, value, desc.min);
    case "fraction":
      return validateFraction(key, value);
    case "model":
      return isExplicitUnset(value) ? null : validateModel(key, value);
    case "modelArray":
      return isExplicitUnset(value) ? null : validateModelArray(key, value);
  }
}

/**
 * Validate a submitted config object. Rejects non-objects, unknown keys, and any
 * present field violating its descriptor. Rejection is ATOMIC — the caller
 * writes nothing unless `ok` is true, so one bad key blocks the whole request.
 *
 * This is the security boundary: the client form is a convenience, never the
 * gate. A raw `PUT` bypassing the UI hits exactly this function.
 */
export function validateBlackholeConfig(body: unknown): { ok: boolean; errors: ValidationError[] } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, errors: [{ field: "", message: "config body must be a JSON object" }] };
  }
  const errors: ValidationError[] = [];
  const known = new Set<string>(KNOWN_KEYS as string[]);
  for (const [key, value] of Object.entries(body)) {
    if (!known.has(key)) {
      errors.push(err(key, `unknown key: ${key}`));
      continue;
    }
    if (value === undefined) continue;
    const e = validateField(key, value, FIELD_DESCRIPTORS[key as keyof BlackholeConfig]);
    if (e) errors.push(e);
  }
  return { ok: errors.length === 0, errors };
}
