# Test Plan — add-oauth-key-sync-service

Stage: apply   Generated: 2026-08-19

Derived from `specs/**/spec.md` (107 scenarios), `design.md` (D1–D14), and the doubt-review
findings that reshaped both. Stance is falsification: the rows below are chosen to make an
observable come out *wrong*, not to confirm the happy path.

Two rows carry outsized weight. **X1** (single refresher across process instances) guards the
only irreversible failure this system can produce — a revoked token family kills the account for
every member simultaneously. **X4** (late refresh response persisted) guards the failure that is
silent: an account that quietly stops working while its owner is offline by design.

## ⚠ Clarifications needed (8)

- [ ] **C1** — *Enrolment capture mechanism* (blocks E20–E23, X12–X14, F8–F10). pi exposes no
      non-interactive login (design F8), so the mechanism is spike-selected from three candidates.
      Until the spike lands, no enrolment scenario has a concrete INPUT slot. **Resolved by
      Migration step 0, not by asking.**
- [ ] **C2** — *Do providers issue independent concurrent grants per authorization?* (blocks X15).
      Decides whether a member may keep using an account locally after enrolling it. If grants
      prove exclusive, enrolment must take ownership and X15 becomes a *prohibition* test instead.
      **Also Migration step 0.**
- [ ] **C3** — *Maximum request body size above which rotation is disabled* (blocks E14, P3).
      Named as open in design D5. Candidates: 1 MB / 4 MB / 10 MB. Without a number the
      just-above-threshold row has no INPUT.
- [ ] **C4** — *Cooldown ceiling that clamps `retry-after`, and the default when absent* (blocks
      E10–E12). Candidates: ceiling 15 min / 1 h; default 60 s / 5 min.
- [ ] **C5** — *How does the client plugin authenticate to management routes?* (blocks F5–F7).
      Member keys are proxy-only by spec, so a better-auth session is required and the mechanism
      for a pi-session plugin to obtain one is unspecified.
- [ ] **C6** — *What is the stable per-account identity used for duplicate detection?* (blocks
      E22). OAuth credentials are opaque and re-authorising yields fresh tokens, so token equality
      cannot serve.
- [ ] **C7** — *Which provider id does the member's keysync entry use?* (blocks X16). Reusing
      `anthropic` overwrites the original credential and makes the rollback promise false.
- [ ] **C8** — *Latency budget for the added proxy hop* (blocks P1, P2). Design asserts streaming
      "passes through without buffering" but names no threshold. Candidate: added TTFB p95 < 150 ms
      over direct-to-provider.

> C1 and C2 are resolved by the Migration step 0 spikes, not by a decision. The rest are values
> the design must name before the blocked rows can be authored.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | rotation-toggle: AND gate | decision-table | L1 | automated | admin=on, member=on, 2 healthy accounts, first returns 429 | request forwarded | rotates to second account; response is 200 |
| E2 | rotation-toggle: AND gate | decision-table | L1 | automated | admin=on, member=off, same setup | request forwarded | no rotation; 429 relayed to client |
| E3 | rotation-toggle: AND gate | decision-table | L1 | automated | admin=off, member=on, same setup | request forwarded | no rotation; 429 relayed — member preference cannot override admin |
| E4 | rotation-toggle: AND gate | decision-table | L1 | automated | admin=off, member=off | request forwarded | no rotation; 429 relayed |
| E5 | rotation-toggle: read at request time | state-transition | L1 | automated | admin=on, request in flight, 2 accounts | admin flips to off between request N and N+1 | request N+1 does not rotate; no restart required |
| E6 | rotation-toggle: client cannot request rotation | decision-table | L1 | automated | admin=off; request carries a header/body field asking for rotation | request forwarded | rotation still does not occur — the gate is server-side, not advisory |
| E7 | primary-selection: ownership | EP | L1 | automated | account owned by the member | set as primary | accepted |
| E8 | primary-selection: ownership | EP | L1 | automated | account shared by a teammate | set as primary | rejected — shared accounts are rotated to, never pinned |
| E9 | primary-selection: ownership | EP | L1 | automated | teammate's private account | set as primary | rejected (not in pool at all) |
| E10 | pool-selection: retry-after clamp | BVA | L1 | automated | 429 with `retry-after` = ceiling − 1 | account cooled | cooldown equals the header value [NEEDS CLARIFICATION: ceiling — C4] |
| E11 | pool-selection: retry-after clamp | BVA | L1 | automated | 429 with `retry-after` = ceiling + 1 | account cooled | cooldown equals the ceiling, not the header [NEEDS CLARIFICATION: ceiling — C4] |
| E12 | pool-selection: retry-after absent/invalid | BVA | L1 | automated | 429 with no `retry-after`; and with a negative; and with a non-numeric | account cooled | bounded default applied in all three [NEEDS CLARIFICATION: default — C4] |
| E13 | rotation: bounded attempts | BVA | L1 | automated | pool of N accounts, every one returns 429 | request forwarded | at most the attempt bound is tried, then a single 429 to the client — not N unbounded retries |
| E14 | rotation: body replayability | BVA | L1 | automated | request body at / just above the size bound | 429 on first account | at bound → rotates; above → rotation disabled and 429 relayed [NEEDS CLARIFICATION: bound — C3] |
| E15 | pool-selection: all cooling | state-transition | L1 | automated | every account in pool cooling, expiries 5/9/14 min out | request forwarded | 429 carrying the **earliest** (5 min) expiry; no optimistic attempt made |
| E16 | pool-selection: empty pool | EP | L1 | automated | member has no accounts and none shared | request forwarded | explicit error distinguishable from a rate limit |
| E17 | pool-selection: rotation-off carve-out | decision-table | L1 | automated | rotation off, member's primary is `cooling` | request forwarded | still attempted on the cooling primary — not short-circuited on an estimate |
| E18 | pool-selection: rotation-off carve-out | decision-table | L1 | automated | rotation off, member's primary is `dead` | request forwarded | error shaped *unlike* a rate limit, so a retry-forever client does not hammer it |
| E19 | pool-selection: no primary designated | EP | L1 | automated | rotation off, member has accounts but no primary | request forwarded | selects one of their **own** accounts; never a shared one |
| E20 | enrolment: existing credential untouched | state-transition | L1 | automated | member already signed in to the provider | enrolment completes | prior `auth.json` entry byte-identical [NEEDS CLARIFICATION: capture mechanism — C1] |
| E21 | enrolment: scratch isolation | EP | L1 | automated | `PI_CODING_AGENT_DIR` set to a temp dir | capture runs | credential lands in the scratch dir only [NEEDS CLARIFICATION: capture mechanism — C1] |
| E22 | enrolment: duplicate detection | EP | L1 | automated | same provider account re-authorised, yielding entirely fresh token values | uploaded | rejected as duplicate — detection cannot rest on token equality [NEEDS CLARIFICATION: identity source — C6] |
| E23 | enrolment: dead account recovery | state-transition | L1 | automated | account in `dead`, owner removes then re-enrols | re-enrolment | succeeds — proving `dead → ok` is reachable rather than terminal |
| E24 | member-keys: key states | EP | L1 | automated | keys that are valid / revoked / expired / unknown | presented at the gate | four distinct outcomes; revoked and expired are not conflated with unknown |
| E25 | authz: revocation cascades | EP | L1 | automated | member holding 3 keys across 3 machines | role set to `revoked` | all 3 rejected at next request — not merely the newest |
| E26 | authz: revocation withdraws contributions | state-transition | L1 | automated | revoked member had 2 shared accounts | revocation | both leave every other member's pool |
| E27 | authz: last admin | EP | L1 | automated | sole admin | attempts self-demotion | rejected |
| E28 | visibility: default | EP | L1 | automated | newly enrolled account | enrolment completes | defaults to `private` — never auto-shared |
| E29 | visibility: owner-only mutation | EP | L1 | automated | non-owner | attempts to change visibility | rejected |
| E30 | pool-selection: herd avoidance | decision-table | L1 | automated | two members whose pools hold the same 3 shared accounts | both rate-limited at the same instant | their rotation walks differ in order — a team-wide event does not concentrate every retry on one upstream account |
| E31 | vault: ciphertext at rest | EP | L1 | automated | account enrolled | database inspected directly | no plaintext token present in any column |
| E32 | proxy-forwarding: upstream error sanitisation | EP | L1 | automated | upstream returns an auth error echoing credential material | relayed to client | credential material stripped from the client-visible response |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | proxy-forwarding: streaming passthrough | tail-latency | L2 | automated | sustained streaming completion through keysync vs direct | added TTFB p95 [NEEDS CLARIFICATION: threshold — C8] | 10 min |
| P2 | proxy-forwarding: no buffering of responses | tail-latency | L1 | automated | streamed response of 500 chunks | inter-chunk delay p99 not inflated vs upstream; first chunk relayed before last arrives | per-request |
| P3 | rotation: body buffering memory | soak + threshold | L2 | automated | concurrent large-prompt requests at the body bound | RSS ceiling holds; no unbounded growth [NEEDS CLARIFICATION: bound — C3] | 30 min |
| P4 | refresher: long-run stability | soak | L2 | automated | refresher running against N enrolled accounts | no memory growth; every account stays non-expired | 6 h |
| P5 | rotation: added latency on 429 | tail-latency | L1 | automated | first account 429s, second succeeds | total added latency vs single-attempt p95 | per-request |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | client-plugin: inert control not shown live | state-transition | L3 | automated | admin rotation off, member preference on | member opens the accounts screen | member toggle renders disabled, naming who disabled it and when — never as though it were live |
| F2 | client-plugin: cooling account display | state-convergence | L3 | automated | account cooling with 38 min remaining | screen open across the cooldown | converges to `ok` without a reload; remaining time counts down |
| F3 | client-plugin: rotation notice | state-transition | L3 | automated | a request rotated accounts mid-turn | turn completes | member sees that a switch occurred and that nothing was lost — informational, not a warning |
| F4 | client-plugin: unshare confirmation | state-transition | L3 | automated | account currently serving another member | owner unshares | destructive confirmation shown before withdrawal |
| F5 | client-plugin: pool display | state-convergence | L3 | automated | pool of own + shared accounts | screen opens | each row shows identity, status, provenance [NEEDS CLARIFICATION: management auth — C5] |
| F6 | client-plugin: primary control | decision-table | L3 | automated | pool containing a teammate's shared account | member opens primary selector | shared accounts are not offerable as primary [NEEDS CLARIFICATION: management auth — C5] |
| F7 | client-plugin: keysync unreachable | state-transition | L3 | automated | keysync down | member opens the accounts screen | explicit unreachable state — not an empty pool, which would read as "no accounts" |
| F8 | client-plugin: enrolment states | state-transition | L3 | automated | enrolment run through to completion | each stage | idle → waiting → added, each distinguishable [NEEDS CLARIFICATION: capture mechanism — C1] |
| F9 | client-plugin: enrolment failure | state-transition | L3 | automated | capture fails midway | failure surfaces | actionable failure state, scratch dir gone [NEEDS CLARIFICATION: capture mechanism — C1] |
| F10 | client-plugin: already-enrolled | state-transition | L3 | automated | account already in the pool | upload attempted | "already in the pool" state, existing account unchanged [NEEDS CLARIFICATION: capture mechanism — C1] |
| F11 | client-plugin: unroutable models | state-transition | L3 | automated | a model pooled OAuth cannot route | member opens the model picker | marked unavailable with the reason, rather than failing opaquely at request time |
| F12 | mockups: visual quality across themes | visual/subjective | — | manual-only | the four mockup screens | human reviews at 375 / 1440 in all four themes | [judgment: severity colours legible, no overflow — no automatable observable] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | refresher: one writer across instances | fault-injection | L1 | automated | a second instance starts against the same database while the lease is held and renewed | startup | second instance refuses to run its refresher — **the irreversible failure; a race here revokes the token family for every member at once** |
| X2 | refresher: lease survives SIGKILL | fault-injection (abort) | L2 | automated | lease-holding instance killed without releasing | replacement starts | replacement acquires the lease once it expires, with no operator action — an unattended restart must not need a human to clear a stale lock |
| X3 | refresher: stalled holder loses lease | fault-injection (delay) | L1 | automated | holder stops renewing but keeps running; another acquires | stalled instance resumes | it does not refresh on the strength of its expired lease |
| X4 | refresher: late response persisted | fault-injection (delay) | L1 | automated | refresh exceeds its timeout, response arrives afterwards with a valid rotated token | response lands | token is **persisted, not discarded** — the upstream may already have consumed the old one, and discarding would strand an account whose owner is offline by design |
| X5 | refresher: irrecoverable failure surfaces | fault-injection | L1 | automated | provider rejects the stored refresh token | refresh attempt | account → `dead`, owner flagged for re-authorisation out-of-band, audit attributes the owner |
| X6 | refresher: transient failure does not kill | fault-injection (abort) | L1 | automated | network error mid-refresh | refresh attempt | account state unchanged and retried — a blip must not mark an account dead |
| X7 | refresher: atomic persistence | fault-injection (abort) | L1 | automated | crash between writing access and refresh token | restart | stored pair is consistent; no stale refresh token left behind |
| X8 | forwarding: no independent refresh | fault-injection | L1 | automated | request selects an account whose token is inside its pre-expiry window | request forwarded | refresh happens via the single writer, not the request path — no second refresh trigger exists |
| X9 | forwarding: 401 is not a rate limit | fault-injection | L1 | automated | upstream 401 on a credential the refresher considers current | response observed | account → `dead`, not `cooling` |
| X10 | rotation: no switch after bytes relayed | fault-injection (abort) | L1 | automated | upstream fails after response bytes have reached the client | mid-stream failure | surfaces as an error — never a silent mid-stream account switch |
| X11 | visibility: withdrawal during rotation | fault-injection | L1 | automated | account unshared while another member is mid-rotation after a 429 | remaining attempts | never land on the withdrawn account |
| X12 | enrolment: scratch removed on failure | fault-injection (abort) | L1 | automated | capture cancelled midway | failure path | scratch dir and contents deleted; nothing uploaded [NEEDS CLARIFICATION: capture mechanism — C1] |
| X13 | enrolment: orphan sweep | fault-injection (abort) | L1 | automated | process killed mid-capture leaving a scratch dir | client restarts | dir deleted before any new capture begins [NEEDS CLARIFICATION: capture mechanism — C1] |
| X14 | enrolment: upload failure | fault-injection (abort) | L1 | automated | keysync unreachable at upload | upload attempted | credential not left on disk; failure actionable [NEEDS CLARIFICATION: capture mechanism — C1] |
| X15 | refresher: concurrent local + pooled grant | fault-injection | L2 | automated | same account enrolled and still used locally | both refresh | neither invalidates the other [NEEDS CLARIFICATION: whether providers permit this at all — C2; if not, this inverts into a prohibition test] |
| X16 | client-plugin: rollback | state-transition | L2 | automated | member removes the plugin and restores a direct provider entry | pi restarted | direct operation resumes — requires the keysync entry to have used a distinct provider id [NEEDS CLARIFICATION: provider id — C7] |
| X17 | vault: KEK missing or wrong at boot | fault-injection | L2 | automated | service started with absent, then incorrect, KEK | startup | refuses to start with a clear error rather than starting with an unusable vault |
| X18 | scaffold: unattended restart | fault-injection (abort) | L2 | automated | container killed and restarted with KEK from environment | restart | comes up and resumes refreshing with no human interaction |
| X19 | member-keys: failed-auth backoff | fault-injection | L1 | automated | repeated bad keys from one IP | threshold crossed | per-IP backoff engages; valid keys from other IPs unaffected |
| X20 | authn: management route rejects a proxy key | fault-injection | L1 | automated | a keysync proxy key presented to a management route | request | rejected — accepting it would let any machine key mutate pool configuration |
| X21 | audit: rotation and refresh outcomes recorded | state-transition | L1 | automated | a rotation and a failed refresh occur | audit read | both recorded, attributable to member and account |
| X22 | proxy-forwarding: client abort | fault-injection (abort) | L1 | automated | client disconnects mid-stream | abort observed | upstream request cancelled; no orphaned stream or leaked buffer |

---

## Coverage summary

- Requirements covered: 15/15 capabilities
- Scenarios by class: edge 32 · perf 5 · frontend 12 · error 22 — **71 total**
- Scenarios by level: L1 48 · L2 10 · L3 12 · manual-only 1
- Scenarios by disposition: automated 70 · manual-only 1
- Rows carrying a clarification marker: 18 (all traced to C1–C8)

## New infra needed

- **`packages/keysync-server/**/__tests__/` (L1)** — new vitest tier for a new workspace. Harness
  glue is copyable from `packages/server/src/model-proxy/__tests__/`, which is the closest
  existing analogue: `internal-auth-storage-refresh.test.ts` for X4–X8 (it already models
  refresh timing and abort), `api-key-store.test.ts` for E24/X19, `streamer.test.ts` for
  P2/X10/X22, `concurrency.test.ts` for P5.
- **A fake upstream provider** returning scripted 429/401/stream sequences — required by most of
  the X and E rows. Nothing equivalent exists; build once and share.
- **A second-instance harness (L2)** for X1–X3 — two containers against one database volume.
  `qa/tests/02-server-start.sh` is the nearest shape for container lifecycle.
- **L3 rows depend on the dashboard plugin surface existing**; author against the docker harness
  port from `.pi-test-harness.json` (`dashboardPort`), never a hardcoded `:18000`. Nearest
  exemplars: `tests/e2e/anthropic-bridge-activation.spec.ts` (provider/auth surface),
  `tests/e2e/bridge-contention-health.spec.ts` (health-state rendering).
- **No new harness for the spikes** — Migration step 0 is exploratory and produces a decision,
  not a regression test. Its *outcome* unblocks C1/C2 and the rows they mark.
