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

## See

- `packages/shared/src/dashboard-plugin/manifest-types.ts` (`PluginClaim` interface)
- `packages/dashboard-plugin-runtime/src/slot-registry.ts` (`ClaimEntry`, `forSessionRendered`)
- `packages/dashboard-plugin-runtime/src/slot-consumers.tsx` (`useSlotHasClaimsForSession`)
- `openspec/changes/auto-hide-empty-session-subcards` (architecture rationale)
