# Test Plan — render-inline-reasoning-and-custom-entries

Stage: design   Generated: 2026-08-28

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | custom-entry-rendering · display exclusion | decision-table | L1 | automated | `message_end` with `role:"custom"`, `display` ∈ {true, false, undefined} | reducer processes event | true→1 row; false→0 rows; undefined→1 row (exact `=== false` check) |
| E2 | custom-entry-rendering · truncation ceiling | BVA | L1 | automated | `custom_entry` payload of exactly 200 / 201 lines | reducer builds row body | 200→no marker; 201→body starts `«1 earlier lines hidden»` + last 200 lines |
| E3 | chat-display-preferences · preset defaults | decision-table | L1 | automated | `DISPLAY_PRESETS.simple/standard/everything` | read the two new fields | all three presets: `reasoningInlineFlow===false`, `customEntryFallback===true` |
| E4 | chat-display-preferences · legacy backfill | decision-table | L1 | automated | persisted global `displayPrefs` object lacking both fields | server `backfillDisplayPrefs` | fields resolve `false`/`true` (never `undefined`) |
| E5 | chat-display-preferences · merge arms | equivalence partitioning | L1 | automated | global + sparse override (`{reasoningInlineFlow:true}`, `{}`, `undefined`) | `mergeDisplayPrefs` | override wins when present; global otherwise; `toolCalls` merge unaffected |
| E6 | custom-entry-rendering · replay arms | state-transition | L1 | automated | persisted entries: `custom_message` (display true/false), `custom` (flow-event / generic) | `replayEntriesAsEvents` | display-true→`message_end{role:"custom"}`; display-false→no event; flow-event→flow events only; generic→`custom_entry{customType,data,entryId}` |
| E7 | custom-entry-rendering · live forward exclusion | decision-table | L1 | automated | pi `entry_appended` for `customType` ∈ {"flow-event", "other"} | bridge subscription | "other"→`custom_entry` forwarded with guards; "flow-event"→NOT forwarded |
| E8 | custom-entry-rendering · reducer defense-in-depth | decision-table | L1 | automated | `custom_entry` event with `customType:"flow-event"` | reducer `custom_entry` branch | no `role:"custom"` row created |
| E9 | reasoning-display · inlineFlow prop classes | decision-table | L1 | automated | `ThinkingBlock` with `inlineFlow` absent vs `true` | mount + expand | absent→body has `max-h-[400px]` + `overflow-y-auto`; true→both absent, `overflow-x-auto` kept; auto-collapse timer arms identically in both modes |
| E10 | settings-panel · grouping + placement | decision-table | L1 | automated | SettingsPanel View page, `reasoning` off vs on | render | inline-flow control inside reasoning group, visible+disabled when off, enabled when on; `customEntryFallback` control adjacent to extension-notifications control (DOM order) |
| E11 | custom-entry-rendering · pref kill switch end-to-end | decision-table | L3 | automated | docker-harness session seeded with a custom entry; `customEntryFallback` true then false (via settings UI) | toggle pref in live view | true→custom row visible; false→row disappears; re-enable→row visible again WITHOUT reload/replay |
| E12 | reasoning-display · inline flow end-to-end | state-transition | L3 | automated | docker-harness session with a long reasoning block; `reasoningInlineFlow` toggled on via settings UI | expand reasoning block | body element has no vertical height cap and no inner vertical scrollbar; collapse toggle still works |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | reasoning-display · inline-flow measurement cost | threshold (existing gates) | L3 | automated | transcript with a very long (multi-thousand-line) reasoning block, inlineFlow on vs off | `chat-transcript-virtualization` / `chat-render-perf` gate thresholds (as defined in those specs) | per existing gate harness |
| P2 | custom-entry-rendering · row size estimate | boundary (estimate sanity) | L1 | automated | `role:"custom"` row id in `chat-virtual-rows.ts` | `baseRowSize` lookup | returns an explicit custom arm > default 120px (not the fallback); 200-line body first-paint estimate within the virtualization gate's tolerance |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | custom-entry-rendering · live flow-event non-double-render | state-transition | L3 | automated | docker harness running a live flow (pi-flows appends `flow-event` entries live) | observe chat during flow run | exactly ONE card per flow event (dedicated flow card); zero generic custom cards for `flow-event` |
| F2 | custom-entry-rendering · replay parity | state-transition | L3 | automated | session JSONL containing custom messages + custom entries in known order | reload the session (cold replay) | same custom rows, same relative order, same truncation form as the live view |
| F3 | custom-entry-rendering · visual coherence | visual/subjective | — | manual-only | custom card in a real session | human reviews the card | [judgment: card reads as part of the chat, RawEventCard-family styling "looks right" — no automatable observable] |
| F4 | reasoning-display · inline flow readability | visual/subjective | — | manual-only | live turn with long reasoning, inlineFlow on | human steers mid-turn while reasoning streams | [judgment: reasoning flows readably with the transcript, no nested-scroll disorientation — no automatable observable] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | custom-entry-rendering · non-serializable payload | fault-injection | L1 | automated | `custom_entry` `data` that stringifies badly (e.g. circular ref fed through extraction) | reducer builds row | `String()` fallback body; no throw; row renders with `customType` label |
| X2 | custom-entry-rendering · content-array edge | fault-injection | L1 | automated | `content` array with image parts and empty/missing text | reducer extracts body | `[image]` note emitted per image part; no crash; body non-empty when only images present |
| X3 | custom-entry-rendering · oversized payload | fault-injection (load) | L1 | automated | 10,000-line `appendEntry` payload | reducer builds row | body truncated to the last-200-lines form; no unbounded DOM growth |

---

## Coverage summary

- Requirements covered: 8/8 delta requirements (custom-entry-rendering 5, reasoning-display 1, chat-display-preferences 1, settings-panel 1)
- Scenarios by class: edge 12 · perf 2 · frontend 4 · error 3
- Scenarios by level: L1 12 · L3 5 · — 2 (manual)
- Scenarios by disposition: automated 19 · manual-only 2

## New infra needed

- none — all rows author against existing harnesses (`packages/shared/src/__tests__/`, `packages/extension/src/__tests__/bridge-*.test.ts`, `packages/client` vitest component tests, `tests/e2e/` docker specs)
