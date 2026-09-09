# Tasks — detach-automation-goal-from-core

Scope: seam only (Q1). Automation + goal adopt a generic `pluginRef`; the ten
`server/src/goal/*` files stay in core (relocation is a follow-up).

## 1. Generic session-ownership seam

- [x] 1.1 Add `pluginRef` (opaque, plugin-namespaced) + lifecycle declaration
  `{ recover?: boolean; finalizeOnSocketClose?: boolean }` to the plugin spawn
  path on `ServerPluginContext`; core carries the blob, never parses its interior.
- [x] 1.2 Boundary-validate `pluginRef` on receipt (publish/collect fail-open):
  accept only a plain object; drop + warn **once per key** on malformed; never let
  a ref set a key it does not own (no core-reserved / other-plugin key overwrite).
- [x] 1.3 On resolve, notify the owning plugin with its own `pluginRef` + sessionId.
- [x] 1.4 Remove `automationRun` from the generic `ServerPluginContext` surface
  (`server-context.ts`); automation identity travels only inside its own ref.

## 2. Unified token-keyed pending store

- [x] 2.1 Collapse `pending-goal-link-registry` + `pending-automation-run-registry`
  into one **token-keyed** store (spawnToken → pluginRef).
- [x] 2.2 Retention: preserve the **60s TTL** (`PENDING_*_TTL_MS = 60_000`),
  sweep stale on touch, **no entry cap** (1:1 token map — drop the per-cwd FIFO-8).
- [x] 2.3 File `token → pluginRef` **before** the `spawnPiSession` await; promote
  the ref onto the linked `headlessPidRegistry` entry on first register.
- [x] 2.4 Spawn-failure rollback: token-keyed + idempotent — remove only that
  token's entry; no-op if a register already consumed it (fixes automation's
  missing rollback vs goal).

## 3. Ownership resolution & lifecycle in core

- [x] 3.1 Reorder `session_register` so ref resolution + owner-notify run **before**
  first-event forwarding and pending-prompt dispatch.
- [x] 3.2 Keeper-respawn re-link: a tokenless register whose `keeperPid` still
  matches a persisted keeper entry relinks that entry to the new sessionId and
  refreshes the stale `piPid`; in-process forks inherit nothing.
- [x] 3.3 Cwd tier never assigns `pluginRef` ownership (classification-only).
- [x] 3.4 Replace `isRecoveryCandidate`'s `kind !== "automation"` with
  `meta.recover !== false` (core-owned flag, default `true`); replace the
  `pi-gateway.ts:898` `kind === "automation"` finalize branch with the declared
  `finalizeOnSocketClose`. No plugin name in any core lifecycle branch.

## 4. First-party feature migration

- [x] 4.1 `automation` files `{ kind:"automation", automationRun }` + declares
  `recover:false`; migrate it off the cwd-FIFO stamp tier onto the token seam.
- [x] 4.2 `goal` files `{ goalId }` + declares `recover:false` (symmetric opt-out).
- [x] 4.3 Confirm `.meta.json` / wire / `DashboardSession` keys byte-identical;
  only an opted-out owned session gains the additive `recover:false` byte.

## Tests

Author from `test-plan.md` (all L1/vitest, automated). One test per scenario id.

### Edge-case (packages/*/src/**/__tests__/*.test.ts)

- [x] T-E1 `isRecoveryCandidate` decision table: `recover` false/absent/true ×
  live/ended/manual → `false,true,true,false,false,false`; reads only `recover`.
- [x] T-E2 automation + goal both declare `recover:false` via the same field;
  no literal plugin name in the core lifecycle branch.
- [x] T-E3 `finalizeOnSocketClose:true` finalizes on socket close; absent does not.
- [x] T-E4 ref cannot apply a `goalId`/reserved key it does not own.
- [x] T-E5 emitted `.meta.json` keys byte-match baseline snapshot; user session
  carries no `recover` key.
- [x] T-E6 three-tier link priority: token > pid > cwd; only token assigns a ref.
- [x] T-E7 stale token degrades to pid then cwd, assigning **no** ref.
- [x] T-E8 already-linked entry not re-linked by any tier.
- [x] T-E9 `automationRun` absent from the `ServerPluginContext` surface.
- [x] T-E10 **parallel automation spawn**: 12 sessions, same cwd, interleaved
  file/await/register → each resolves its own `automationRun`; no cap drop; zero
  cross-assignment.

### Error-handling / race (same L1 tier, fake timers + spies)

- [x] T-X1 malformed ref dropped fail-open, warn once per key, spawn survives,
  session registers unowned.
- [x] T-X2 register during the spawn await resolves via token store, no fallthrough.
- [x] T-X3 owner notified before first `onEvent` and before pending-prompt dispatch
  (assert call order).
- [x] T-X4 failed spawn removes only its own token entry; sibling + later same-cwd
  entries intact.
- [x] T-X5 late spawn-failure after a register is a no-op; session keeps its ref.
- [x] T-X6 register at t0+61s → unowned + recovery-eligible; control t0+59s resolves.
- [x] T-X7 keeper respawn relinks by `keeperPid`, refreshes `piPid`, resolves same ref.
- [x] T-X8 in-process fork does not inherit the parent's `pluginRef`.

## Validate

- [x] V1 `openspec validate detach-automation-goal-from-core` passes.
- [x] V2 `npm test` green (all 18 new tests + no regressions).
- [x] V3 Grep confirms no `=== "automation"` / `!== "automation"` lifecycle branch
  remains in core (`session-meta.ts`, `pi-gateway.ts`).
- [x] V4 Diff confirms `.meta.json` identity keys unchanged; only additive
  `recover:false` on opted-out owned sessions.
