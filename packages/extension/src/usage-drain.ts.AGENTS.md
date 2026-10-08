# usage-drain.ts — index

Non-message usage drain. `UsageDrain` cursor `{sessionId,lastEntryId}` over `getEntries()`: `baseline(sm)` → seed totals (one snapshot), `drain(sm, send?)` → `usage_recorded` past cursor, cursor advances per entry only after hand-off (throwing send retries next drain) (vanished id / other session ⇒ re-baseline, forward nothing). `drainUsageAndSend` (never throws), `makeCacheWarmingDecisionHandler` (returns `undefined`), `sendShutdownUsageThenUnregister` (drain before unregister). See change: count-non-message-usage.
