# lineDelta.ts — index

Per-turn +/- line-delta derivation from Edit/Write events (jsdiff `structuredPatch`, no git). Exports `LineDelta`, `editDelta(oldText,newText)`, `toolCallDelta(msg)`, `TurnFileSummary`, `TurnSummary`, `buildTurnSummaries(messages)`, `turnFileDeltas(messages)`. Feeds `ChangeSummaryBlock`. See change: add-change-summary-table.
