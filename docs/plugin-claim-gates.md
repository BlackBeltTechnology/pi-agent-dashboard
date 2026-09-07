# Plugin Claim Gates: predicate vs. shouldRender

Two manifest fields on `PluginClaim` filter contributions. Differ in intent.

## predicate

- Type: string naming sync exported function `(props) => boolean`.
- Runs at registry filter level (e.g. `forSession`).
- Failing claim removed from slot's claim list entirely.
- Use for structural targeting: claim does not apply to this session/folder/cwd.
- Example: claim targeting only sessions where a predicate over `session` returns `true`.

## shouldRender

- Type: string naming sync exported function `(props) => boolean`.
- Runs at wrapper-gate level (e.g. `forSessionRendered`).
- Failing claim NOT mounted. Counts as absent for `useSlotHasClaimsForSession`.
- Use when claim's Component conditionally returns `null` based on dynamic state.
- MUST be sync. Plugins requiring async state maintain sync-readable cache, default `false` (closed) until populated.
- Example: `shouldRender` returns `false` when a required pi-extension uninstalled. Cache primed from `/api/health.plugins[].requirements`.

## When to pick which

| Symptom | Gate |
|---|---|
| Claim irrelevant for this target by structure | `predicate` |
| Component would render `null` for this target | `shouldRender` |
| Both | declare both |

## Why both exist

`useSlotHasClaimsForSession` answers "would the wrapper subcard show anything?". Without `shouldRender`, claim-exists != claim-renders. Wrapper subcard renders empty translucent panel.

`shouldRender` lets host hide subcard cleanly without speculatively rendering claim's Component.

## Slot-claims invalidation store

Re-render nudge for gate wrappers whose signal resolves after first render. See change: add-blackhole-session-pipeline.

- Store: `packages/dashboard-plugin-runtime/src/slot-claims-invalidation.ts`.
- Exports `bumpSlotClaimsVersion()`, `getSlotClaimsVersion()`, `subscribeSlotClaimsVersion()`, `useSlotClaimsVersion()`, `__resetSlotClaimsVersionForTests()`.
- Version counter starts `0`. Snapshots primitives — `useSyncExternalStore` contract.
- No bump → store inert. Version unchanged, no subscriber fires.

### Problem it solves

- Plugin's late-arriving global gate signal resolves after session cards rendered.
- Idle/ended sessions never broadcast `session_updated` again — the `fix-empty-flows-subcard` scar.
- Mounted gate wrappers on those sessions never re-render. Resolved signal stays invisible without a nudge.

### Mechanism

- Plugin calls `bumpSlotClaimsVersion()` after signal resolves.
- Every mounted gate wrapper re-renders. `shouldRender` re-invoked synchronously.
- Global signal channel only. No per-session payload rides a bump.
- Meaningful only while host and plugin client entries resolve ONE `dashboard-plugin-runtime` module instance. Holds under hoisted workspace + Vite resolution today.

### Who subscribes

- `useSlotHasClaimsForSession` subscribes via `useSyncExternalStore` in `slot-consumers.tsx`.
- Hook invoked BEFORE registry-null early return — rules of hooks. Late bump re-renders wrapper with or without registry.
- Session-scoped consumers subscribe too. Wrapper calls `useSlotClaimsVersion()`, then renders via `forSessionRendered`: `SessionCardBadgeSlot`, `SessionCardActionBarSlot`, `SessionCardMemorySlot`, `SessionCardFlowsSlot`, `WorkspaceActionBarSlot`, `ContentHeaderStickySlot`, `ContentInlineFooterSlot`.
- `ContentViewSlot` subscribes for one-active predicate re-evaluation. Plugin navigation flips predicate in module state; bump re-evaluates without session broadcast.

## Boot-gate pattern (blackhole reference)

`shouldRender` gate over a plugin's boot check. Async resolve, fail closed, bump on success. See change: add-blackhole-session-pipeline.

### Client — `packages/blackhole-plugin/src/client/installed-gate.ts`

- `shouldRenderMemorySubcard()` reads module-level boolean synchronously. Returns `installed === true`.
- Default `null` → fails closed until resolved.
- `resolveInstalled({fetchImpl})` fetches `GET /api/plugins/blackhole/status`.
- Transient failure retries: capped backoff (`backoffMs`, default 1s/2s/4s), then `slowIntervalMs` ~60s until first success.
- Never gives up. No re-poll after success.
- Success finalizes value, calls `bumpSlotClaimsVersion()` once, stops polling.
- One polling chain at a time. Second kick (e.g. HMR) replaces first.
- Module-scope kick in `packages/blackhole-plugin/src/client/index.tsx`. Guarded by `isTestEnvironment()` — `import.meta.vitest` / typeof-guarded `process.env.VITEST`. No network request under vitest.
- `fetchImpl` injectable. Tests inject; production uses global fetch.

### Server — `packages/blackhole-plugin/src/server/index.ts`

- `GET /api/plugins/blackhole/status` answers `{ installed }`.
- Default source: `ServerPluginContext.isPiExtensionInstalled` capability.
- Capability optional, new: `packages/dashboard-plugin-runtime/src/server/server-context.ts`.
- Wired in `packages/server/src/server.ts` via `createIsPiExtensionInstalled` (`packages/dashboard-plugin-runtime/src/server/installed-probe.ts`).
- Probe unions global + local `listInstalled`. Matches by `installedMatchesName`. Success-only cache, ~30s TTL. Scan failure rejects — never resolves `false`.
- Capability absent → config-file existence fallback only.
- Capability rejection → 503. Never `{installed: false}` — client would finalize rejection into resolved `false`, holding gate open forever.

## See

- `packages/shared/src/dashboard-plugin/manifest-types.ts` (`PluginClaim` interface)
- `packages/dashboard-plugin-runtime/src/slot-registry.ts` (`ClaimEntry`, `forSessionRendered`)
- `packages/dashboard-plugin-runtime/src/slot-consumers.tsx` (`useSlotHasClaimsForSession`)
- `packages/dashboard-plugin-runtime/src/slot-claims-invalidation.ts` (slot-claims invalidation store)
- `packages/blackhole-plugin/src/client/installed-gate.ts` (reference boot gate)
- `packages/dashboard-plugin-runtime/src/server/installed-probe.ts` (`createIsPiExtensionInstalled`)
- `openspec/changes/auto-hide-empty-session-subcards` (architecture rationale)
- `openspec/changes/add-blackhole-session-pipeline` (architecture rationale)
