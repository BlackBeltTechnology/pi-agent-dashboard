# DOX — packages/subagents-plugin/src/client

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `index.tsx` | Client package entry. Re-exports `SubagentDetailView`, `SubagentPopoutPage`, `SubagentPopoutClaim`, `SubagentsSettings`, and types `SubagentTimelineEntry`/`SubagentState`. Phase 1 placeholder for slot-claim move under extract-subagents-as-plugin. |
| `SubagentDetailView.tsx` | Thin adapter shim over `MinimalChatView`. Maps `SubagentState` → `MinimalChatViewProps`. Exports `SubagentDetailView`, `SubagentDetailViewProps`, `SubagentDetailMode`, `SessionStateLike`. Preserves four-tier rendering (entries / completed-no-entries fallback / empty). Props: `session`, `agentId`, `mode` (`inline`/`popout`/`row`), `onBack`, `sessionId`. |
| `SubagentPopoutClaim.tsx` | Slot-claim wrapper for `shell-overlay-route` `/session/:sessionId/subagent/:agentId`. Exports `SubagentPopoutClaim`, `SubagentPopoutClaimProps`. Reads `params.sessionId`/`params.agentId`, subscribes cold-open via `usePluginSend` after `useShellConnectionStatus` === `connected`, reads subagents via `useSessionSubagents`, renders `SubagentPopoutPage` body. |
| `SubagentPopoutPage.tsx` | Fullscreen route content for `/session/:sid/subagent/:aid`. Exports `SubagentPopoutPage`, `SubagentPopoutPageProps`. Renders `SubagentDetailView` in `popout` mode plus chrome header. Empty states: loading (subscription unresolved), parent not found, subagent not in map. Sets `document.title`. Body uses `min-h-0` for scroll. |
| `SubagentsSettings.tsx` | Subagents settings panel. Disclaimer rewritten: Roles soft runtime relationship, not manifest dependsOn; unconfigured `@fast` degrades to "not configured yet" at spawn; Subagents still loads. See change: roles-standalone-defaults-and-local-install-detection. inheritContext toggle buffers; commits `POST /api/config/plugins/subagents` on unified Save (registers `plugin:subagents`). See change: unify-settings-save-contract. |
| `types.ts` | Wire-protocol types for subagents plugin. Exports `SubagentTimelineEntry` (discriminated union: `tool`/`text`/`thinking`/`error`) and `SubagentState` (id, type, status, result, entries, activity, displayName, modelName, agentMdPath, etc.). Producer: pi-dashboard-subagents extension. |
