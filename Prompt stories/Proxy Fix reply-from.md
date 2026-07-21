# How we did it: Surgical regression fix for fastify reply-from — an AI collaboration guideline

> A reusable playbook from a real pi session. Explains how to diagnose and fix a
> regression where a deleted module left a dependent high and dry, understand why
> tests masked it, and land the fix surgically.

---

## 1. Goal (the ask)

**Original ask:** Start in explore mode and investigate the `reply.from is not a function`
500 error on the `/live/:id/*` endpoint (the mockup/live-preview proxy).

**Real objective (after steering):** Root-cause a regression introduced by a same-day
change (`#342`), consider the fix options (three existed), pick the surgical one,
harden the test to prevent regression masking, implement, and deploy to production.

---

## 2. TL;DR playbook

1. Start in **explore mode** — read the error (500 `reply.from is not a function`) and
   search the codebase for where `reply.from` lives and who registers it.
2. **Trace the dependency**: find the commit that deleted the registrant (`#342` killed
   `editor-proxy.ts`). Confirm `live-server-proxy.ts` still calls `reply.from()` but
   the decorator is now missing.
3. **Investigate test coverage**: read the existing unit test (`live-server-endpoint.test.ts`)
   and discover it self-registers `reply-from`, masking the production regression.
4. **Map the options**: list 3 fix strategies (own the dep, central register, or
   shared lib). Lay them side by side with tradeoffs.
5. **Choose the surgical path**: apply **Option A** — `registerLiveServerProxy` now
   self-registers `@fastify/reply-from` (it's the sole consumer since editor-proxy
   is gone).
6. **Implement + harden test**: edit proxy + test, remove the manual registration
   from the test so the test would *fail* if the proxy didn't self-register.
7. **Verify**: run the test suite (`vitest run …/live-server-endpoint.test.ts`), confirm
   all pass *without* test-side registration. Type-check both files.
8. **Update the record**: edit `live-server-proxy.ts.AGENTS.md` per Documentation Update
   Protocol (`See change:` history).
9. **Stage & commit**: add only the three touched files (ignore unrelated
   `groups.json` / `package-lock.json` changes). Write commit message naming the
   regression + the fix shape.
10. **Deploy**: build the web client (unchanged here, but full sequence), restart the
    server (jiti runs `src/` directly, no server build step), confirm health + uptime.

---

## 3. How the collaboration unfolded

### Phase 1: Exploration & grounding (15 min)

**What the AI did:** Read the error message, searched for `reply.from` and `reply-from`
registrations across the codebase, found the references in `live-server-proxy.ts`,
then grepped for the matching registrant in `editor-proxy.ts`.

**Why it worked:** Concrete searches grounded the investigation in *code facts* before
theorizing. No assumptions. The session started with "let me dig into the actual code."

**Decision point:** User confirmed the goal = explore mode only (no implementing yet).

### Phase 2: Root cause diagnosis (20 min)

**What the AI did:** Pulled the commit message for `#342`, confirmed it deleted
`editor-proxy.ts` (134 lines, the only `fastify.register(@fastify/reply-from)` call).
Traced the timeline: `#225` created `live-server-proxy.ts` *assuming* the decorator
was already installed globally; `#342` deleted the installers.

**Why it worked:** Timeline + git blame took the guesswork out. The regression was
**deterministic** — a concrete deletion, not a subtle bug.

**Discovery moment:** The test suite passed despite the regression because
`live-server-endpoint.test.ts` line 27 self-registers `reply-from`, giving the suite
the dependency prod no longer has. **Tests masked the bug.**

### Phase 3: Options & decision (5 min)

**What the AI did:** Laid out three fix strategies in a table:

| Option | Change | Pros | Cons |
|---|---|---|---|
| **A — own the dep** | `registerLiveServerProxy` registers `@fastify/reply-from` | Self-contained, sole consumer, no "registering twice" caveat | — |
| B — central register | Add one global `fastify.register(@fastify/reply-from)` in cli.ts | Centralizes | Weakens cohesion (live-server-proxy is now hidden dependent) |
| C — shared lib | Extract a `registerProxyPlugins` function | Reusable | Premature abstraction for one consumer |

**Decision point:** User approved **Option A** with a single-word prompt: "A".

### Phase 4: Implementation & hardening (10 min)

**What the AI did:**
- Edited `packages/server/src/live-server-proxy.ts`: added `await fastify.register(require('@fastify/reply-from'))` at the start of `registerLiveServerProxy`.
- Edited `packages/server/src/__tests__/live-server-endpoint.test.ts`: removed the manual `app.register(@fastify/reply-from)` so the test now *relies on* the proxy's own registration (if the proxy doesn't register, the test fails).
- Updated the per-file record: `live-server-proxy.ts.AGENTS.md`.

**Why it worked:** 
- The test hardening is the key move: by removing the test-side registration, we've
  turned the test into a **regression detector**. If someone deletes the proxy's
  self-registration in the future, the test suite will fail immediately.
- Surgical edits (3 lines added, 3 lines removed, comment update) — no unnecessary
  refactoring.

**Verification:** `npx vitest run …/live-server-endpoint.test.ts` → **8/8 pass**
without any test-side registration.

### Phase 5: Commit (5 min)

**What the AI did:** Checked git status, found two unrelated pre-existing changes
(`groups.json`, `package-lock.json`), staged *only* the three changed files:
- `packages/server/src/live-server-proxy.ts`
- `packages/server/src/__tests__/live-server-endpoint.test.ts`
- `live-server-proxy.ts.AGENTS.md`

Committed with a message naming the regression + fix shape.

**Why it worked:** Clean commit history. No noise. Future git blame on those two
files will pinpoint *exactly* when the fix landed, not obscure it with unrelated
changes.

**Decision point:** User confirmed with "commit".

### Phase 6: Deploy (10 min)

**What the AI did:**
1. Checked server build strategy (jiti runs `src/cli.ts` directly, no build step needed).
2. Ran `npm run build` to refresh the client bundle (unchanged, but full sequence).
3. Restarted the server via `/api/restart` endpoint.
4. Polled `/api/health` to confirm the new process took over and was stable.

**Why it worked:** Understanding the server's architecture (jiti-based source-run vs.
compiled dist) meant no wasted build cycles. Polling health post-restart caught the
moment the old process exited and the new one started, confirming the deployment
succeeded.

**Decision point:** User requested "build and deploy" — applied the full sequence
even though only a restart was technically needed.

---

## 4. Prompts that worked

### ✅ Goal prompt: Explore mode + concrete error
```
[skill: openspec-explore]
Enter explore mode. Think deeply. Visualize freely. Follow the conversation wherever it goes.
```

**Why effective:** Explore mode licenses deep investigation without implementation
pressure. The user never said "fix it"; they said "investigate." This opened the space
for tracing the root cause *first*, then choosing the best fix shape, vs. reaching
for a quick patch.

### ✅ High-leverage steer #1: "A"
```
A
```

**Why effective:** Single-word approval of a specific option. Unambiguous. Showed the
user had read the three strategies and made a decision. Cut through the "should we
consider B or C?" loop instantly.

### ✅ High-leverage steer #2: "commit"
```
commit
```

**Why effective:** Moved the session forward one phase at a time (explore → implement
→ verify → commit → deploy). Each checkpoint gave the user a veto point. Prevented
premature deployment of unverified code.

### ✅ High-leverage steer #3: "build and deploy"
```
build and deploy
```

**Why effective:** Delegation of the full deploy sequence. Trusted the AI to know the
server architecture (jiti, no build needed for server, restart only) and still run the
full `npm run build + restart` sequence as requested.

**Stronger version for next time:**
If the user wants faster turnaround, lead with: *"Start in explore mode. Lay out the
fix options as a table. Don't implement until I approve one."* This makes the
three-option table an *expected* output, not a surprise.

---

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|---|---|---|
| Continue investigating beyond root cause | Explicit phase stops ("A", "commit", "build and deploy") | Agree on the phase gates upfront: explore → pick → implement → verify → commit → deploy |
| Assume "run tests locally" would catch regressions | Investigate *why* tests passed despite the bug | Always ask: "Is the test actually exercising prod?" when passing tests contradict error reports |
| Consider over-engineered fixes (central register, shared lib) | Focus on the surgical option (self-register) | Default to making the consumer own its dependency when it's the only one |
| Forget the per-file record update | Reminder within Commit phase | Documentation Update Protocol is non-optional after any code change |
| Stage unrelated changes | Explicit "ignore groups.json" | Always check `git status` and stage only the changed files the fix requires |

**Why these matter:** The biggest win here was *not* implementing Option B or C. Surgical
fixes scale; shared abstractions for single consumers create maintenance debt. The
test hardening was the second-biggest win — it's the difference between a fix that
sticks and one that gets regressed in the next refactor.

---

## 6. Skills, tools & memory created — and why they're effective

**No new skills or memory were created in this session.** The session followed
**existing project conventions**:

- **Explore mode** (openspec-explore skill) — used to ground the investigation before
  picking a fix direction. Reusable for any "what's wrong and what are our options?"
  situation.
- **Documentation Update Protocol** — per-file records (`*.AGENTS.md`) updated inline
  when files change. Ensures git blame + future grepping will find the change context.
- **Phase gates** (explore → implement → commit → deploy) — a rhythm that gives the
  human veto points and prevents scope creep.

**Recommendation for next similar session:** If your team tackles a lot of regression
fixes, consider creating a **`regression-fix` skill** that encodes:
1. Grading the regression's scope (API breaking? Silent data loss? User-facing only?)
2. Test-hardening checklist (does the test rely on external setup that prod won't have?)
3. Surgical vs. central fix decision tree (single consumer → own it; multi-consumer → central)

This would save ~10 min of re-explaining the options every time.

---

## 7. Pitfalls & dead ends

### ⚠️ Pitfall: Test-masking regression bugs
**What went wrong:** `live-server-endpoint.test.ts` self-registered `@fastify/reply-from`,
so the suite stayed green even though production lost its registrant.

**How to avoid it next time:**
- When a test suite passes but production throws, ask: *"What is the test doing that
  production doesn't?"*
- Review test setup — dependencies manually registered in tests (vs. prod) are a
  classic masking pattern.
- **Hardening fix:** remove the test-side registration so the test exercises the
  actual prod path.

### ⚠️ Pitfall: Forgetting jiti-based server architecture
**What went wrong:** Early in Deploy, the AI checked if the server needed a build step.
It does not (jiti runs `src/` directly). But this wasn't immediately obvious from
`package.json`.

**How to avoid it next time:**
- Keep a mental note: *"pi-dashboard server runs TypeScript directly via jiti; no
  server build step needed."*
- Stale `packages/server/dist` is a red herring — it's never deployed.
- **Shortcut:** `npm run build` only builds the client. Server restart = reload source.

### ❌ Dead end: Investigating via `/live/nonexistent/`
**What happened:** Early in the session, the AI tried to hit `/live/nonexistent/` to
reproduce the error locally. Got a 404 before hitting the proxy code.

**Why it's a dead end:** The auth middleware is upstream; unknown IDs 404 before
`reply.from` is called. Not a test of the proxy itself.

**Lesson:** Unit tests beat manual probing for checking internal behavior. The
`live-server-endpoint.test.ts` was the only reliable reproducer.

---

## 8. Reproduce it faster — checklist

**Inputs you need:**
- Current working directory: `/Users/robson/Project/pi-agent-dashboard`
- Dashboard server running or restarted (to verify the fix)
- Git access to `develop` branch

**Steps:**

- [ ] **Explore:** Search `reply.from` and `reply-from` across the codebase. Find who
  registers it and who calls it.
- [ ] **Diagnose:** Git log the registrant's deletion. Confirm it's a recent change
  and the caller still exists in prod.
- [ ] **Inspect test:** Read the test suite. Check if it self-registers the missing
  dependency.
- [ ] **Pick fix:** Use the table from §3 Phase 3. Surgical fixes (own the dep) beat
  central registers for single consumers.
- [ ] **Implement:** Edit the consumer (proxy) to register its dependency. Update the
  test to remove the masking registration.
- [ ] **Verify:** `npx vitest run <test-file>` — confirm 8/8 pass. `npx tsc --noEmit`
  — confirm no type errors.
- [ ] **Update record:** `<file>.AGENTS.md` — add `See change:` note.
- [ ] **Commit:** `git add` only the three changed files. Ignore unrelated changes.
  Write commit message naming the regression + fix shape.
- [ ] **Deploy:** 
  - `npm run build` (client, unchanged but full sequence)
  - `curl -X POST http://localhost:8000/api/restart` (server, source-only change)
  - `curl http://localhost:8000/api/health | jq` (confirm uptime + mode)

**Artifacts produced:**
- Commit `bfd065d44` on `develop` (3 files changed, 12 insertions, 9 deletions)
- Live dashboard restart with fix deployed (zero downtime, jiti reloads source)

---

_Generated from session `019f6b35-83f8-73e8-b7d5-1bcf1d057528` · `/Users/robson/Project/pi-agent-dashboard` · 2026-07-16→2026-07-17._
