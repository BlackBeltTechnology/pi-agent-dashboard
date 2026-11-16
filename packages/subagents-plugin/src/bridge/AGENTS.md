# DOX — packages/subagents-plugin/src/bridge

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `index.ts` | Subagents plugin bridge entry. Exports `SUBAGENTS_FORWARD_DECLARATION` (`subagents:entry`→`subagent_entry`, `subagents:delta`→`subagent_delta`, both `stream` keyed by `agentId`; `subagents:stop_result`→`subagent_stop_result` `latest` key `agentId`; `subagents:registry_snapshot`→`subagent_registry_snapshot` `latest` key `scope`), `combineVerdicts`, `mapProducerStatus`, channel constants and `activate`; declares on activate and on every `dashboard:bridge-ready`. Stop answer: listens on `subagents:stop`, reads `data.verdicts` (pushed SYNCHRONOUSLY by each producer activation, ≥ 0.8.0) in a `queueMicrotask`, combines (`running`>`queued`>`terminal`+status>`terminal`>`unknown`; outcome `stopped` iff queued/running), emits `{agentId,outcome,phase,status?,answeredAt}`; zero verdicts (0.7.0) → nothing. Registry: on bridge-ready, AFTER declare, emits `subagents:registry {answered:0,entries:[]}` and forwards `{scope:"registry",entries,takenAt}` only when `answered>0`; never on plain activation. Producer statuses map `queued`→`created`, `error`/`aborted`→`failed`. Every `on`/`emit` try/catch (a stale runtime's `on` throws). See changes: add-plugin-bridge-contributions, fix-background-subagent-ghost-rows. |
