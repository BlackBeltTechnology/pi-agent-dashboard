## 0. Spikes — blocking, before any enrolment or refresher code

Two unverified facts gate this design. Both are cheap to measure and expensive to assume. Nothing
in groups 3 and 4 may be written until these resolve.

- [ ] 0.1 Spike: settle the enrolment capture mechanism. pi exposes no non-interactive login — `pi auth` is read-only and the only login surface is the interactive TUI. Walk the three candidates in design D10 (host the TUI in a scratch dir · drive a registered provider's `oauth.login` callback · implement provider OAuth server-side) until one captures a usable credential end to end into a scratch `PI_CODING_AGENT_DIR`. Record which failed and why.
- [ ] 0.2 Update design D10 and the enrolment spec with the winning mechanism; clear clarification C1 in `test-plan.md`
- [ ] 0.3 Spike: determine whether providers issue independent, concurrently-valid grants per authorization. Authorise one low-value account twice; check both stay valid and that refreshing one does not invalidate the other.
- [ ] 0.4 Record the outcome in design D7 and clear C2. If grants prove exclusive, enrolment must take ownership — a member cannot both enrol an account and keep using it locally, and X15 inverts into a prohibition test
- [ ] 0.5 Fix the remaining unfilled values the plan needs: request-body bound (C3), cooldown ceiling and default (C4), management-route auth mechanism (C5), account identity source (C6), keysync provider id (C7), latency budget (C8)

## 1. Package scaffold and vault

- [ ] 1.1 Create `packages/keysync-server/` workspace with `bin` entry, register in `pnpm-workspace.yaml`, add better-auth, SQLite driver and libsodium deps
- [ ] 1.2 Write the SQLite schema and migration runner: members, member keys, accounts, account health, settings, audit, refresher lease
- [ ] 1.3 Test: migration failure aborts startup without binding the port; fresh database creates the full schema
- [ ] 1.4 Implement envelope encryption — per-account DEK wrapped by a boot-supplied KEK
- [ ] 1.5 Implement startup config validation; refuse to start when the KEK is absent or wrong, naming the problem
- [ ] 1.6 Add the dockerfile; KEK is supplied from the environment and documented as needing to originate outside the backup set
- [ ] 1.7 Test: no plaintext token in any column — see `packages/server/src/model-proxy/__tests__/api-key-store.test.ts` for the at-rest inspection shape. Triple: an account is enrolled · the database is read directly · no column contains plaintext token material. (test-plan #E31)
- [ ] 1.8 Test: KEK missing then wrong at boot — new L2 container test, see `qa/tests/02-server-start.sh`. Triple: service started with absent KEK, then with an incorrect one · startup · refuses to start with a clear error rather than serving from an unusable vault. (test-plan #X17)
- [ ] 1.9 Test: unattended restart — L2, see `qa/tests/02-server-start.sh`. Triple: container killed with KEK in the environment · restart · comes up and resumes refreshing with no human interaction. (test-plan #X18)

## 2. Identity, roles, and member keys

- [ ] 2.1 Wire better-auth with GitHub and Google providers plus the admin plugin
- [ ] 2.2 Test: an unknown first-time login lands in `revoked` and reaches no pooled account until granted
- [ ] 2.3 Implement roles `admin` / `member` / `revoked` with enforcement on every management and proxy route
- [ ] 2.4 Implement member keys — generate, hash, constant-time verify, revoke, expire. Several per member, one per machine
- [ ] 2.5 Implement the auth gate with per-source failed-auth backoff and distinct revoked/expired/unknown error codes
- [ ] 2.6 Implement revocation: cancel every key the member holds and withdraw every account they contributed
- [ ] 2.7 Test: four distinct key states — see `packages/server/src/model-proxy/__tests__/api-key-store.test.ts`. Triple: keys that are valid, revoked, expired and unknown · presented at the gate · four distinct outcomes, with revoked and expired not conflated with unknown. (test-plan #E24)
- [ ] 2.8 Test: revocation cascades across machines — L1. Triple: a member holding 3 keys on 3 machines · role set to `revoked` · all 3 rejected at the next request, not merely the newest. (test-plan #E25)
- [ ] 2.9 Test: revocation withdraws contributions — L1. Triple: a revoked member had 2 shared accounts · revocation · both leave every other member's pool. (test-plan #E26)
- [ ] 2.10 Test: last admin cannot self-demote — L1. Triple: the sole admin · attempts self-demotion · rejected. (test-plan #E27)
- [ ] 2.11 Test: failed-auth backoff — see `packages/server/src/model-proxy/__tests__/failed-auth-backoff.test.ts`. Triple: repeated bad keys from one IP · threshold crossed · per-IP backoff engages while valid keys from other IPs are unaffected. (test-plan #X19)
- [ ] 2.12 Test: a proxy key is refused on a management route — L1. Triple: a keysync proxy key · presented to a management route · rejected, because accepting it would let any machine key mutate pool configuration. (test-plan #X20)

## 3. Enrolment — gated on task 0.2

- [ ] 3.1 Implement scratch-directory capture using the spike-selected mechanism from 0.1, isolated by `PI_CODING_AGENT_DIR`
- [ ] 3.2 Implement the orphan sweep at client start
- [ ] 3.3 Implement the upload endpoint with duplicate-account rejection keyed on the identity source settled in 0.5
- [ ] 3.4 Implement account removal by its owner, returning the provider account to the enrollable set
- [ ] 3.5 Enrol one low-value account end to end and confirm it is stored encrypted
- [ ] 3.6 Test: existing credential untouched — L1. Triple: the member is already signed in to that provider · enrolment completes · the prior `auth.json` entry is byte-identical to its previous contents. (test-plan #E20)
- [ ] 3.7 Test: scratch isolation — L1. Triple: `PI_CODING_AGENT_DIR` points at a temp dir · capture runs · the credential lands in the scratch dir and nowhere else. (test-plan #E21)
- [ ] 3.8 Test: duplicate detection survives token rotation — L1. Triple: the same provider account re-authorised, yielding entirely fresh token values · uploaded · rejected as a duplicate, proving detection does not rest on token equality. (test-plan #E22)
- [ ] 3.9 Test: dead account recovery — L1. Triple: an account in `dead`, whose owner removes then re-enrols it · re-enrolment · succeeds, proving `dead → ok` is reachable rather than terminal. (test-plan #E23)
- [ ] 3.10 Test: scratch removed on failure — L1. Triple: a capture cancelled midway · failure path · scratch dir and contents deleted, nothing uploaded. (test-plan #X12)
- [ ] 3.11 Test: orphan sweep — L1. Triple: a process killed mid-capture leaving a scratch dir · client restarts · the dir is deleted before any new capture begins. (test-plan #X13)
- [ ] 3.12 Test: upload failure leaves nothing behind — L1. Triple: keysync unreachable at upload time · upload attempted · the credential is not left on disk and the failure is actionable. (test-plan #X14)

## 4. Refresher — gated on task 0.4

- [ ] 4.1 Implement refresh-before-expiry with per-**account** serialisation. The shape in `model-proxy/internal-auth-storage.ts` locks per *provider* over one credential, so per-account locking across several accounts of one provider is new code, not proven code
- [ ] 4.2 Implement atomic persistence of the rotated refresh token
- [ ] 4.3 Implement the refresher lease in the database — acquired at startup, renewed on a heartbeat, stolen only after expiry. Not an in-process guard: a container replacement, a resumed pause, or a restored database all produce two live refreshers that an in-process check cannot see
- [ ] 4.4 Implement late-response persistence: a refresh response arriving after its deadline is persisted if it validates, diverging deliberately from `internal-auth-storage.ts`, which discards it
- [ ] 4.5 Implement the needs-reauthorisation flag and out-of-band owner notification
- [ ] 4.6 Implement the forwarding path's freshness request so it refreshes *through* the refresher rather than independently
- [ ] 4.7 Run `doubt-driven-review` on the refresher before it lands — a mistake here revokes real token families
- [ ] 4.8 Test: one writer across instances — L1, see `packages/server/src/model-proxy/__tests__/internal-auth-storage-refresh.test.ts`. Triple: a second instance starts against the same database while the lease is held and renewed · startup · the second refuses to run its refresher. **The irreversible failure — a race here revokes the token family for every member at once.** (test-plan #X1)
- [ ] 4.9 Test: lease survives SIGKILL — L2, see `qa/tests/02-server-start.sh`. Triple: the lease-holding instance is killed without releasing · a replacement starts · it acquires the lease once expired, with no operator action. (test-plan #X2)
- [ ] 4.10 Test: a stalled holder loses its lease — L1. Triple: the holder stops renewing but keeps running and another acquires · the stalled instance resumes · it does not refresh on the strength of its expired lease. (test-plan #X3)
- [ ] 4.11 Test: late response is persisted — L1, see `internal-auth-storage-refresh.test.ts` (its X5 case codifies the opposite behaviour, so this test must contradict it deliberately). Triple: a refresh exceeds its timeout and the response arrives afterwards with a valid rotated token · the response lands · the token is persisted, not discarded. (test-plan #X4)
- [ ] 4.12 Test: irrecoverable failure surfaces — L1. Triple: the provider rejects the stored refresh token · refresh attempt · account moves to `dead`, the owner is flagged for re-authorisation out-of-band, and the audit attributes them. (test-plan #X5)
- [ ] 4.13 Test: a transient failure does not kill an account — L1. Triple: a network error mid-refresh · refresh attempt · state unchanged and retried. (test-plan #X6)
- [ ] 4.14 Test: atomic persistence — L1. Triple: a crash between writing the access and refresh tokens · restart · the stored pair is consistent with no stale refresh token left behind. (test-plan #X7)
- [ ] 4.15 Test: the forwarding path never refreshes independently — L1. Triple: a request selects an account inside its pre-expiry window · request forwarded · the refresh happens via the single writer, so no second refresh trigger exists. (test-plan #X8)
- [ ] 4.16 Test: concurrent local and pooled grants — L2. Triple: the same account enrolled and still used locally · both refresh · neither invalidates the other. Inverts into a prohibition test if 0.3 shows grants are exclusive. (test-plan #X15)
- [ ] 4.17 Test: refresher soak — L2. Workload: refresher against N enrolled accounts · metric: no memory growth and every account stays non-expired · window: 6 h. (test-plan #P4)

## 5. Forwarding, single account

- [ ] 5.1 Implement the `anthropic-messages` endpoint: authenticate the key, decrypt the account, forward upstream
- [ ] 5.2 Implement streaming relay without buffering the response
- [ ] 5.3 Implement response and error sanitisation so no credential material can be returned to a client
- [ ] 5.4 Add `openai-completions` and `openai-responses` endpoints
- [ ] 5.5 Implement per-key and per-account concurrency limits with retry indication
- [ ] 5.6 Verify end to end: a pi client configured with `baseUrl` and a member key works with no client plugin present
- [ ] 5.7 Test: upstream error sanitisation — L1, see `packages/server/src/model-proxy/__tests__/streamer.test.ts`. Triple: upstream returns an auth error echoing credential material · relayed to the client · the credential material is stripped. (test-plan #E32)
- [ ] 5.8 Test: 401 is not a rate limit — L1. Triple: upstream 401 on a credential the refresher considers current · response observed · account moves to `dead`, not `cooling`. (test-plan #X9)
- [ ] 5.9 Test: client abort — L1, see `streamer.test.ts`. Triple: the client disconnects mid-stream · abort observed · the upstream request is cancelled with no orphaned stream or leaked buffer. (test-plan #X22)
- [ ] 5.10 Test: streaming passthrough latency — L2. Workload: sustained streaming completions through keysync vs direct · metric: added TTFB p95 within the budget set in 0.5 · window: 10 min. (test-plan #P1)
- [ ] 5.11 Test: responses are not buffered — L1, see `streamer.test.ts`. Workload: a streamed response of 500 chunks · metric: inter-chunk delay p99 not inflated vs upstream, first chunk relayed before the last arrives · window: per-request. (test-plan #P2)

## 6. Pool and selection

- [ ] 6.1 Implement account visibility `private` / `shared`, defaulting to private, owner-only mutation
- [ ] 6.2 Implement per-member per-provider primary selection, restricted to accounts the member owns, with single-primary enforcement
- [ ] 6.3 Implement pool ordering spanning own and shared accounts, provenance-blind apart from primary, with per-member ordering perturbation so members do not traverse shared accounts in the same sequence
- [ ] 6.4 Implement health states `ok` / `cooling` / `dead` and cooldown expiry
- [ ] 6.5 Implement primary clearing when an account stops being available to that member
- [ ] 6.6 Test: primary must be owned — L1. Triple: an account the member owns · set as primary · accepted. (test-plan #E7)
- [ ] 6.7 Test: a shared account cannot be pinned — L1. Triple: a teammate's shared account · set as primary · rejected, because sharing offers overflow capacity rather than someone's steady-state spend. (test-plan #E8)
- [ ] 6.8 Test: a teammate's private account is not selectable — L1. Triple: a teammate's private account · set as primary · rejected, as it is not in the pool at all. (test-plan #E9)
- [ ] 6.9 Test: all accounts cooling returns the earliest expiry — L1. Triple: every account cooling with expiries 5/9/14 min out · request forwarded · a 429 carrying the 5-minute expiry, with no optimistic attempt made. (test-plan #E15)
- [ ] 6.10 Test: an empty pool fails distinctly — L1. Triple: the member has no accounts and none are shared · request forwarded · an explicit error distinguishable from a rate limit. (test-plan #E16)
- [ ] 6.11 Test: new accounts default to private — L1. Triple: a newly enrolled account · enrolment completes · visibility is `private`, never auto-shared. (test-plan #E28)
- [ ] 6.12 Test: only the owner changes visibility — L1. Triple: a non-owner · attempts to change visibility · rejected. (test-plan #E29)
- [ ] 6.13 Test: herd avoidance — L1. Triple: two members whose pools hold the same 3 shared accounts · both rate-limited at the same instant · their rotation walks differ in order, so a team-wide event does not concentrate every retry on one upstream account. (test-plan #E30)
- [ ] 6.14 Test: withdrawal during rotation — L1. Triple: an account unshared while another member is mid-rotation after a 429 · the remaining attempts · never land on the withdrawn account. (test-plan #X11)

## 7. Rotation gate, then rotation

The gate lands **first, defaulting to off**, so cross-account traffic is never possible without a
live kill-switch — not even mid-implementation.

- [ ] 7.1 Implement the admin and member rotation settings, ANDed, both read at request time, initially defaulting off
- [ ] 7.2 Test: both on rotates — L1. Triple: admin on, member on, 2 healthy accounts, the first returns 429 · request forwarded · rotates to the second and the response is 200. (test-plan #E1)
- [ ] 7.3 Test: member off blocks — L1. Triple: admin on, member off, same setup · request forwarded · no rotation, 429 relayed. (test-plan #E2)
- [ ] 7.4 Test: admin off overrides member on — L1. Triple: admin off, member on, same setup · request forwarded · no rotation, 429 relayed — member preference cannot override the admin switch. (test-plan #E3)
- [ ] 7.5 Test: both off blocks — L1. Triple: admin off, member off · request forwarded · no rotation, 429 relayed. (test-plan #E4)
- [ ] 7.6 Test: the switch is read per request — L1. Triple: admin on with a request in flight · admin flips off between request N and N+1 · request N+1 does not rotate, with no session restart required. (test-plan #E5)
- [ ] 7.7 Test: a client cannot request rotation — L1. Triple: admin off, request carries a field asking for rotation · request forwarded · rotation still does not occur, because the gate is server-side rather than advisory. (test-plan #E6)
- [ ] 7.8 Flip both defaults to on once the gate is proven
- [ ] 7.9 Implement request-body buffering for replayability with the size bound from 0.5
- [ ] 7.10 Implement 429 handling: mark cooling from `retry-after`, clamped to the ceiling, with the bounded default when absent
- [ ] 7.11 Implement same-request re-forwarding on the next eligible account with a bounded attempt limit
- [ ] 7.12 Implement the rotation-off carve-out: selection confined to the member's own primary, a cooling primary still attempted, a dead primary returning an error shaped unlike a rate limit
- [ ] 7.13 Test: retry-after just below the ceiling — L1. Triple: a 429 with `retry-after` = ceiling − 1 · the account cools · the cooldown equals the header value. (test-plan #E10)
- [ ] 7.14 Test: retry-after above the ceiling is clamped — L1. Triple: a 429 with `retry-after` = ceiling + 1 · the account cools · the cooldown equals the ceiling, so one erroneous header cannot remove an account for days. (test-plan #E11)
- [ ] 7.15 Test: absent, negative and non-numeric retry-after — L1. Triple: 429s carrying none, a negative, and a non-numeric value · the account cools · the bounded default is applied in all three. (test-plan #E12)
- [ ] 7.16 Test: bounded attempts — L1. Triple: a pool of N accounts where every one returns 429 · request forwarded · at most the attempt bound is tried, then a single 429 reaches the client. (test-plan #E13)
- [ ] 7.17 Test: body size bound governs rotation — L1. Triple: request bodies at and just above the bound · 429 on the first account · at the bound it rotates, above it rotation is disabled and the 429 is relayed. (test-plan #E14)
- [ ] 7.18 Test: cooling primary attempted with rotation off — L1. Triple: rotation off and the member's primary is `cooling` · request forwarded · still attempted, rather than short-circuited on a cooldown estimate. (test-plan #E17)
- [ ] 7.19 Test: dead primary with rotation off — L1. Triple: rotation off and the member's primary is `dead` · request forwarded · an error shaped unlike a rate limit, so a retry-forever client does not hammer it. (test-plan #E18)
- [ ] 7.20 Test: no primary designated — L1. Triple: rotation off, the member has accounts but no primary · request forwarded · one of their own accounts is selected and never a shared one. (test-plan #E19)
- [ ] 7.21 Test: no rotation after bytes are relayed — L1, see `streamer.test.ts`. Triple: upstream fails after response bytes have reached the client · mid-stream failure · surfaces as an error rather than a silent account switch. (test-plan #X10)
- [ ] 7.22 Test: rotation latency — L1, see `packages/server/src/model-proxy/__tests__/concurrency.test.ts`. Workload: the first account 429s and the second succeeds · metric: total added latency vs a single attempt, p95 · window: per-request. (test-plan #P5)
- [ ] 7.23 Test: body-buffering memory — L2. Workload: concurrent large-prompt requests at the body bound · metric: RSS ceiling holds with no unbounded growth · window: 30 min. (test-plan #P3)
- [ ] 7.24 Test: health is still recorded while rotation is off
- [ ] 7.25 Exercise rotation against a genuinely rate-limited account, not only a synthetic 429

## 8. Audit and observability

- [ ] 8.1 Implement append-only audit entries for enrolment, visibility, role, key, refresh, state transition, and rotation
- [ ] 8.2 Test: no audit entry contains credential material
- [ ] 8.3 Test: rotation and refresh outcomes are recorded — L1. Triple: a rotation and a failed refresh occur · the audit is read · both are recorded and attributable to member and account. (test-plan #X21)
- [ ] 8.4 Run `observability-instrumentation` for the refresher loop and the selection path — rotation and refresh failures must be diagnosable after the fact

## 9. Client plugin

- [ ] 9.1 Create `packages/keysync-client/` workspace and register it
- [ ] 9.2 Implement the management API surface the client consumes: pool listing, visibility mutation, primary setting, rotation preference read/write, member list, audit read — authenticated by the mechanism settled in 0.5, never by a proxy key
- [ ] 9.3 Implement local provider configuration writing under the provider id settled in 0.5, leaving unrelated provider entries unchanged
- [ ] 9.4 Implement a keysync-served model-routability endpoint so the client can surface unroutable models without importing the dashboard's `oauth-compat.ts`, which a standalone service cannot reach
- [ ] 9.5 Build the accounts surface from `mockups/provider-accounts.html` — pool, primary, visibility, health, remaining cooldown
- [ ] 9.6 Implement the inert-rotation-control state: when the admin has disabled rotation globally, show it inactive with the reason and who set it
- [ ] 9.7 Build the enrolment flow from `mockups/add-account.html` covering all five states
- [ ] 9.8 Build the admin surface from `mockups/pool-admin.html` — members, key revoke, pool, audit, global rotation switch
- [ ] 9.9 Test: no pooled credential on the client filesystem after a full session
- [ ] 9.10 Test: inert control is not shown as live — L3, see `tests/e2e/bridge-contention-health.spec.ts`. Triple: admin rotation off while the member preference is on · the member opens the accounts screen · the toggle renders disabled, naming who disabled it and when. (test-plan #F1)
- [ ] 9.11 Test: cooling account converges — L3. Triple: an account cooling with 38 min remaining · the screen stays open across the cooldown · it converges to `ok` without a reload and the remaining time counts down. (test-plan #F2)
- [ ] 9.12 Test: rotation notice — L3. Triple: a request rotated accounts mid-turn · the turn completes · the member sees that a switch occurred and nothing was lost, framed informationally rather than as a warning. (test-plan #F3)
- [ ] 9.13 Test: unshare confirmation — L3. Triple: an account currently serving another member · the owner unshares · a destructive confirmation is shown before withdrawal. (test-plan #F4)
- [ ] 9.14 Test: pool display — L3, see `tests/e2e/anthropic-bridge-activation.spec.ts`. Triple: a pool of own and shared accounts · the screen opens · each row shows identity, status and provenance. (test-plan #F5)
- [ ] 9.15 Test: shared accounts are not offerable as primary — L3. Triple: a pool containing a teammate's shared account · the member opens the primary selector · shared accounts cannot be chosen. (test-plan #F6)
- [ ] 9.16 Test: keysync unreachable — L3. Triple: keysync is down · the member opens the accounts screen · an explicit unreachable state, not an empty pool that would read as "no accounts". (test-plan #F7)
- [ ] 9.17 Test: enrolment states — L3. Triple: an enrolment run to completion · each stage · idle, waiting and added are distinguishable. (test-plan #F8)
- [ ] 9.18 Test: enrolment failure — L3. Triple: a capture fails midway · the failure surfaces · an actionable failure state with the scratch dir gone. (test-plan #F9)
- [ ] 9.19 Test: already enrolled — L3. Triple: an account already in the pool · upload attempted · an "already in the pool" state with the existing account unchanged. (test-plan #F10)
- [ ] 9.20 Test: unroutable models are marked — L3. Triple: a model pooled OAuth cannot route · the member opens the model picker · marked unavailable with the reason, rather than failing opaquely at request time. (test-plan #F11)
- [ ] 9.21 Test: rollback restores direct operation — L2. Triple: the member removes the plugin and restores a direct provider entry · pi restarted · direct operation resumes, which requires the keysync entry to have used a distinct provider id. (test-plan #X16)
- [ ] 9.22 Manual: review the four mockup screens at 375 and 1440 in all four themes — severity colours legible, no overflow, controls distinguishable. No automatable observable; verified by eye. (test-plan: manual-only)

## 10. Hardening and rollout

- [ ] 10.1 Run `security-hardening` across the auth gate, vault, enrolment upload, and forwarding paths
- [ ] 10.2 Run `performance-optimization` on the forwarding path — keysync is now on the latency path of every request
- [ ] 10.3 Run `review-code` over the full diff before commit
- [ ] 10.4 Write operator setup docs: KEK supply from outside the backup set, the narrow threat model encryption-at-rest actually defends, and the explicit warning that KEK loss is unrecoverable
- [ ] 10.5 Document the rollback path — remove the client plugin and restore a direct provider entry
- [ ] 10.6 Enrol the remaining accounts and switch members' provider entries to keysync
