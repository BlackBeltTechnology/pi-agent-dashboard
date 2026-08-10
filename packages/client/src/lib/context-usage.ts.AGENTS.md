# context-usage.ts — index

Exports `buildContextUsageMap(sessionStates, sessions): Map<string, ContextUsageInfo>`. Two-tier derivation: live event-reducer `state.contextUsage` wins; else persisted `session.contextTokens` + `session.contextWindow`. Shared source consumed by session card + content header so both show same context usage. `App.tsx` `contextUsageMap` useMemo calls it; `selectedContextUsage` = `contextUsageMap.get(selectedId) ?? selectedState.contextUsage`. See change: align-content-header-context-usage.
