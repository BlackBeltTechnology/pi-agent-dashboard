# ui-bridge.ts — index

`createUiBridge`: `store.on(change)` → ≤1 `plugin_event` `agent-teams:changed {teamId, epoch, rev, closed?}` per team per 1000 ms (leading + trailing, session-scoped to the lead, content-free, close frame last, per-team state only while a window is open); lead stamp `agent-teams-lead:{teamId}` (`assignSessionRef`, persist) via idempotent `reconcileStamp`, clear = `{teamId:null}`, failure logged once + retried (back-off on plain change); every listener isolated; `dispose()` unsubscribes. See change: add-agent-teams-ui.
