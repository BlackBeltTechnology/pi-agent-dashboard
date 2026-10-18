/**
 * Pure logic of the `enabledModels` scope editor (pi settings page).
 *
 * `enabledModels` is a list of pi model patterns (`provider/*`, `provider/id`,
 * globs such as `*sonnet*`), each optionally ending in `:<thinkingLevel>`. The
 * editor shows them as provider toggles, per-model picks and free patterns.
 * This module classifies stored entries against the model catalogue and edits
 * the list WITHOUT rewriting anything the user did not touch: every entry keeps
 * its original string, so a load-then-save writes the same set.
 *
 * Matching uses the shared matcher (the same one the bridge extension filters
 * the dashboard model list with), so the in-scope count agrees with it.
 *
 * See change: pi-settings-full-coverage (design D7).
 */
import {
  matchesPattern,
  modelInScope,
  stripThinkingLevel,
} from "@blackbelt-technology/pi-dashboard-shared/enabled-models-match.js";

/** One catalogue model: `full` is `provider/id`, `id` is the part after the provider. */
export interface ScopeModel {
  provider: string;
  id: string;
  full: string;
}

export interface ScopeCatalogue {
  providers: ReadonlyMap<string, readonly ScopeModel[]>;
  models: readonly ScopeModel[];
}

/** Group catalogue rows (`{ id: "provider/modelId", provider }`) by provider. */
export function buildScopeCatalogue(rows: readonly { id: string; provider: string }[]): ScopeCatalogue {
  const providers = new Map<string, ScopeModel[]>();
  const models: ScopeModel[] = [];
  for (const r of rows) {
    const id = r.id.startsWith(`${r.provider}/`) ? r.id.slice(r.provider.length + 1) : r.id;
    const m: ScopeModel = { provider: r.provider, id, full: `${r.provider}/${id}` };
    models.push(m);
    const list = providers.get(r.provider) ?? [];
    list.push(m);
    providers.set(r.provider, list);
  }
  return { providers, models };
}

type ScopeItemKind = "provider" | "pick" | "pattern";

interface ScopeItem {
  /** The stored entry, verbatim (thinking-level suffix included). */
  raw: string;
  kind: ScopeItemKind;
  /** Provider id, `provider/id` of the model, or the pattern text. */
  target: string;
}

export interface ParsedScope {
  /** Every entry in stored order. */
  items: ScopeItem[];
  wholeProviders: ScopeItem[];
  picks: ScopeItem[];
  patterns: ScopeItem[];
}

const lower = (s: string): string => s.toLowerCase();

/** `<provider>/*` (suffix already stripped) when it covers EVERY catalogue model of that provider. */
function wholeProviderOf(stripped: string, catalogue: ScopeCatalogue): string | null {
  if (!stripped.endsWith("/*")) return null;
  const wanted = lower(stripped.slice(0, -2));
  for (const [provider, models] of catalogue.providers) {
    if (lower(provider) !== wanted) continue;
    // `*` does not match `/`, so a provider with slash ids is NOT covered by `p/*`.
    return models.length > 0 && models.every((m) => matchesPattern(m, stripped)) ? provider : null;
  }
  return null;
}

/** The catalogue model an entry names exactly (full id first, so `x:free` ids are not misread as a level). */
function pickOf(raw: string, catalogue: ScopeCatalogue): ScopeModel | null {
  const byFull = (s: string) => catalogue.models.find((m) => lower(m.full) === lower(s)) ?? null;
  return byFull(raw) ?? byFull(stripThinkingLevel(raw));
}

function classifyEntry(raw: string, catalogue: ScopeCatalogue): ScopeItem {
  const pick = pickOf(raw, catalogue);
  if (pick) return { raw, kind: "pick", target: pick.full };
  const provider = wholeProviderOf(stripThinkingLevel(raw), catalogue);
  if (provider) return { raw, kind: "provider", target: provider };
  return { raw, kind: "pattern", target: raw };
}

export function parseScope(entries: readonly string[], catalogue: ScopeCatalogue): ParsedScope {
  const items = entries.map((e) => classifyEntry(e, catalogue));
  return {
    items,
    wholeProviders: items.filter((i) => i.kind === "provider"),
    picks: items.filter((i) => i.kind === "pick"),
    patterns: items.filter((i) => i.kind === "pattern"),
  };
}

/** Entries to store: original strings, original order. */
export const serializeScope = (parsed: ParsedScope): string[] => parsed.items.map((i) => i.raw);

/** Order-insensitive identity of an entry list (dirty check). */
const scopeEntrySet = (entries: readonly string[]): Set<string> => new Set(entries);

export function sameScopeEntries(a: readonly string[], b: readonly string[]): boolean {
  const sa = scopeEntrySet(a);
  const sb = scopeEntrySet(b);
  return sa.size === sb.size && [...sa].every((e) => sb.has(e));
}

/** True when a provider's catalogue ids contain `/` (`provider/*` cannot cover them). */
const hasSlashIds = (models: readonly ScopeModel[]): boolean => models.some((m) => m.id.includes("/"));

export type ProviderState = "all" | "some" | "none";

export interface ModelState {
  /** In scope through a pick, the whole provider or a pattern. */
  selected: boolean;
  /** Covered by a pattern: shown selected, not individually toggleable. */
  viaPattern: boolean;
}

export function modelState(parsed: ParsedScope, model: ScopeModel): ModelState {
  const viaPattern = parsed.patterns.some((p) => matchesPattern(model, stripThinkingLevel(p.raw)));
  const viaProvider = parsed.wholeProviders.some((p) => lower(p.target) === lower(model.provider));
  const picked = parsed.picks.some((p) => lower(p.target) === lower(model.full));
  return { selected: viaPattern || viaProvider || picked, viaPattern };
}

export function providerState(parsed: ParsedScope, provider: string, catalogue: ScopeCatalogue): ProviderState {
  const models = catalogue.providers.get(provider) ?? [];
  if (parsed.wholeProviders.some((p) => lower(p.target) === lower(provider))) return "all";
  const states = models.map((m) => modelState(parsed, m).selected);
  if (states.length > 0 && states.every(Boolean)) return "all";
  return states.some(Boolean) ? "some" : "none";
}

/** Add or remove a whole provider. Returns a new entry list. */
export function toggleProvider(
  entries: readonly string[],
  catalogue: ScopeCatalogue,
  provider: string,
  on: boolean,
): string[] {
  const parsed = parseScope(entries, catalogue);
  const models = catalogue.providers.get(provider) ?? [];
  const ofProvider = (full: string) => models.some((m) => lower(m.full) === lower(full));
  if (!on) {
    return parsed.items
      .filter((i) => !(i.kind === "provider" && lower(i.target) === lower(provider)))
      .filter((i) => !(i.kind === "pick" && ofProvider(i.target)))
      .map((i) => i.raw);
  }
  if (hasSlashIds(models)) {
    // `provider/*` would not match these ids: store explicit picks instead.
    const have = new Set(parsed.picks.map((p) => lower(p.target)));
    return [...entries, ...models.filter((m) => !have.has(lower(m.full))).map((m) => m.full)];
  }
  // Picks without a level are subsumed by the provider glob; picks with a level keep it.
  const kept = parsed.items.filter((i) => !(i.kind === "pick" && ofProvider(i.target) && i.raw === i.target));
  return [...kept.map((i) => i.raw), `${provider}/*`];
}

/** Add or remove a single model. A model covered by a pattern cannot be toggled. */
export function toggleModel(
  entries: readonly string[],
  catalogue: ScopeCatalogue,
  model: ScopeModel,
  on: boolean,
): string[] {
  const parsed = parseScope(entries, catalogue);
  if (modelState(parsed, model).viaPattern) return [...entries];
  if (on) return [...entries, model.full];
  const whole = parsed.wholeProviders.find((p) => lower(p.target) === lower(model.provider));
  if (whole) {
    // Deselecting one model of a whole provider: expand it into explicit picks of the others,
    // keeping the provider entry's thinking-level suffix.
    const suffix = whole.raw.slice(stripThinkingLevel(whole.raw).length);
    const others = (catalogue.providers.get(model.provider) ?? [])
      .filter((m) => lower(m.full) !== lower(model.full))
      .map((m) => `${m.full}${suffix}`);
    return [...parsed.items.filter((i) => i !== whole).map((i) => i.raw), ...others].filter(
      (e) => lower(stripThinkingLevel(e)) !== lower(model.full),
    );
  }
  return parsed.items.filter((i) => !(i.kind === "pick" && lower(i.target) === lower(model.full))).map((i) => i.raw);
}

export function addPattern(entries: readonly string[], pattern: string): string[] {
  const p = pattern.trim();
  return p === "" || entries.includes(p) ? [...entries] : [...entries, p];
}

export const removeEntry = (entries: readonly string[], raw: string): string[] => entries.filter((e) => e !== raw);

/** Catalogue models covered by the entries (the editor's live count). */
export function countInScope(entries: readonly string[], catalogue: ScopeCatalogue): number {
  return catalogue.models.filter((m) => modelInScope(m, entries)).length;
}
