# DOX — packages/client/src/lib/package

Files in this directory. One row per source file. See change: fold-oversized-agents-directories.

| File | Purpose |
|------|---------|
| `anthropic-peer.ts` | Shared peer constants + `derivePeerState(healthBody)` → `{missing, resolving, importFailed, reason}`. Reads ONLY legacy key `@pi/anthropic-messages`; every unknown shape all-false (fail-open). Exports `ANTHROPIC_PEER_SOURCE`, `ANTHROPIC_PEER_ENTRY_ID`, `IMPORT_FAILURE_PREFIX`. Used by `useAnthropicPeerProbe` + `peer-auto-install-store`. See change: streamline-first-run. |
| `installed-list-helpers.ts` | Pure client helpers for installed-packages UI. Exports `computeDestIdentity(source)` — mirrors server… → see `installed-list-helpers.ts.AGENTS.md` |
| `package-classifier.ts` | Pure helpers for unified packages settings UI. Exports `SourceType` (`npm`\|`git`\|`local`\|`global`),… → see `package-classifier.ts.AGENTS.md` |
| `package-queue.ts` | Package operation FIFO scheduler singleton — single source of truth for extension AND pi-core ops (`kind` discriminator, `pi-core:<name>` source prefix, dual `pi-package-event`+`pi-core-event` subscription)… → see `package-queue.ts.AGENTS.md` |
| `packages-api.ts` | Fetch helpers for package endpoints not owned by `package-queue`. → see `packages-api.ts.AGENTS.md` |
| `peer-auto-install-store.ts` | Module-level store for the auto `pi-anthropic-messages` install after Anthropic sign-in. `peerAutoInstallStore.ensureInstall(trigger)` (single entry; sets `deciding` sync, 2 fresh reads bounded 20 s, vetoes import-failure/resolving/no entry/`activeInPi`, follows a pending install, else enqueues constant source, scope `global`), `retry`, `reset`, `notifyPeerResolving`; `usePeerAutoInstall()`, `usePeerAutoInstallReset(anthropicAuthenticated)` (true→false only). Subscribes to `packageQueue` at load; `seq` guards late results. See change: streamline-first-run. |
| `plugins-api.ts` | Client-side fetch helpers: `listPlugins()` (`GET /api/plugins`), `togglePlugin(id, enabled)` (`POST… → see `plugins-api.ts.AGENTS.md` |
| `tool-install-deeplink.ts` | Deep-link bus between `MissingToolInlineError` and `ToolsSection`. → see `tool-install-deeplink.ts.AGENTS.md` |
