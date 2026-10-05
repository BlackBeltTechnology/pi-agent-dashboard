/**
 * mcp-client-plugin · client schema model.
 *
 * Turns the published JSON Schema (`GET /api/mcp-client/schema`, authored at
 * `schema/mcp-config.schema.json`) into the editor's field list: widget
 * selection, transport tagging, secret markers — plus the pure helpers the
 * editor and its tests share (clone/equality, redaction sentinels, the
 * whole-entry save builder, save validation).
 *
 * `widgetFor` always ends in a concrete widget or the JSON fallback, so no
 * schema field can ever be silently dropped (spec: any field without a widget
 * falls back to a validated JSON editor). The exposure `codemode-deferred`
 * alias resolves for DISPLAY only — an unchanged draft keeps the stored value.
 *
 * See change: migrate-mcp-to-pi-builtin.
 */
import { displayExposure, MCP_EXPOSURE_ALIASES } from "../core/pi-rules.js";

export type Transport = "command" | "url";

export interface JsonSchema {
  type?: string;
  enum?: (string | number)[];
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  additionalProperties?: JsonSchema | boolean;
  oneOf?: JsonSchema[];
  $ref?: string;
  "x-transport"?: string;
  "x-secret"?: boolean;
  "x-global-only"?: boolean;
  [key: string]: unknown;
}

export type WidgetKind =
  | "text"
  | "number"
  | "boolean"
  | "enum"
  | "string-list"
  | "nested-group"
  | "record"
  | "json";

export interface FieldSchema {
  /** Dotted path (`oauth.clientSecret`) — also the testid suffix. */
  name: string;
  path: string[];
  schema: JsonSchema;
  widget: WidgetKind;
  transport: Transport | null;
  secret: boolean;
  /** `x-global-only`: pi reads the field only from the global file. */
  globalOnly: boolean;
  enumValues?: string[];
  /** For a record of enums (`toolExposure`): the canonical value options. */
  valueEnum?: string[];
  /**
   * Display resolver for stored aliases (`codemode-deferred` → `codemode`):
   * the control shows the resolved value but keeps the stored one unchanged.
   */
  displayResolver?: (value: unknown) => string;
  /** Sub-widgets of a nested group. */
  children?: FieldSchema[];
}

// ─── schema traversal ────────────────────────────────────────────────────────

export function defsOf(doc: Record<string, unknown>): Record<string, JsonSchema> {
  const defs = doc.$defs;
  return defs !== null && typeof defs === "object"
    ? (defs as Record<string, JsonSchema>)
    : {};
}

/** Canonical enum options: the stored alias (`codemode-deferred`) is display-only. */
function canonicalEnumValues(values: (string | number)[]): string[] {
  return values
    .filter((v): v is string => typeof v === "string")
    .filter((v) => !(v in MCP_EXPOSURE_ALIASES));
}

/** Resolve a `$ref: "#/$defs/X"` node, keeping the referencing node's markers. */
function resolveRef(schema: JsonSchema, defs: Record<string, JsonSchema>): JsonSchema {
  if (typeof schema.$ref !== "string") return schema;
  const target = defs[schema.$ref.split("/").pop() ?? ""];
  if (!target) return schema;
  const merged: Record<string, unknown> = { ...target };
  for (const key of ["x-transport", "x-secret", "x-global-only"] as const) {
    if (schema[key] !== undefined) merged[key] = schema[key];
  }
  return merged as JsonSchema;
}

function isObjectSchema(s: JsonSchema): boolean {
  return s.type === "object" && s.properties !== undefined && Object.keys(s.properties).length > 0;
}

/** The non-union widget for a concrete `type`; unknown shapes → "json". */
function simpleWidget(s: JsonSchema): WidgetKind {
  switch (s.type) {
    case "string":
      return "text";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "array":
      return s.items?.type === "string" ? "string-list" : "json";
    case "object":
      return isObjectSchema(s) ? "nested-group" : "record";
    default:
      return "json";
  }
}

/** The widget a field renders as. NEVER null/undefined — unknown shapes → "json". */
export function widgetFor(schema: JsonSchema, defs: Record<string, JsonSchema> = {}): WidgetKind {
  const s = resolveRef(schema, defs);
  if (Array.isArray(s.enum)) return "enum";
  if (Array.isArray(s.oneOf)) return "json";
  return simpleWidget(s);
}

function enumExtras(resolved: JsonSchema): Pick<FieldSchema, "enumValues" | "displayResolver"> {
  if (!Array.isArray(resolved.enum)) return {};
  const extras: Pick<FieldSchema, "enumValues" | "displayResolver"> = {
    enumValues: canonicalEnumValues(resolved.enum),
  };
  if (resolved.enum.some((v) => typeof v === "string" && v in MCP_EXPOSURE_ALIASES)) {
    extras.displayResolver = displayExposure;
  }
  return extras;
}

function fieldFor(
  name: string,
  prop: JsonSchema,
  defs: Record<string, JsonSchema>,
  parents: string[],
): FieldSchema {
  const resolved = resolveRef(prop, defs);
  const field: FieldSchema = {
    name: [...parents, name].join("."),
    path: [...parents, name],
    schema: resolved,
    widget: widgetFor(prop, defs),
    transport:
      resolved["x-transport"] === "command" || resolved["x-transport"] === "url"
        ? resolved["x-transport"]
        : null,
    secret: resolved["x-secret"] === true,
    globalOnly: resolved["x-global-only"] === true,
  };
  Object.assign(field, enumExtras(resolved));
  // A record of enum values (`toolExposure`): rows render a select.
  const additional = resolved.additionalProperties;
  if (field.widget === "record" && additional && typeof additional === "object") {
    const valueSchema = resolveRef(additional, defs);
    if (Array.isArray(valueSchema.enum)) {
      field.valueEnum = canonicalEnumValues(valueSchema.enum);
      if (valueSchema.enum.some((v) => typeof v === "string" && v in MCP_EXPOSURE_ALIASES)) {
        field.displayResolver = displayExposure;
      }
    }
  }
  if (field.widget === "nested-group") {
    field.children = Object.entries(resolved.properties ?? {}).map(([child, childProp]) =>
      fieldFor(child, childProp, defs, [...parents, name]),
    );
  }
  return field;
}

/** The editor's field list, in schema order, from `$defs.ServerEntry`. */
export function fieldsOf(doc: Record<string, unknown>): FieldSchema[] {
  const defs = defsOf(doc);
  const props = defs.ServerEntry?.properties ?? {};
  return Object.entries(props).map(([name, prop]) => fieldFor(name, prop, defs, []));
}

// ─── transport grouping ──────────────────────────────────────────────────────

/**
 * Fields scoped to one transport. `x-transport` tags the two primary fields;
 * the companions are the spec's tab groups (the url tab hides command/args/env,
 * shows url/headers/auth/oauth). Saving drops the INACTIVE transport's keys,
 * so the stored entry always carries one transport.
 */
export const TRANSPORT_FIELDS: Record<Transport, readonly string[]> = {
  command: ["command", "args", "env", "cwd"],
  url: ["url", "headers", "auth", "oauth"],
};

export function visibleUnderTransport(name: string, tab: Transport): boolean {
  for (const transport of Object.keys(TRANSPORT_FIELDS) as Transport[]) {
    if (transport !== tab && TRANSPORT_FIELDS[transport].includes(name)) return false;
  }
  return true;
}

// ─── secret masking ──────────────────────────────────────────────────────────

/** Credential-name pattern — the EXACT regex the server's redaction uses. */
const SECRET_KEY_PATTERN = /authorization|token|key|secret/i;

/** True when an `env`/`headers` key NAME looks like a credential. */
export function isSecretKeyName(name: string): boolean {
  return SECRET_KEY_PATTERN.test(name);
}

/**
 * A `${NAME}` reference or a leading `!` (a command) is shown AS WRITTEN —
 * it is not itself a secret (spec: values that reference a secret are not
 * masked).
 */
export function isLiteralValue(value: unknown): boolean {
  return typeof value === "string" && (value.startsWith("!") || /\$\{[^}]+\}/.test(value));
}

/** Whether a record value renders masked: secret field / credential key, and not a literal. */
export function isMaskedValue(fieldSecret: boolean, key: string, value: unknown): boolean {
  if (isLiteralValue(value)) return false;
  return fieldSecret || isSecretKeyName(key);
}

// ─── redaction sentinels ─────────────────────────────────────────────────────

/** `{ redacted: true }` (scalar) or `{ redacted: true, keys: [...] }` (record). */
export function isRedacted(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (value as { redacted?: unknown }).redacted === true
  );
}

/**
 * Recursively remove redaction sentinels — a marker the server sent in a
 * project view must never be sent back (an override is a WHOLE entry).
 */
export function stripRedacted<T>(value: T): T | undefined {
  if (isRedacted(value)) return undefined;
  if (Array.isArray(value)) return value.map((entry) => stripRedacted(entry)) as unknown as T;
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      const stripped = stripRedacted(entry);
      if (stripped !== undefined) out[key] = stripped;
    }
    return out as T;
  }
  return value;
}

// ─── draft model ─────────────────────────────────────────────────────────────

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value ?? null)) as T;
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((k) =>
    deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}

/**
 * The WHOLE entry a save writes: every draft key (unknown ones included —
 * pi preserves them), redaction sentinels stripped, the INACTIVE transport's
 * keys dropped, `auth` dropped at project scope (pi reads it only from the
 * global file).
 */
export function buildEntry(
  draft: Record<string, unknown>,
  tab: Transport,
  scope: { kind: "global" } | { kind: "project"; cwd: string },
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(draft)) {
    const cleaned = stripRedacted(value);
    if (cleaned === undefined) continue;
    out[key] = cleaned;
  }
  const inactive: Transport = tab === "url" ? "command" : "url";
  for (const field of TRANSPORT_FIELDS[inactive]) delete out[field];
  if (scope.kind === "project") delete out.auth;
  return out;
}

export function getPath(obj: unknown, path: string[]): unknown {
  let current: unknown = obj;
  for (const key of path) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/** Immutably write (or, when `value === undefined`, delete) `path` in a clone. */
export function setPath<T extends Record<string, unknown>>(obj: T, path: string[], value: unknown): T {
  const root = clone(obj);
  if (path.length === 0) return root;
  let current: Record<string, unknown> = root;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i] as string;
    const next = current[key];
    if (next === null || typeof next !== "object" || Array.isArray(next)) current[key] = {};
    current = current[key] as Record<string, unknown>;
  }
  const last = path[path.length - 1] as string;
  if (value === undefined) delete current[last];
  else current[last] = value;
  return root;
}

// ─── save validation ─────────────────────────────────────────────────────────

/** Raw (unparsed) textarea/number text keyed by dotted field name. */
export type RawText = Record<string, string>;

interface ValidationCtx {
  draft: Record<string, unknown>;
  raw: RawText;
  errors: Record<string, string>;
}

type Validator = (field: FieldSchema, value: unknown, ctx: ValidationCtx) => void;

function validateNumber(field: FieldSchema, value: unknown, ctx: ValidationCtx): void {
  const rawText = ctx.raw[field.name];
  if (rawText !== undefined && rawText.trim() !== "" && !Number.isFinite(Number(rawText))) {
    ctx.errors[field.name] = "Must be a number";
  } else if (value !== undefined && typeof value !== "number") {
    ctx.errors[field.name] = "Must be a number";
  }
}

function validateEnum(field: FieldSchema, value: unknown, ctx: ValidationCtx): void {
  if (value === undefined) return;
  // A stored alias (`codemode-deferred`) validates against its display form.
  const check = field.displayResolver ? field.displayResolver(value) : value;
  if (!(field.enumValues ?? []).includes(check as string)) {
    ctx.errors[field.name] = "Not a valid option";
  }
}

function validateList(field: FieldSchema, value: unknown, ctx: ValidationCtx): void {
  const rows = Array.isArray(value) ? value : [];
  if (rows.some((row) => typeof row !== "string" || row.trim() === "")) {
    ctx.errors[field.name] = "List items must not be empty";
  }
}

function validateRecord(field: FieldSchema, value: unknown, ctx: ValidationCtx): void {
  if (value === undefined) return;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    ctx.errors[field.name] = "Must be an object";
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (key.trim() === "") {
      ctx.errors[field.name] = "Keys must not be empty";
      return;
    }
    if (typeof entry === "string") continue;
    const rowRaw = ctx.raw[`${field.name}.${key}`];
    if (rowRaw !== undefined) {
      try {
        JSON.parse(rowRaw);
      } catch {
        ctx.errors[field.name] = `Invalid JSON for ${key}`;
        return;
      }
    }
  }
}

function validateJson(field: FieldSchema, value: unknown, ctx: ValidationCtx): void {
  const text = ctx.raw[field.name] ?? (value === undefined ? "" : JSON.stringify(value));
  if (text.trim() === "") return;
  try {
    JSON.parse(text);
  } catch {
    ctx.errors[field.name] = "Invalid JSON";
  }
}

/** The per-widget validators; `nested-group` recurses (see `validateField`). */
const VALIDATORS: Partial<Record<WidgetKind, Validator>> = {
  number: validateNumber,
  enum: validateEnum,
  "string-list": validateList,
  record: validateRecord,
  json: validateJson,
};

function validateField(field: FieldSchema, ctx: ValidationCtx): void {
  if (field.widget === "nested-group") {
    for (const child of field.children ?? []) validateField(child, ctx);
    return;
  }
  VALIDATORS[field.widget]?.(field, getPath(ctx.draft, field.path), ctx);
}

/** Validate every field of a draft against its widget. Empty object = writable. */
function validateFields(
  fields: FieldSchema[],
  draft: Record<string, unknown>,
  raw: RawText,
): Record<string, string> {
  const errors: Record<string, string> = {};
  const ctx: ValidationCtx = { draft, raw, errors };
  for (const field of fields) validateField(field, ctx);
  return errors;
}

/**
 * Validate the visible fields of a draft. Returns dotted field name → message
 * (an empty object means the draft is writable). The server re-validates.
 */
export function validateDraft(
  fields: FieldSchema[],
  draft: Record<string, unknown>,
  tab: Transport,
  raw: RawText,
): Record<string, string> {
  const errors: Record<string, string> = {};
  const primary = TRANSPORT_FIELDS[tab][0] as string;
  const primaryValue = draft[primary];
  if (primaryValue === undefined || primaryValue === null || primaryValue === "") {
    errors[primary] = "Required";
  }
  Object.assign(errors, validateFields(fields, draft, raw));
  return errors;
}
