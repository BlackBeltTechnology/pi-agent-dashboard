## Context

Four independent client fixes sharing one change because each is a small UI-state correctness bug. Only decisions with real alternatives are recorded.

## Decisions

### D1 — Token arrow convention (confirmed, owner, 2026-11-20)

| Option | Result |
|---|---|
| A: `↑ input/sent`, `↓ output/received` everywhere | Matches `SessionCard`, `OpenSpecBoardView`, `MinimalChatView`, `FlowAgentCard` + specs; flips `TokenStatsBar` (+ `SessionSidebar`) |
| B (chosen, owner): `↓ input`, `↑ output` everywhere | Matches `TokenStatsBar` (`:40-44,105-106`), `SessionSidebar` (`:109-110`) and the `token-stats-bar` spec unchanged; flips `SessionCard.tsx:474` (`TokenStats`), `OpenSpecBoardView.tsx:1386`, `MinimalChatView.tsx:405` (`client-utils`), `FlowAgentCard.tsx:106` (`flows-plugin`) and their specs |

Chosen B (confirmed, owner, 2026-11-20): the owner's reading of the issue is that the header (`TokenStatsBar`) is right and the rest are inverted. Suffix-style renderers swap in place (`{in}↓ {out}↑`); prefix-style swap in place (`↓{in} ↑{out}`). Specs MODIFIED: `flow-agent-card`, `flow-agent-detail`, `flow-card-grid`, `shared-timeline-view`, `openspec-card-section` (the latter states `48k↑ 12k↓` for the `OpenSpecBoardView` session row). `token-stats-bar` is not touched. Cache-read stays added to the input counter. The Electron `resources/` copies of `FlowAgentCard.tsx` are bundled build output, not edited.

### D2 — Card error label, ended sessions untouched (confirmed, owner, 2026-11-20)

`activityContent` gains a `hasError` arg; the `Failed` label replaces only the final `Idle` label (idle/active status with `hasError`): resuming, ended, needs-you, retry, current-tool and streaming keep precedence, because `lastError` persists across an agent continuation (`event-reducer.ts:1861`) and a live tool/thinking label is the more current fact. Ended sessions keep the ended-reason pill and the ended bucket (process gone is the more actionable fact). Alternative: route ended+error to the `error` lane — rejected for now (changes the lane spec "non-ended sessions" and dead-session triage).

### D3 — Visible failure for overlay claims

`SlotErrorBoundary` gains an optional `fallback` prop (default `null`, so every other slot is unchanged); `ShellOverlayRouteRender` passes an error panel with Back. Alternative: a generic non-null default for all slots — rejected, would surface errors in sidebar/badge slots.

### D4 — Chip address text (confirmed, owner, 2026-11-20)

Show `127.0.0.1:<port><path>` as secondary text: host is the fixed probe host (S29: never agent-announced), not chip data. Alternative: keep bare `:port`.
