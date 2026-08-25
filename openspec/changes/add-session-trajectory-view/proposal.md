## Why

The chat transcript is a *reading* surface. It renders a conversation — bubbles, thinking panels, tool cards, burst groups — optimized for following along. That is the right default and should not change.

It is the wrong surface for **auditing**. When a session went sideways, or when the question is "what exactly did the model do, in what order, and how long did each step take", the transcript is 400 rows of variable-height prose in which every record is shaped differently and nothing is index-addressable. There is no way to scan, no way to compare two tool calls, no way to jump to record #147, and no way to see a session's shape at a glance.

`deepseek-ai/deepseek-harness` ships a second surface for exactly this: `packages/client/ui-trajectory`, a turn-aware **event ledger**. One fixed-height row per record, index-addressed, with all detail pushed into a side inspector. It is a debugger view, not a reading view. The design is sound and worth adapting; the code is not portable (it binds to that project's `ConversationNode`/`RequestView` runtime model and a `'conversation.view'` slot ring, neither of which exists here).

This change adapts the *design* onto the dashboard's own event model, using only data the wire already carries.

## What Changes

A session gains a second selectable surface beside chat: the **Trajectory tab**.

- **Ledger.** One fixed-height row per record: `#index`, kind badge, single-line summary. Virtualized. Thick rules mark turn boundaries; compact inline markers identify steps. No bubbles, no variable heights, no markdown rendering in the row itself.
- **Kind taxonomy.** `system | user | context | compacted | message | tool | subtool`, derived from `DashboardEvent.eventType`. `subtool` folds subagent records inline at their nesting depth rather than stranding them in a separate timeline.
- **Inspector.** Selecting a row opens a side panel with tabs: Summary, Payload, Result, Timing. The row stays a single line; everything else lives here. Resizable, closable.
- **Toolbar.** Search across the loaded window, fold turns, fold calls, and a duration toggle.
- **Timing is honest or absent.** Durations are derived from `DashboardEvent.timestamp` deltas only. A record whose duration cannot be derived renders `—`, never a fabricated span. In-flight records show a start marker and no duration.
- **Paging.** Opens at the tail and reuses the existing windowed-replay machinery; the ledger covers unloaded history with an explicit control rather than pretending the session starts where the window does.

Not in scope, deliberately deferred:

- The **waterfall / timeline overview** (gantt with TTFT-vs-decode spans, wheel-zoom, drag-to-filter). It is deferred to `add-trajectory-timeline-overview` because on today's wire data it would degrade to "start markers with mostly-unknown spans" — see `add-prompt-snapshot-audit-trail`, which supplies the real durations that make it honest.
- Any capture of the system prompt or tool catalog. That is `add-prompt-snapshot-audit-trail` and carries a security decision this change does not.
- Replacing or restyling the chat transcript. Chat remains the default surface and is untouched.

## Capabilities

### New Capabilities

- `session-trajectory-view`: the tab itself — record projection from `DashboardEvent`, the kind taxonomy, turn/step boundary derivation, ledger ordering, index stability across history prepends, and the honest-duration rule.
- `trajectory-inspector`: the detail panel — tab set, content resolution per record kind, resize/close behavior, and what an inspector shows for a record whose detail was truncated by the event store.
- `trajectory-navigation`: search, fold-turns, fold-calls, selection, and paging into unloaded history.

### Modified Capabilities

- `chat-view`: the session surface becomes selectable; states which surface renders and what the tab control does.
- `chat-display-preferences`: adds trajectory-specific preferences (default surface, duration display).

## Impact

- `packages/client/src/components/trajectory/` — new: ledger, row, inspector, toolbar.
- `packages/client/src/lib/` — new: pure projection from the reduced event stream to trajectory records, plus the virtual-row grouping rule (separator-only records must ride the next measurable row; a zero-height virtualizer item is a known hazard this project has hit before).
- `packages/client/src/components/session/` — the surface tab control.
- **No wire changes. No server changes. No extension changes.** This is deliberate: it ships value standalone and de-risks the UI before the telemetry work lands.
- **Truncation honesty**: `memory-event-store` caps string fields at `DEFAULT_MAX_STRING_SIZE` (4 KB) and collapses superseded updates. The inspector renders records that were truncated *as truncated* — it must never present a capped payload as if it were complete. An audit surface that silently lies is worse than no audit surface.

## Discipline Skills

- `review-code` — multi-component client change with a new projection layer; non-trivial and worth a pass before it stands.
- `performance-optimization` — a dense virtualized ledger over sessions with up to `DEFAULT_MAX_EVENTS_PER_SESSION` (20 000) records is a measured-budget path. This project has an existing scar (`fix-chat-scroll-to-top-estimate-drift`) from estimate drift in exactly this machinery; measure before building.
- `code-simplification` — the reference implementation is ~10.5 k LOC with a 3 074-line table component. The adaptation should be a fraction of that; if it starts converging on those numbers, stop and reconsider.
- `doubt-driven-review` — the record projection and kind taxonomy are the load-bearing decisions every later phase builds on. Stress-test them while they are still cheap to change.
