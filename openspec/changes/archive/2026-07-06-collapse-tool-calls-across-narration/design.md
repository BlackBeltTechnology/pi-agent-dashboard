# Design

## Context

Two grouping axes fold repetitive tool output in the chat view:

- **Semantic (`×N`)** — `groupConsecutiveToolCalls` (`group-tool-calls.ts`). Folds ≥ 3 consecutive **identical** `toolResult` rows (same `toolName` + deep-equal args) into a `ToolCallGroup`. Its `TRANSPARENT_ROLES` set includes `assistant` (any content), `thinking`, `turnSeparator`, `rawEvent`, `commandFeedback`: these are walked across so a narrated poll loop still collapses.
- **Temporal (burst)** — `groupToolBursts` (`group-tool-bursts.ts`, added by archived `group-tool-call-bursts`). Folds ≥ 3 consecutive **heterogeneous** `toolResult` rows into a progress-aware burst.

The archived change composed them **burst-OUTER over the raw array, semantic-INNER over each burst slice**, and introduced a NEW rule the semantic pass never had: non-empty `assistant` prose is a HARD boundary (design finding 2, contract #6). The stated goal was to prevent a prose row between two identical calls from being "over-merged" into a `×N`.

## The problem with that composition

The over-merge the archived design guarded against is, in practice, the **desired** behavior. When an agent runs the same command repeatedly and narrates each attempt, the narration is noise around a polling loop — folding it into a `×N` pill is exactly what users want and what the pre-#249 `Polling-loop tool calls collapse` requirement mandated (`assistant` listed as transparent).

Because the burst pass runs FIRST over the raw array and cuts on prose, the semantic pass never sees across the narration. Result: with prose between calls, **no** `×N` forms AND **no** burst forms. Reproduction:

```
[curl, curl, "found it", curl, curl]
  pre-#249 semantic-only : assistant, GROUP×4          (pill)
  #249 burst-outer-raw   : toolResult ×4, prose split  (wall of rows)
```

Agents narrate constantly, so this fires on most real sessions — the user sees no collapsed groups at all.

## Decision

**Compose semantic-INNER-first over the full stream, burst-OUTER-second over the semantic output.**

1. `items = groupConsecutiveToolCalls(messages)` over the ENTIRE stream. Identical calls fold across narration into `×N` groups, restoring pre-#249 behavior. The absorbed narration rows are now **carried** on the group (see below) rather than dropped.
2. `groupToolBursts` walks `items`, forming bursts over runs of **tool-like** items (a `toolResult` row OR a `×N` `ToolCallGroup`, which counts as one member). Non-empty `assistant` prose remains a HARD boundary **for burst formation** so a real turn-final reply between distinct investigation steps stays visible and splits bursts.

This inverts the archived finding 2 for the identical-call case only. The heterogeneous-burst boundary semantics (prose splits) are unchanged in intent; only the pass ordering flips.

### Why prose stays a boundary for bursts but not for `×N`

- Identical calls: prose between them is narration of a single repeated action → fold.
- Heterogeneous calls: prose between them may be the turn's substantive reply ("found the bug in X, now fixing") → keep it a top-level boundary so it is not buried in a collapsed scrollbox.

The two rules coexist cleanly under semantic-first because the semantic pass only ever absorbs prose that sits **between two identical calls**; trailing prose after the last identical call is left for the next iteration and renders at top level. So a turn's final reply is never swallowed even in the `×N` path.

## Narration fold-in (the enhancement)

Today a formed `×N` group keeps only `toolResult` rows in `group.messages`; the absorbed transparents are discarded and never rendered. Users want them preserved.

- Add a carrier on `ToolCallGroup`, e.g. `rendered: ChatMessage[]` — the full interleaved slice (tool results + absorbed `thinking`/`assistant`/separator rows) in original order. `messages` (toolResult-only) still drives the count badge and summary.
- `CollapsedToolGroup` expanded view iterates `rendered`: a `toolResult` → `ToolCallStep`; a `thinking`/`assistant` prose row → a lightweight inline text block; separators/`rawEvent`/`commandFeedback` with no content → skipped.
- `ToolBurstGroup` scrollbox likewise renders absorbed narration between its members.

Collapsed (one-line) rendering is unchanged; the fold-in is expand-only, so the default timeline stays terse.

## Alternatives considered

1. **Keep burst-outer-raw, only special-case identical calls across prose in the burst walk.** Rejected: reintroduces the context-dependent "is this prose between identical calls?" test inside the burst forward-walk — more complex than running the proven semantic pass first.
2. **Make prose fully transparent for BOTH axes.** Rejected: buries a turn's final reply inside a collapsed heterogeneous burst — the exact UX the original boundary rule protected against.
3. **Do nothing (accept the regression as intended).** Rejected: contradicts the pre-existing polling-loop requirement and the user's report; narrated poll loops are the primary case the `×N` collapse exists for.

## Risks

- **Over-collapse of `×N` across a real reply:** only if ≥ 3 identical calls span a substantive assistant reply. Rare, and pre-#249 behaved this way for months without complaint. The reply, being trailing after the last grouped call, still renders at top level; only narration strictly between identical calls folds.
- **Expanded-group visual noise:** rendering narration inside the scrollbox adds rows. Mitigated: expand-only, bounded scrollbox already caps height; empty/separator rows are skipped.

## Verification

- Unit: `[curl, curl, prose, curl, curl]` → one `×4` group (invert the archived test). Heterogeneous prose still splits bursts. Absorbed narration present in the group's `rendered`, absent from `messages`. Trailing reply renders at top level.
- Manual (Playwright/browser): a narrated poll loop shows one pill; expanding it shows the interleaved narration; a heterogeneous investigation with a mid-turn reply still splits.
