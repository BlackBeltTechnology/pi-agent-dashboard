// Shared mapping of a resolved KbConfig into the ranking SearchOpts every
// ranking surface passes to store.search. ONE place, so the CLI and the
// kb_search tool cannot drift apart again (design D2,
// change fix-kb-eval-measurement-integrity).
//
// Ranking-surface inventory (complete, per design D2): `cli.ts` search,
// `cli.ts` eval, kb-extension `kb_search`, `eval/run-fixtures.ts`,
// `eval/measure-render.ts`. Deliberate store-default consumers (`src/dox.ts`,
// `verify.ts`, `{ limit }` only) stay OUT — converting them would silently
// change `kb dox`/verify behaviour.
import type { KbConfig, ResolvedSource } from "./config.js";
import type { SearchOpts } from "./types.js";

/** Explicit, flag-derived / call-site-decided departures from the config.
 *  `undefined` = no override, the field takes its config value. Passing a
 *  value for a field the caller does not honour is the point: the difference
 *  between the surfaces becomes a visible code-level decision, not a silent
 *  omission (e.g. the extension pins `expandGraph: false, rerank: false`). */
export interface SearchOptsOverrides {
  sourceDedup?: boolean; // --no-source-dedup
  laneQuota?: number; // --no-lane-quota (0 disables)
  coverageRerank?: boolean; // --no-coverage-rerank
  expandParent?: boolean; // --expand-parent / --no-expand-parent (OR-composed at the call site)
  expandGraph?: boolean; // --expand-graph
  rerank?: boolean; // --rerank
  queryExpansion?: SearchOpts["queryExpansion"]; // --expand-query (off→synonym at the call site)
}

export function searchOptsFromConfig(
  cfg: KbConfig & { resolvedSources?: ResolvedSource[] },
  opts: { sources?: ResolvedSource[]; overrides?: SearchOptsOverrides } = {},
): SearchOpts {
  const o = opts.overrides ?? {};
  const sources = opts.sources ?? cfg.resolvedSources ?? [];
  return {
    fieldWeights: cfg.ranking.fieldWeights,
    proximityBoost: cfg.ranking.proximityBoost,
    diversity: cfg.ranking.diversity,
    sourceDedup: o.sourceDedup ?? cfg.ranking.sourceDedup,
    laneQuota: o.laneQuota ?? cfg.ranking.laneQuota,
    coverageRerank: o.coverageRerank ?? cfg.ranking.coverageRerank,
    queryExpansion: o.queryExpansion ?? cfg.queryExpansion.mode,
    prf: cfg.queryExpansion.prf,
    expandParent: o.expandParent ?? cfg.expand.parent,
    expandGraph: o.expandGraph ?? cfg.expand.graph,
    rerank: o.rerank ?? cfg.rerank.enabled,
    rootPriority: Object.fromEntries(sources.map((s) => [s.id, s.priority])),
  };
}
