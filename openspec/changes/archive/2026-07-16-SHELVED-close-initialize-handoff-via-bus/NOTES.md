# SHELVED — do not re-propose (never implemented)

**Status:** SHELVED at planning, pre-commit, pre-implementation (2026-07-16).
**Reason:** two independent adversarial doubt-reviews (Claude-family single-model +
GLM-5.2 cross-model via `@propose-review-1`) converged that the design's core
mechanism is incoherent with the shipped server, the security resolution defeats
the change's own goal, and the value premise is largely false. The
value/complexity ratio collapsed. Archived as a record so the idea is not
re-proposed without addressing these findings.

## The idea (for context)

Add an optional Step 8 to the `project-init` skill: after scaffolding, use the
shipped `@blackbelt-technology/pi-dashboard-bus-client` to `connect()` → trigger
the `worktreeInit` hook → await idle → report "configured AND provisioned",
closing the "click Initialize again" handoff in one pass. Degradable when the bus
is unreachable.

## Why it was shelved — findings (verified against code)

### 1. The trigger→await mechanism does not exist as designed
- **Plain `spawn({cwd})` does NOT fire the `worktreeInit` hook.** The spawn handler
  (`packages/server/src/browser-handlers/session-action-handler.ts`) has no
  worktree-init path. Worse: the dashboard's Initialize spawn passes
  `initialPrompt:"/skill:project-init"`, so a naive `spawn({cwd})` from Step 8
  would **re-launch project-init** (recursion), not provision. Mechanism "1A" is
  dead on arrival.
- **`POST /api/git/worktree/init` emits `worktree_init_done`/`_failed` keyed by
  `requestId`+`cwd`** (`git-routes.ts:470-483`), NOT a `SessionStatus` transition.
  The bus-client's `until(sid,"idle")` only observes `session_added`/
  `session_updated` status. There is **no bus primitive** to await
  `worktree_init_done`. Mechanism "1B" cannot await completion without a new
  bus-client primitive that does not exist today.

### 2. TOFU trust gate — auto-provisioning defeats the security model
- A freshly-written hook is untrusted. `POST /worktree/init` is TOFU-gated: an
  untrusted hook returns `init_untrusted{hook,hash}` **without running**
  (`git-routes.ts:446`); execution needs a client `confirmHash`.
- Auto-confirming a hook the skill just wrote **bypasses the human TOFU gate** the
  codebase deliberately installs — and **poisons the durable trust store**
  (`~/.pi/dashboard/worktree-init-trust.json`, `recordTrust(..., "project")`), so
  the next *manual* Initialize click runs the hook with no prompt. Step 8 is NOT
  side-effect-free.
- Resolving this properly requires an explicit per-hook trust-confirm step —
  which **defeats the change's entire "no second click" goal.**

### 3. The value premise is largely wrong
- project-init's `worktreeInit` hook runs only `{{INIT_COMMAND}}` (e.g. `npm ci`).
- **kb indexing** is the *kb-extension's own separate* worktree-init hook (fires
  regardless), NOT project-init's hook.
- **openspec init** is a Step-6 CLI that **already runs inline** during the
  project-init session — never deferred to click #2.
- So the deferred work the proposal wanted to "provision + verify" is essentially
  just `npm ci`; the headline benefit (index + openspec wiring in one pass)
  largely does not exist.

### 4. Degradation contract is unimplementable with the shipped API
- `connect()` takes **no args**; `BusClientOptions` has **no `timeout`**. D2's
  `connect({timeout:SHORT})` is fictional — no bounded connect; it can hang to the
  OS TCP timeout.
- `connect-failed` is in the `BusErrorCode` union but is **never thrown**; the
  common failure cases surface as a raw `Error` / `BusTimeoutError` /
  `TicketExpiredError`, which D2's `catch off-box/connect-failed → else rethrow`
  would **rethrow** — violating the "skip WITHOUT error" contract exactly on the
  transient failures it claims to degrade on. Contract 5 (timeout → "still
  running") also directly contradicts D2's "else rethrow".
- `discoverHost` honors `DASHBOARD_HOST` env — a silent escape hatch that breaks
  the "loopback only" invariant.

### 5. Idempotency + gating assumptions don't hold
- `init-status` **withholds `needsInit`** when `trusted:false` (`git-routes.ts:371`).
  After a fresh scaffold the hook is untrusted, so the design's "read init-status;
  if `needsInit:false` skip" cannot evaluate. Also `needsInit` reflects the gate
  (e.g. `test ! -d node_modules`), not "did provisioning run" — wrong semantics
  for "already provisioned".
- The `docs` profile **does** ship a `worktreeInit` hook (gate `"false"`), so the
  "docs has no hook, step is a no-op" gating claim is false; the real gate is hook
  *presence*, and if stack detection fails the coding placeholders survive and
  Step 4 hook-validation already fails.

## If ever revisited, the prerequisites are

1. A new bus-client primitive to await `worktree_init_done`/`_failed` by `cwd`
   (the current `until`/`await`/`read` cannot observe it).
2. A resolution of the TOFU trust gate that does NOT auto-confirm a just-written
   hook and does NOT poison the trust store — which realistically reintroduces an
   explicit confirmation step (killing the "one click" motivation).
3. A real, deferred value payload worth automating (the current one is ~`npm ci`).

Absent all three, the change is not worth its complexity. Shelved.
