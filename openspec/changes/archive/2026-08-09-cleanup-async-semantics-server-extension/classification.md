# Site classification — cleanup-async-semantics-server-extension

Design D8 requires each site's chosen fix to be recorded, for two consumers:
`add-typeaware-lint-gate`'s severity decision, and `review-code`, which needs to
see intent per site rather than infer it from a 60-site diff.

Counts re-derived from Biome at implementation time, not copied from the
proposal. **54 floating + 6 misused = 60 sites**, not the 61 the design assumed:
`tunnel-core.ts:160` was absorbed by `cleanup-client-plugin-promises` before this
change started (confirmed — the file reports no floating diagnostic).

## Distribution by fix type

| Fix type | Sites | Where |
|---|---|---|
| `await` (test file, settle after assertions) | 37 | all `packages/extension` sites |
| `await` (production, matches surrounding convention) | 1 | `browser-gateway.ts` shutdown dispatch |
| `await` + `.rejects` (test file, genuinely rejecting) | 1 | `visitor-session-registry.test.ts` |
| `.catch(handler)` (production) | 9 | server: subscription-handler ×3, server.ts ×2, directory-handler ×2, both worker pools ×2 |
| `.catch(handler)` (production, HTTP 500 path) | 1 | `recovery-server.ts` |
| `.then(resolve, handler)` (CommonJS) | 1 | `keeper.cjs` |
| `: void` return annotation (non-promise artifact) | 3 | `pi-resource-activation-timeout.test.ts` |
| `!== null` narrowing (misused, behaviour-preserving) | 2 | electron inflight guards |
| wrapper `() => { void p.catch(h) }` (misused) | 4 | electron `createTray` ×4 — **one wrapper**, `requestQuit`, applied 4× |
| same wrapper reused (floating) | 1 | electron `main.ts` `window-all-closed` — was a floating `quit()` |
| **total** | **60** | |

The electron rows are 7 sites but only **one** new function: `requestQuit`
covers the 4 misused `createTray` arguments and the 1 floating
`window-all-closed` call, and the 2 remaining sites are narrowings.

Bare `void` used: **0**. Verified mechanically and continuously by test-plan #E3
(`scripts/__tests__/async-semantics-guards.test.mjs`), which holds the live
bare-`void` multiset to a subset of the frozen pre-change baseline.

## Notes for the severity decision

- **The test-file population dominates.** 41 of 60 sites are test files, and 37
  of those are one pattern (`bus.request(...)` left deliberately in flight). A
  severity flip's real-world cost is therefore mostly borne by test code, not by
  production hot paths.
- **`PromptBus.request` has no reject path** (`new Promise((resolve) => …)`), so
  none of those 37 sites could ever have produced an unhandled rejection. The
  rule flagged a shape, not a defect. Expect a similar false-positive rate
  wherever a promise-returning API cannot reject.
- **Two production fixes are dead-defensive**, kept because the rule demands an
  owner rather than because a rejection is reachable:
  - `openspec-poll-worker-pool.ts` — `fallbackSettle` try/catches its own
    derivation, so the outer handler is unreachable.
  - `keeper.cjs:141` — `startServer` always resolves, so the `onRejected` branch
    is unreachable by construction.
  Neither is testable behaviourally; both are documented at the site.
- **One fix was load-bearing beyond silencing the rule.**
  `subscription-handler.ts`'s handler clears the `markReplaying` suppression
  flag. Without it a replay that died mid-flight left that socket permanently
  muted for the session — a real, previously-unowned bug the rule surfaced.
- **`await` was preferred over `.catch` only once** in production
  (`browser-gateway.ts`), because every sibling `case` in that switch already
  awaits and the dispatch sits inside a `try`/`catch`. Everywhere else
  `.catch(handler)` avoided serializing a path, per D1.

## Verification gap carried forward

`packages/electron` is **not** in the root vitest projects and no `ci.yml` step
runs `cd packages/electron && npm test`, so scenarios E4, E5 and X14 do not
execute in CI. They pass locally. The exclusion is pre-existing and explicitly
tracked as a separate cleanup in `vitest.config.ts`; this change does not widen
it. The graduation oracle (#E6) is unaffected — `ci.yml` runs `biome lint .`
repo-wide, which does cover `packages/electron`.
