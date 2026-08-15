# `toolDetails` consumer audit (task 8)

Question: does any consumer of the raw `toolDetails` object stored on the
message row (`event-reducer.ts:1893`) depend on **mid-run** `details.entries`?

Method: every `toolDetails` reference plus every non-`Object.entries` `.entries`
reference across `packages/*/src`, minus tests.

## Consumers of the subagent timeline

| Consumer | Reads | Tolerates absent `entries` mid-run |
|---|---|---|
| `client/src/lib/chat/event-reducer.ts:409` | frame `details.entries` | YES — by construction. The D3 empty-array overwrite guard only assigns when the incoming array is non-empty, so an absent/empty `entries` leaves the accumulated timeline intact. Pinned by `thin-subagent-frame-reducer.test.ts`. |
| `subagents-plugin/src/client/SubagentDetailView.tsx:118` | reducer STATE `sub.entries` | YES — `hasEntries` guard renders the scalar view when empty. Reads state, never the raw row. |
| `client/src/components/tool-renderers/AgentToolRenderer.tsx` | reducer STATE `sub.entries` | YES — used only for the resync predicate and the cadence entry count. |
| `client/src/App.tsx:978` | reducer STATE `sub.entries` | YES — an empty timeline is the resync TRIGGER, not an error. |

## Consumers that read `toolDetails` but NOT the timeline

`ToolCallStep.tsx` (`healedBy`), `ToolBurstGroup`, `ChatView`,
`AskUserToolRenderer` (`results`), `flows-plugin/FlowAgentsToolRenderer`
(`agents`/`count`), `dashboard-plugin-runtime/slot-consumers`. None touches
`entries`.

## Non-consumers

- **`session-distiller`** — reads no `toolDetails` and no `entries`; the
  artifact body is produced by a subagent from the transcript.
- **Exports / plugins** — no `entries` reader outside the four rows above.

## Verdict

No consumer requires mid-run `entries`. Every reader either goes through the
reducer state (which accumulates and never un-fills) or ignores the timeline.
No fix required; nothing to document as degraded beyond the spec's already
stated mid-run replay change.
