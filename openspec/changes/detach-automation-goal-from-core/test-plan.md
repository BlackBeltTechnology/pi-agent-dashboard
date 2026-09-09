# Test Plan — detach-automation-goal-from-core

Stage: design   Generated: 2026-09-08

Adversarial scenario catalog for the generic session-ownership seam. All Triples
are concrete (the one open retention gap was resolved: 60s TTL, no cap, TTL-only
sweep; register-past-TTL → unowned + recovery-eligible is an accepted edge).
No clarifications outstanding.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | `recover` recovery flag (dashboard-plugin-loader: generic-flag recovery) | decision-table + BVA | L1 | automated | six meta states: `{live:t,status:running,recover:false}`, `{…,recover:absent}`, `{…,recover:true}`, `{live:f,…}`, `{status:ended,…}`, `{closedReason:manual,…}` | call `isRecoveryCandidate(meta)` | returns `false, true, true, false, false, false` respectively — reads only `meta.recover`, never `kind`/`goalId`/`pluginRef` |
| E2 | both first-party features opt out symmetrically | static-inspection | L1 | automated | the `automation` and `goal` contribution objects | resolve each contribution's lifecycle declaration | both declare `recover:false` via the identical generic field; core code contains no literal `"automation"`/`"goal"` lifecycle branch |
| E3 | `finalizeOnSocketClose` (declared vs absent) | decision-table | L1 | automated | session A ref declares `finalizeOnSocketClose:true`; session B makes no declaration | socket closes for A then B | A runs finalize path; B does not — decision reads the declared value, not a plugin name |
| E4 | ref cannot overwrite a field it does not own | decision-table | L1 | automated | plugin P files ref `{ goalId:"X" }` but P does not own `goalId` | host merges the ref on resolve | `goalId` is NOT applied from P's ref; a core-reserved key is likewise rejected |
| E5 | emitted keys byte-identical | snapshot | L1 | automated | `automation` files `{kind:"automation",automationRun}`; `goal` files `{goalId}` | resolve + persist `.meta.json` | `kind`/`automationRun`/`goalId` field names + values byte-match the pre-change baseline snapshot; a user session's `.meta.json` carries no `recover` key |
| E6 | three-tier link priority | decision-table | L1 | automated | entry with token T, pid 111, cwd /w; register presents {T,111,/w} then {none,111,/w} then {none,none,/w} | link each | linked by token, then pid, then cwd-FIFO respectively; only the token case assigns a `pluginRef` |
| E7 | stale token degrades to lower tier, no ref | state-transition (illegal edge) | L1 | automated | register presents token U that matches no live entry, but pid/cwd match an unlinked entry | link | falls through to pid then cwd; **no** `pluginRef` assigned by the lower tiers |
| E8 | already-linked entry skipped at every tier | state-transition (illegal edge) | L1 | automated | an entry already carrying a linked sessionId | a second register matches it by token, pid, and cwd | entry is NOT re-linked by any tier |
| E9 | `automationRun` absent from generic context surface | static-inspection | L1 | automated | the `ServerPluginContext` type / `server-context.ts` surface | inspect exported shape | no `automationRun` field is declared on the shared context |
| E10 | **parallel automation spawn — each resolves its own run** (TIER-4 + CWD-1 + RET-2) | decision-table + concurrency-interleave | L1 | automated | **12** automation sessions spawned in parallel into the **same cwd**, each with a distinct token Tᵢ and ref `{kind:"automation",automationRun:runᵢ}`; file→await→register interleaved in arbitrary order | resolve all on register | each session resolves **its own** `automationRun=runᵢ` via its token; none acquires another's; the 9th–12th are NOT dropped by any cap (TTL-only); zero cross-assignment across the shared cwd |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | malformed ref dropped fail-open | fault-injection (bad input) | L1 | automated | plugin files a non-object / malformed `pluginRef` | spawn proceeds, session registers | ref dropped, warn emitted **once per key** (2nd bad file for same key = no 2nd warn), spawn does not throw, session registers **unowned** |
| X2 | register during the spawn await resolves the ref | state-transition (race) | L1 | automated | `spawnPiSession` promise still pending | `session_register` for token T arrives before the await resolves | ref resolved from the token-keyed pending store; resolution does NOT fall through to a lower tier |
| X3 | owner notified before first event AND before pending prompt | ordering / state-convergence | L1 | automated | owned session with a queued pending prompt | session registers | owner-notify callback fires **before** the first `onEvent` forward **and before** pending-prompt dispatch (assert call order via spies) |
| X4 | failed spawn removes only its own token entry | fault-injection (abort) | L1 | automated | tokens A and B both filed; `spawnPiSession` for A rejects | A's failure handler runs | only A's `spawnToken→pluginRef` removed; B's entry intact; a later same-cwd spawn's entry untouched |
| X5 | late failure after a register is a no-op | state-transition (race) | L1 | automated | `session_register` already consumed token A | a spawn-failure result for A arrives afterward | rollback is a no-op; the registered session keeps its resolved `pluginRef` |
| X6 | register past the 60s TTL → unowned + recovery-eligible | BVA (time boundary) | L1 | automated | ref filed at t0; fake-clock advanced to **t0+61s** (just past TTL) so the sweep dropped it | `session_register` for that token | resolves **no** ref (unowned); no pid/cwd fallthrough; session then satisfies `recover !== false` (recovery-eligible) — the accepted edge. Control: register at **t0+59s** still resolves the ref |
| X7 | keeper respawn relinks by `keeperPid` | state-transition | L1 | automated | persisted keeper entry with stable `keeperPid`, stale `piPid`, ref on the entry | tokenless register arrives with a new sessionId + new pi pid, `keeperPid` unchanged | entry relinked to the new sessionId, `piPid` refreshed, respawned session resolves the **same** `pluginRef` |
| X8 | in-process fork does not inherit the owner | state-transition (illegal edge) | L1 | automated | a session forked in-process, minting a tokenless sessionId with no keeper entry of its own | fork registers | does NOT inherit the parent's `pluginRef` |

---

## Coverage summary

- Requirements covered: 8/8 spec requirements (both delta specs), all named scenarios + the resolved retention gap.
- Scenarios by class: edge **10** · perf 0 · frontend 0 · error **8**
- Scenarios by level: L1 **18** · L2 0 · L3 0
- Scenarios by disposition: automated **18** · manual-only 0

Notes:
- No frontend-quirk / rendered-UI scenarios: this change is entirely server-side
  correlation + lifecycle logic; all observables are pure-function returns,
  registry state, callback ordering, and `.meta.json` bytes — deterministically
  unit-testable (L1/vitest) with fake timers and spies.
- No performance scenarios: the spec states no latency/throughput threshold. E10
  asserts **correctness** under concurrency, not a timing budget.

## New infra needed

- none. Optional future hardening: an L3 integration variant of **E10** (real
  parallel automation spawns through the docker harness) would exercise the full
  spawn→register path end-to-end, but the correlation invariants it asserts are
  already covered deterministically at L1. Add only if a real-process regression
  appears.
