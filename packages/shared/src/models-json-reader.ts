/**
 * Shared reader for the user-authored `~/.pi/agent/models.json`.
 *
 * ONE pure flatten/precedence function consumed by BOTH registry paths — the
 * bridge extension (`provider-register.ts`) and the dashboard server
 * (`registry-singleton.readModels`) — so the two cannot diverge on how the
 * native nested format is parsed.
 *
 * Accepted shapes (all coexist; on a `provider/id` collision the NESTED native
 * entry wins over a legacy top-level entry):
 *   1. Native nested — `{ providers: { <name>: { models: [ { id, … } ] } } }`.
 *      Each model is stamped `provider: <name>` (the PARENT key wins over any
 *      in-entry `provider`).
 *   2. Legacy top-level array — `[ { provider, id, … } ]`.
 *   3. Legacy `{ models: [ { provider, id, … } ] }`.
 *
 * Defensive PER-PROVIDER: a malformed provider block (or a non-array `models`)
 * contributes no entries for that block and never throws; other providers still
 * read. This function is PURE over already-parsed JSON — callers own file I/O
 * and the `console.warn` on a JSON syntax error.
 *
 * See change: honor-native-models-json-metadata (D-X2).
 */

/** A flattened custom-model entry as read from `models.json`. */
export interface NativeModelEntry {
  id: string;
  provider: string;
  api?: string;
  baseUrl?: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  thinkingLevelMap?: Record<string, unknown>;
  /** Opaque runtime request-formatting hints (e.g. `thinkingFormat`). Never serialized to `/api/models`. */
  compat?: Record<string, unknown>;
  /**
   * Arbitrary OpenAI-compatible sampling parameters (pi 0.84.0), incl. opt-in
   * vLLM `thinking_token_budget`. Passed through opaquely: pi owns validation,
   * and an older pi simply ignores the field.
   * See change: update-pi-core-0-84-adopt-apis.
   */
  samplingParams?: Record<string, unknown>;
  cost?: { input: number; output: number; cacheRead?: number; cacheWrite?: number };
  input?: string[];
  headers?: Record<string, string>;
  oauthCompatible?: boolean;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** A raw entry object is usable when it carries a string `id`. */
function hasStringId(v: unknown): v is Record<string, unknown> & { id: string } {
  return isRecord(v) && typeof v.id === "string" && v.id.length > 0;
}

type EntryMap = Map<string, NativeModelEntry>;

function put(byKey: EntryMap, entry: NativeModelEntry): void {
  byKey.set(`${entry.provider}/${entry.id}`, entry);
}

/** Legacy shapes: entries carry their own `provider` + `id`. */
function addLegacyEntries(byKey: EntryMap, entries: unknown[]): void {
  for (const m of entries) {
    if (hasStringId(m) && typeof m.provider === "string") put(byKey, m as unknown as NativeModelEntry);
  }
}

/** Native nested `providers.<name>.models[]` — the parent key stamps `provider`. */
function addNestedProviders(byKey: EntryMap, providers: Record<string, unknown>): void {
  for (const [name, block] of Object.entries(providers)) {
    const models = isRecord(block) ? block.models : undefined;
    if (!Array.isArray(models)) continue; // per-provider defensive: skip, keep the rest
    for (const m of models) {
      if (hasStringId(m)) put(byKey, { ...(m as object), provider: name } as NativeModelEntry);
    }
  }
}

/**
 * Flatten a parsed `models.json` value into stamped `NativeModelEntry[]`.
 * Deduped by `provider/id`; nested native entries win over legacy top-level
 * entries on collision. Returns `[]` for any non-object / unusable input.
 */
export function flattenModelsJson(parsed: unknown): NativeModelEntry[] {
  const byKey: EntryMap = new Map();

  // 1. Legacy top-level array.
  if (Array.isArray(parsed)) {
    addLegacyEntries(byKey, parsed);
    return [...byKey.values()];
  }
  if (!isRecord(parsed)) return [];

  // 2. Legacy `{ models: [] }` — added BEFORE nested so nested wins on collision.
  if (Array.isArray(parsed.models)) addLegacyEntries(byKey, parsed.models);

  // 3. Native nested `providers.<name>.models[]`.
  if (isRecord(parsed.providers)) addNestedProviders(byKey, parsed.providers);

  return [...byKey.values()];
}
