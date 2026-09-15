# DOX — packages/server/src/__fixtures__

| File | Purpose |
| --- | --- |
| `recorded-agent-tool-update.json` | One `tool_execution_update` captured VERBATIM off the live browser gateway (Agent tool, nested `data.partialResult.details.agentId`). Feeds #E1/#E2 in `session/__tests__/open-tool-calls.test.ts` — a hand-shaped fixture could encode the wrong path and go green while production stays broken. See change: heal-orphaned-tool-cards-on-session-end. |
| `measured-session.json` | Measured-shape session rows (one live with populated `notifyLog`, one ended), PII-scrubbed. Feeds the snapshot 400 KB bound test (E18/P1) and the `notifyLog`-strip DOM test (F5). See change: fix-connect-snapshot-frame-loss. |
