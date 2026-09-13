/**
 * mcp-client-plugin · client schema model.
 *
 * Turns the published JSON Schema (`GET /api/mcp-client/schema`, authored at
 * `schema/mcp-config.schema.json`) into the editor's field list: widget
 * selection, transport tagging, secret/atomic markers — plus the pure helpers
 * the editor and its tests share (deep clone/equality, redaction sentinels,
 * patch computation, save validation).
 *
 * `widgetFor` always ends in a concrete widget or the JSON fallback, so no
 * schema field can ever be silently dropped (spec: any field without a widget
 * falls back to a validated JSON editor).
 *
 * See change: extract-mcp-client-plugin (tasks 7.4, 7.5).
 */

export type Transport = "command" | "url" | "socket";

export interface JsonSchema {
  type?: string;
  enum?: (string | number)[];
  const?: unknown;
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  oneOf?: JsonSchema[];
  $ref?: string;
  "x-transport"?: string;
  "x-secret"?: boolean;
  "x-atomic"?: boolean;
  [key: string]: unknown;
}

export type WidgetKind =
  | "text"
  | "number"
  | "boolean"
  | "enum"
  | "string-list"
  | "toggle-list"
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
  atomic: boolean;
  enumValues?: (string | number)[];
  /** A `const: false` branch exists (`oauth`) — renders an enable checkbox. */
  unionFalse?: boolean;
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

/** Resolve a `$ref: "#/$defs/X"` node, keeping the referencing node's markers. */
function resolveRef(schema: JsonSchema, defs: Record<string, JsonSchema>): JsonSchema {
  if (typeof schema.$ref !== "string") return schema;
  const target = defs[schema.$ref.split("/").pop() ?? ""];
  if (!target) return schema;
  const merged: Record<string, unknown> = { ...target };
  for (const key of ["x-transport", "x-secret", "x-atomic"] as const) {
    if (schema[key] !== undefined) merged[key] = schema[key];
  }
  return merged as JsonSchema;
}

function isObjectSchema(s: JsonSchema): boolean {
  return s.type === "object" && s.properties !== undefined && Object.keys(s.properties).length > 0;
}

/** The object schema a nested group renders from: the field itself, or its `oneOf` object branch. */
function groupSourceOf(resolved: JsonSchema, defs: Record<string, JsonSchema>): JsonSchema {
  if (isObjectSchema(resolved)) return resolved;
  for (const branch of resolved.oneOf ?? []) {
    const candidate = resolveRef(branch, defs);
    if (isObjectSchema(candidate)) return candidate;
  }
  return resolved;
}

/** A `boolean | string[]` union (`toggle-list`) or an atomic object union (`nested-group`). */
function unionWidget(s: JsonSchema, defs: Record<string, JsonSchema>): WidgetKind {
  const branches = (s.oneOf ?? []).map((b) => resolveRef(b, defs));
  if (branches.some((b) => b.type === "boolean") &&
      branches.some((b) => b.type === "array" && b.items?.type === "string")) {
    return "toggle-list";
  }
  if (branches.some(isObjectSchema) && s["x-atomic"] === true) return "nested-group";
  return "json";
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
      if (s["x-atomic"] === true) return isObjectSchema(s) ? "nested-group" : "record";
      return "json";
    default:
      return "json";
  }
}

/** The widget a field renders as. NEVER null/undefined — unknown shapes → "json". */
export function widgetFor(schema: JsonSchema, defs: Record<string, JsonSchema> = {}): WidgetKind {
  const s = resolveRef(schema, defs);
  if (Array.isArray(s.enum)) return "enum";
  if (Array.isArray(s.oneOf)) return unionWidget(s, defs);
  if (s.const !== undefined) return "json";
  return simpleWidget(s);
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
    transport: resolved["x-transport"] === "command" || resolved["x-transport"] === "url" ||
        resolved["x-transport"] === "socket"
      ? resolved["x-transport"]
      : null,
    secret: resolved["x-secret"] === true,
    atomic: resolved["x-atomic"] === true,
  };
  if (Array.isArray(resolved.enum)) field.enumValues = resolved.enum;
  if (Array.isArray(resolved.oneOf) && resolved.oneOf.some((b) => b.const === false)) {
    field.unionFalse = true;
  }
  if (field.widget === "nested-group") {
    const source = groupSourceOf(resolved, defs);
    field.children = Object.entries(source.properties ?? {}).map(([child, childProp]) =>
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

/** Every `x-atomic === true` field, DERIVED from the schema (never hardcoded). */
export function atomicFieldsOf(doc: Record<string, unknown>): string[] {
  return fieldsOf(doc)
    .filter((f) => f.atomic)
    .map((f) => f.name);
}

// ─── transport grouping ──────────────────────────────────────────────────────

/**
 * Fields scoped to one transport. `x-transport` tags only the three primary
 * fields; the companions (args/env for command, headers/auth/… for url) are the
 * spec's tab groups (the url tab hides command/args/env, shows url/headers/auth).
 */
export const TRANSPORT_FIELDS: Record<Transport, readonly string[]> = {
  command: ["command", "args", "env", "cwd"],
  url: [
    "url",
    "headers",
    "auth",
    "bearerToken",
    "bearerTokenEnv",
    "bearerTokenStore",
    "oauth",
    "requestHeadersCommand",
    "httpTransport",
  ],
  socket: ["socket"],
};

export function visibleUnderTransport(name: string, tab: Transport): boolean {
  for (const transport of Object.keys(TRANSPORT_FIELDS) as Transport[]) {
    if (transport !== tab && TRANSPORT_FIELDS[transport].includes(name)) return false;
  }
  return true;
}

// ─── secret masking ──────────────────────────────────────────────────────────

/** Credential-name pattern — the EXACT regex the server's redaction uses. */
export const SECRET_KEY_PATTERN = /authorization|token|key|secret/i;

/** True when an `env`/`headers` key NAME looks like a credential. */
export function isSecretKeyName(name: string): boolean {
  return SECRET_KEY_PATTERN.test(name);
}

// ─── redaction sentinels ─────────────────────────────────────────────────────

export interface RedactedRecord {
  redacted: true;
  keys?: Array<{ name: string; secret: boolean }>;
}

/** `{ redacted: true }` (scalar) or `{ redacted: true, keys: [...] }` (record). */
export function isRedacted(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (value as { redacted?: unknown }).redacted === true
  );
}

/** The known key names of a redacted record (empty for scalars). */
export function redactedKeys(value: unknown): Array<{ name: string; secret: boolean }> {
  return isRedacted(value) ? ((value as RedactedRecord).keys ?? []) : [];
}

/** Counts for the atomic-override note ("N inherited keys incl. K secrets"). */
export function atomicCounts(baseline: unknown): { count: number; secrets: number } {
  if (isRedacted(baseline)) {
    const keys = redactedKeys(baseline);
    return { count: keys.length, secrets: keys.filter((k) => k.secret).length };
  }
  if (baseline !== null && typeof baseline === "object" && !Array.isArray(baseline)) {
    const keys = Object.keys(baseline);
    return { count: keys.length, secrets: keys.filter(isSecretKeyName).length };
  }
  return { count: 0, secrets: 0 };
}

/** Recursively remove redaction sentinels — a sentinel is never sent to the server. */
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

// ─── draft + patch model ─────────────────────────────────────────────────────

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
 * `set` = keys whose (sentinel-stripped) draft value differs from baseline;
 * `unset` = keys the operator removed. Untouched unknown fields are preserved.
 */
export function computePatch(
  draft: Record<string, unknown>,
  baseline: Record<string, unknown>,
): { set: Record<string, unknown>; unset: string[] } {
  const set: Record<string, unknown> = {};
  for (const key of Object.keys(draft)) {
    const value = stripRedacted(draft[key]);
    if (value === undefined) continue;
    if (!deepEqual(value, stripRedacted(baseline[key]))) set[key] = value;
  }
  const unset = Object.keys(baseline).filter((key) => !(key in draft));
  return { set, unset };
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
  if (value !== undefined && !(field.enumValues ?? []).includes(value as string | number)) {
    ctx.errors[field.name] = "Not a valid option";
  }
}

function validateList(field: FieldSchema, value: unknown, ctx: ValidationCtx): void {
  const rows = Array.isArray(value) ? value : [];
  if (rows.some((row) => typeof row !== "string" || row.trim() === "")) {
    ctx.errors[field.name] = "List items must not be empty";
  }
}

/** One record entry's error, or `null` when the entry is writable. */
function recordEntryError(
  field: FieldSchema,
  key: string,
  entry: unknown,
  raw: RawText,
): string | null {
  if (key.trim() === "") return "Keys must not be empty";
  const rowRaw = raw[`${field.name}.${key}`];
  if (typeof entry !== "string" && rowRaw !== undefined) {
    try {
      JSON.parse(rowRaw);
    } catch {
      return `Invalid JSON for ${key}`;
    }
  }
  return null;
}

function validateRecord(field: FieldSchema, value: unknown, ctx: ValidationCtx): void {
  if (value === undefined) return;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    ctx.errors[field.name] = "Must be an object";
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    const error = recordEntryError(field, key, entry, ctx.raw);
    if (error !== null) {
      ctx.errors[field.name] = error;
      return;
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
  "toggle-list": validateList,
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
  const ctx: ValidationCtx = { draft, raw, errors };
  const primary = TRANSPORT_FIELDS[tab][0] as string;

  const primaryField = fields.find((f) => f.name === primary);
  const primaryValue = primaryField ? getPath(draft, primaryField.path) : undefined;
  if (primaryField && (primaryValue === undefined || primaryValue === null || primaryValue === "")) {
    errors[primary] = "Required";
  }

  for (const field of fields) validateField(field, ctx);
  return errors;
}
