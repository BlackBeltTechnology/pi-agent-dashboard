# __tests__/setup/subagents-reducer-slice.ts — index

Vitest `setupFiles` shim (server project): registers the subagents plugin's reducer slice + Agent finalizer so replay suites folding through the client reducer (`memory-event-store`, `collapse-replay-equivalence`) keep asserting the plugin's `SessionState.pluginState` slot (read via `subagentsOf`). Plugin modules imported by relative path. `integration-keep` row (replay contract). Mirror of the client setup file. See change: decouple-plugins-from-core (task 4.10).

Single funnel for server-test → subagents-plugin imports: re-exports `subagentsOf`, `createSubagentsStorePolicy`, `createSubagentsDeliveryPolicy`, `createSubagentsReplayCarry`, `SUBAGENT_END_DEFER_TEXT_BYTES`; owns `createSubagentsPolicyRegistry()` (absorbed deleted `setup/subagents-policies.ts`). Keeps the allowlisted edge single. See change: move-subagents-to-plugin.
