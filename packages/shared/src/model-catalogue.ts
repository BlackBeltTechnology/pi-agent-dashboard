/**
 * Pure projection + union helpers for the session-independent model catalogue
 * (`GET /api/models`).
 *
 * The Settings Default Model picker asks "what can THIS MACHINE run?", which no
 * single source answers: the catalogue is credential-filtered on `auth.json`
 * only (env-credentialed models are invisible to it), while per-session
 * `models_list` pushes exist only while a session is live. The picker therefore
 * renders the union; the model-proxy editors keep reading the catalogue alone.
 *
 * See change: settings-default-model-without-session.
 */
import type { ModelInfo } from "./types.js";

/**
 * A row of `GET /api/models`'s `data` array (see
 * `packages/server/src/routes/models-introspection-routes.ts` `toRow`). `id` is
 * fully qualified (`"<provider>/<model>"`); optional slots are omitted when
 * falsy, so `input` may be absent.
 */
export interface CatalogueModelRow {
  id: string;
  provider: string;
  reasoning?: boolean;
  input?: string[];
  contextWindow?: number;
  maxTokens?: number;
  thinkingLevelMap?: Record<string, unknown>;
  cost?: unknown;
  excludedReason?: string | null;
}

/**
 * Project a catalogue row to `ModelInfo`.
 *
 * `provider` is taken from the row's own field — NEVER by splitting `id`, which
 * would corrupt a provider name containing a slash. `vision` preserves
 * `undefined` when the row carries no `input` (unknown, not "no images").
 * `metadataSource` is deliberately omitted: the wire row cannot distinguish
 * authored capabilities from registry-floored defaults, so no badge is honest.
 * `thinkingLevelMap`/`maxTokens`/`cost` are dropped and NO
 * `supportedThinkingLevels` is derived (single-derivation rule: the bridge owns it).
 */
export function catalogueRowToModelInfo(row: CatalogueModelRow): ModelInfo {
  const prefix = `${row.provider}/`;
  const id = row.id.startsWith(prefix) ? row.id.slice(prefix.length) : row.id;
  return {
    provider: row.provider,
    id,
    ...(row.reasoning != null ? { reasoning: row.reasoning } : {}),
    ...(row.input ? { vision: row.input.includes("image") } : {}),
    ...(row.contextWindow != null ? { contextWindow: row.contextWindow } : {}),
  };
}

/**
 * Union of the catalogue and every per-session model list, deduplicated by
 * `"provider/id"`. Session rows WIN on collision: they carry `name`,
 * a real `metadataSource`, and `supportedThinkingLevels`, which catalogue rows
 * cannot. Set-keyed — linear in the total row count, never quadratic.
 */
export function mergeModelOptions(
  catalogue: readonly ModelInfo[],
  sessionModels: readonly ModelInfo[],
): ModelInfo[] {
  const byKey = new Map<string, ModelInfo>();
  for (const m of catalogue) byKey.set(`${m.provider}/${m.id}`, m);
  // Session rows overwrite catalogue rows on the same key (session wins), but a
  // second session repeating a model must not duplicate it.
  const sessionSeen = new Set<string>();
  for (const m of sessionModels) {
    const key = `${m.provider}/${m.id}`;
    if (sessionSeen.has(key)) continue;
    sessionSeen.add(key);
    byKey.set(key, m);
  }
  return [...byKey.values()];
}
