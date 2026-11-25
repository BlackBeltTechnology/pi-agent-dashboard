/**
 * Product catalogue (design D4) — the single source for server, client, tools and the
 * verification kit: products, ordered levels, the Google scopes each level needs, the
 * Google scope class, and whether the built-in pi-dashboard.dev app may offer it.
 * Pure data + functions. See change: add-google-connect.
 */

export const PRODUCTS = ["gmail", "calendar", "drive", "docs", "sheets", "slides", "tasks", "contacts"] as const;
export type Product = (typeof PRODUCTS)[number];

/** Google's scope classification. `restricted` scopes never go through the remote return page. */
type ScopeClass = "non-sensitive" | "sensitive" | "restricted";

const A = "https://www.googleapis.com/auth/";
export const SCOPE = {
  gmailReadonly: `${A}gmail.readonly`,
  gmailCompose: `${A}gmail.compose`,
  gmailModify: `${A}gmail.modify`,
  gmailSettingsBasic: `${A}gmail.settings.basic`,
  calendarReadonly: `${A}calendar.readonly`,
  calendarEvents: `${A}calendar.events`,
  driveFile: `${A}drive.file`,
  driveReadonly: `${A}drive.readonly`,
  drive: `${A}drive`,
  documentsReadonly: `${A}documents.readonly`,
  documents: `${A}documents`,
  spreadsheetsReadonly: `${A}spreadsheets.readonly`,
  spreadsheets: `${A}spreadsheets`,
  presentationsReadonly: `${A}presentations.readonly`,
  presentations: `${A}presentations`,
  tasksReadonly: `${A}tasks.readonly`,
  tasks: `${A}tasks`,
  contactsReadonly: `${A}contacts.readonly`,
  contacts: `${A}contacts`,
} as const;

/** Every consent also requests these two. */
const BASE_SCOPES: readonly string[] = ["openid", "email"];

interface LevelDef {
  id: string;
  scopes: readonly string[];
  class: ScopeClass;
  /** False for levels the built-in app never offers (full Drive; server-enforced, not only UI). */
  builtin: boolean;
}

interface OptionDef {
  scope: string;
  class: ScopeClass;
}

interface ProductDef {
  id: Product;
  /** Ordered low → high. */
  levels: readonly LevelDef[];
  options?: Readonly<Record<string, OptionDef>>;
}

const lvl = (id: string, scopes: string[], cls: ScopeClass, builtin = true): LevelDef => ({
  id,
  scopes,
  class: cls,
  builtin,
});

/** Catalogue order = display order (scenario-gate B10). */
export const CATALOGUE: readonly ProductDef[] = [
  {
    id: "gmail",
    levels: [
      lvl("readonly", [SCOPE.gmailReadonly], "restricted"),
      lvl("draft", [SCOPE.gmailReadonly, SCOPE.gmailCompose], "restricted"),
      lvl("send", [SCOPE.gmailModify], "restricted"),
    ],
    options: { filters: { scope: SCOPE.gmailSettingsBasic, class: "sensitive" } },
  },
  {
    id: "calendar",
    levels: [
      lvl("read", [SCOPE.calendarReadonly], "sensitive"),
      lvl("write", [SCOPE.calendarEvents], "sensitive"),
    ],
  },
  {
    id: "drive",
    levels: [
      lvl("files", [SCOPE.driveFile], "non-sensitive"),
      lvl("read", [SCOPE.driveReadonly], "restricted", false),
      lvl("write", [SCOPE.drive], "restricted", false),
    ],
  },
  {
    id: "docs",
    levels: [lvl("read", [SCOPE.documentsReadonly], "sensitive"), lvl("write", [SCOPE.documents], "sensitive")],
  },
  {
    id: "sheets",
    levels: [lvl("read", [SCOPE.spreadsheetsReadonly], "sensitive"), lvl("write", [SCOPE.spreadsheets], "sensitive")],
  },
  {
    id: "slides",
    levels: [lvl("read", [SCOPE.presentationsReadonly], "sensitive"), lvl("write", [SCOPE.presentations], "sensitive")],
  },
  {
    id: "tasks",
    levels: [lvl("read", [SCOPE.tasksReadonly], "sensitive"), lvl("write", [SCOPE.tasks], "sensitive")],
  },
  {
    id: "contacts",
    levels: [lvl("read", [SCOPE.contactsReadonly], "sensitive"), lvl("write", [SCOPE.contacts], "sensitive")],
  },
];

const BY_ID = new Map<Product, ProductDef>(CATALOGUE.map((p) => [p.id, p]));

/** A granted scope also covers these (Google's own implications). */
const IMPLIES: Readonly<Record<string, readonly string[]>> = {
  [SCOPE.gmailModify]: [SCOPE.gmailReadonly, SCOPE.gmailCompose],
  [SCOPE.drive]: [SCOPE.driveReadonly, SCOPE.driveFile],
  [SCOPE.documents]: [SCOPE.documentsReadonly],
  [SCOPE.spreadsheets]: [SCOPE.spreadsheetsReadonly],
  [SCOPE.presentations]: [SCOPE.presentationsReadonly],
  [SCOPE.tasks]: [SCOPE.tasksReadonly],
  [SCOPE.contacts]: [SCOPE.contactsReadonly],
};

export function isProduct(v: unknown): v is Product {
  return typeof v === "string" && BY_ID.has(v as Product);
}

function levelsOf(product: Product): readonly string[] {
  return (BY_ID.get(product)?.levels ?? []).map((l) => l.id);
}

export function isLevel(product: Product, level: unknown): level is string {
  return typeof level === "string" && levelsOf(product).includes(level);
}

function levelDef(product: Product, level: string): LevelDef | undefined {
  return BY_ID.get(product)?.levels.find((l) => l.id === level);
}

/** Index in the ordered level list; `-1` for an unknown level. */
export function levelRank(product: Product, level: string): number {
  return levelsOf(product).indexOf(level);
}

/** True when `have` is at least `need` for `product`. */
export function levelAtLeast(product: Product, have: string, need: string): boolean {
  const h = levelRank(product, have);
  const n = levelRank(product, need);
  return h >= 0 && n >= 0 && h >= n;
}

function optionNames(product: Product): readonly string[] {
  return Object.keys(BY_ID.get(product)?.options ?? {});
}

/** Whether the built-in pi-dashboard.dev app may offer `product` at `level` (full Drive is own-client only). */
export function builtinOffers(product: Product, level: string): boolean {
  return levelDef(product, level)?.builtin === true;
}

/** One product's wish: a level plus optional boolean options (e.g. Gmail `filters`). */
export interface ProductSelection {
  level: string;
  options?: Record<string, boolean>;
}
export type Selection = Partial<Record<Product, ProductSelection>>;

/** Scopes one product selection needs (level scopes + enabled options). */
export function scopesFor(product: Product, sel: ProductSelection): string[] {
  const def = BY_ID.get(product);
  const level = levelDef(product, sel.level);
  if (!def || !level) return [];
  const out = [...level.scopes];
  for (const [name, on] of Object.entries(sel.options ?? {})) {
    const opt = def.options?.[name];
    if (on === true && opt) out.push(opt.scope);
  }
  return out;
}

/** Scopes a whole selection needs, de-duplicated, catalogue order. */
export function requiredScopes(selection: Selection): string[] {
  const out = new Set<string>();
  for (const def of CATALOGUE) {
    const sel = selection[def.id];
    if (sel) for (const s of scopesFor(def.id, sel)) out.add(s);
  }
  return [...out];
}

/** `granted` expanded through the implication table. */
export function effectiveScopes(granted: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const s of granted) {
    out.add(s);
    for (const i of IMPLIES[s] ?? []) out.add(i);
  }
  return out;
}

/** True when `granted` already covers every scope of the selection (no consent needed). */
export function coversSelection(granted: readonly string[], selection: Selection): boolean {
  const eff = effectiveScopes(granted);
  return requiredScopes(selection).every((s) => eff.has(s));
}

/** True when `granted` covers one product selection. */
export function coversProduct(granted: readonly string[], product: Product, sel: ProductSelection): boolean {
  return coversSelection(granted, { [product]: sel });
}

/** Union of two scope lists, order-stable (granted first). The consent request is always the union (D6). */
export function unionScopes(granted: readonly string[], required: readonly string[]): string[] {
  return [...new Set([...granted, ...required])];
}

/** Space-separated `scope` request parameter: `openid email` + the union. */
export function scopeParam(scopes: readonly string[]): string {
  return [...new Set([...BASE_SCOPES, ...scopes])].join(" ");
}

/** Products in `selection` whose scopes are restricted (never offered through the remote return page, B6). */
export function restrictedProducts(selection: Selection): Product[] {
  const out: Product[] = [];
  for (const def of CATALOGUE) {
    const sel = selection[def.id];
    if (!sel) continue;
    const l = levelDef(def.id, sel.level);
    if (l?.class === "restricted") out.push(def.id);
  }
  return out;
}

/** Products in `selection` the built-in app cannot offer at the chosen level. */
export function builtinRefused(selection: Selection): Product[] {
  const out: Product[] = [];
  for (const def of CATALOGUE) {
    const sel = selection[def.id];
    if (sel && !builtinOffers(def.id, sel.level)) out.push(def.id);
  }
  return out;
}

function parseOptions(product: Product, raw: unknown): Record<string, boolean> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const clean: Record<string, boolean> = {};
  for (const [name, on] of Object.entries(raw as Record<string, unknown>)) {
    if (!optionNames(product).includes(name) || typeof on !== "boolean") return null;
    clean[name] = on;
  }
  return clean;
}

function parseOne(product: Product, v: unknown): ProductSelection | null {
  const level = typeof v === "string" ? v : (v as { level?: unknown } | null)?.level;
  if (!isLevel(product, level)) return null;
  const rawOptions = typeof v === "object" && v !== null ? (v as { options?: unknown }).options : undefined;
  if (rawOptions === undefined) return { level };
  const options = parseOptions(product, rawOptions);
  return options ? { level, options } : null;
}

/**
 * Parse an untrusted `{product: level | {level, options}}` body into a {@link Selection}.
 * Unknown products/levels/options are rejected (returns `null`) — never silently dropped.
 */
export function parseSelection(raw: unknown): Selection | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Selection = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!isProduct(k)) return null;
    const sel = parseOne(k, v);
    if (!sel) return null;
    out[k] = sel;
  }
  return out;
}
