## Why

Custom chat entries from pi extensions render as a single plain-text JSON blob
(`CustomEntryCard`), because the reducer stringifies the structured payload at row
creation and no plugin can claim the row. The `pi-blackhole` extension is the
highest-volume producer — measured across local session logs: `om.observations.recorded`
(2262 rows, avg 136 pretty-printed lines), `om.reflections.recorded` (1296), and
`om.observations.dropped` (800). That is ~4.3k rows of unreadable JSON in the transcript,
and 13% of `om.observations.recorded` payloads exceed the 200-line display ceiling, so
even the JSON is cut off. The `tool-renderer` slot already proved the pattern for tool
calls keyed by `toolName`; custom entries have no equivalent.

Those rows also carry a second, measured cost: `group-tool-bursts.ts` treats every
`role: "custom"` row as a HARD boundary (`BURST_TRANSPARENT_ROLES` omits `custom`), so each
one SPLITS a tool burst that would otherwise have collapsed. Measured gap between
same-`customType` `om` rows is a median of 45 entries — they are scattered through the whole
transcript, never adjacent (zero same-type adjacency across 220 sampled rows). So the damage
is not a wall of JSON in one place; it is ~4.3k burst-splitters sprayed across every session.

## What Changes

- Add a `custom-entry-renderer` slot (react-only, `many`) keyed by `customType`, mirroring
  `tool-renderer`'s keying and `shouldRender` gate.
- `ChatView`'s `role: "custom"` branch resolves plugin claim → `CustomEntryCard` fallback,
  mirroring `ToolCallStep`'s one-shot lookup + per-claim `ErrorBoundary`.
- Plugin renderers stay subject to the existing `customEventGroups` visibility gate
  (unlike flow cards, which are exempt); a hidden group hides the plugin card too.
- Add `GET /api/sessions/:sessionId/entry/:entryId` returning the untruncated structured
  payload for a persisted custom entry, in the same session-addressed safety class as the
  existing `…/tool-result/:toolCallId` endpoint, with a `useCustomEntryPayload` hook
  mirroring `useToolFullResult` (404 → "entry evicted").
- Renderers are **collapsed-first**: the collapsed line is derived from the row's existing
  truncated body with no fetch; the payload fetch fires only on expand. This keeps the
  steady-state cost of 4.3k rows at zero extra bytes and zero extra requests.
- Custom rows whose `customType` is CLAIMED by a plugin become transparent to burst
  formation, so they stop splitting tool bursts. The row's group-visibility gate is pushed
  into the burst renderer so an absorbed row is still hidden when its group is toggled off
  (grouping runs BEFORE `isRowVisible` in `ChatView`, so absorption would otherwise let a
  hidden row escape the gate).
- The blackhole plugin claims `om.observations.recorded`, `om.reflections.recorded`, and
  `om.observations.dropped`, rendering a one-line summary collapsed and the structured
  observation/reflection list expanded.
- **Non-goals**: no change to how custom rows are reduced or truncated; no new visibility
  surface (density is already handled by the shipped `customEventGroups` toggle);
  **no cross-row aggregation** — measurement shows `om` rows are never adjacent (median
  45-entry gaps), so adjacent-run collapsing would fire on ~36% of runs and fold at most 3
  rows; `flow-event` keeps its dedicated path; `om.folded` is out of scope (it is a field
  inside `type: "compaction"` entries, not a `customType`, and never reaches the chat as a
  custom row).

## Capabilities

### New Capabilities
- `blackhole-om-entry-rendering`: how the blackhole plugin renders `om.*` custom entries —
  which types it claims, the collapsed summary contract, the expanded structured view, and
  its degradation when the payload is unavailable.

### Modified Capabilities
- `dashboard-shell-slots`: adds the `custom-entry-renderer` slot id, its multiplicity /
  payload tier / predicate classification, and the `customType` claim-matching + tiebreak
  rules (mirroring the existing `tool-renderer` requirements).
- `custom-entry-rendering`: the generic `CustomEntryCard` fallback becomes the last link in
  a resolution chain rather than the only renderer; group-visibility gating and the
  `flow-event` exclusion extend to plugin-owned renderers.
- `dashboard-server`: adds the `GET /api/sessions/:sessionId/entry/:entryId` endpoint.
- `tool-burst-grouping`: the transparent-row set gains a CONDITIONAL member — a custom row
  whose `customType` is claimed by a plugin is absorbed instead of terminating the burst.

## Impact

- `packages/shared/src/dashboard-plugin/slot-types.ts` — new `SlotId`, `SLOT_DEFINITIONS`
  entry, `SlotPredicateInput` classification (`never`, like `tool-renderer`).
- `packages/dashboard-plugin-runtime/src/manifest-validator.ts` — validate the
  `customType` field on the new slot.
- `packages/client/src/components/chat/ChatView.tsx` — resolution chain in the
  `role: "custom"` branch; new claim-matching helper alongside `forToolName`; claimed-type
  predicate + group gate threaded into `groupToolBursts`.
- `packages/client/src/lib/chat/group-tool-bursts.ts` — conditional transparency for custom
  rows via an injected predicate (the module stays pure; no registry import).
- `packages/client/src/components/chat/ToolBurstGroup.tsx` — applies the custom-group gate to
  absorbed custom rows.
- `packages/client/src/hooks/` — `useCustomEntryPayload`.
- `packages/server/src/` — entry-payload route.
- `packages/blackhole-plugin/` — new client renderer component + three manifest claims.
- No change to `event-reducer.ts` row shape; `ChatMessage.entryId` (already persisted on
  the `custom_entry` arm) is the fetch key.

## Discipline Skills

- `security-hardening` — the new endpoint serves arbitrary extension-authored payloads to
  the browser; it must match the session-addressed (never path-addressed) safety class of
  `tool-result`, and the expanded renderer must not markdown-interpret or linkify payload
  text.
- `review-code` — non-trivial change spanning shared types, runtime validation, client
  rendering, server routing, and a plugin.
- `performance-optimization` — the collapsed-first contract exists to hold a 4.3k-row
  transcript flat; the "no fetch until expand" property needs to be verified, not assumed.
  Burst-transparency is likewise justified by measurement (median 45-entry gaps), not
  intuition, and its effect on burst counts should be measured rather than assumed.
- `observability-instrumentation` — new REST endpoint; needs the same logging/error shape
  as its sibling endpoint.
