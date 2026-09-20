## 1. Adversarial review of the eligibility decision (gate — nothing below starts until this closes)

- [ ] 1.1 Run `doubt-driven-review` on design D1 (WS-issued socket-bound prompt capability) against the four recorded defeats plus at least: cross-origin `fetch` with credentials, a rebound domain that legitimately opens the WebSocket, a malicious browser extension, and capability replay after socket close — verify the review produces a written verdict per attack in `design.md` or a superseding decision
- [ ] 1.2 Run `doubt-driven-review` on D2 (HELD requires `hostGate.mode === "enforce"`) specifically for the "is this defeat #2/#3 again" objection — verify the outcome is either a recorded rebuttal or a replacement precondition, not an unaddressed note
- [ ] 1.3 Run `security-hardening` on the degrade ladder (D3) enumerating every path to "no dialog" and every path to "allow" — verify no enumerated condition reaches an allow without an explicit operator answer
- [ ] 1.4 Run `scenario-design` over the fail-closed matrix (timeout, no audience, disabled, ineligible, `report` mode, disconnect, client abort, over-capacity, revoke-while-pending, cross-plane subject collision, prompt flooding, duplicate + malformed responses) and fold the automated scenarios back into this file — verify every scenario is either a listed task below or explicitly marked manual

## 2. Protocol and shared types

- [ ] 2.1 Add `grant_channel`, `grant_request`, `grant_response`, `grant_dismiss` frames to `packages/shared/src/browser-protocol.ts`, each carrying `plane` and a normalised `subject` — verify `npm test` typechecks and existing protocol tests still pass
- [ ] 2.2 Add the `GrantVerdict` (`allow-once | allow-always | deny`) and `GrantPromptCopy` types, with `allow-once` representable as unavailable per plane (trusted-networks and CORS offer only allow-always/deny) — verify a unit test asserts a deferred-plane prompt cannot carry `allow-once`
- [ ] 2.3 Add the prompting setting (default **off**) to `packages/shared/src/config.ts` with its default asserted — verify a config test shows an absent key parses to disabled

## 3. Eligibility

- [ ] 3.1 Implement per-connection prompt-capability issue/resolve in `packages/server/src/access/prompt-channel.ts`: high-entropy value, memory-only, never persisted, invalidated on socket close, constant-time compare — verify unit tests cover issue→resolve, resolve-after-close, wrong value, and absent value
- [ ] 3.2 Issue the capability on `BrowserGateway` connect and drop it on close — verify a gateway test asserts each socket gets a distinct value and that closing removes it
- [ ] 3.3 Implement `isPromptEligible(request)` reading only the capability header (no auth, no CORS, no `Sec-Fetch-*`, no `Origin`/`Host` comparison) — verify unit tests assert a request with a correct value is eligible with auth disabled on loopback, and a header-present-but-wrong-value request is treated exactly as header-absent
- [ ] 3.4 Implement `maySuspend(request)` = eligible AND host-gate mode is `enforce`, reading the live mode — verify tests cover `report`→deferred and `enforce`→suspendable, and that the mode is never mutated
- [ ] 3.5 Add a regression test per recorded defeat (drive-by with cookies, zrok-origin caller setting the header, `Sec-Fetch`-less legacy request, rebound-host request in `report` mode) asserting each is refused suspension — verify all four fail closed

## 4. Registry

- [ ] 4.1 Implement `packages/server/src/access/pending-grant-registry.ts` (record / take / forget, TTL, bounded, take-once) modelled on `ResyncRequesterRegistry` — verify unit tests cover expiry-denies, take-once, capacity-records-without-prompting, and malformed-verdict-discarded
- [ ] 4.2 Key entries by `(plane, normalisedSubject)` and add the collision tests — verify a same-string subject on two planes yields two entries, and an unknown-`cwd` denial does not join a path-grant entry
- [ ] 4.3 Implement settlement backoff per settled `(plane, subject)`, a per-plane rate limit, and a global concurrent-prompt cap, each degrading to record-only — verify a polling-client test raises exactly one dialog and a flood test raises none beyond the cap
- [ ] 4.4 Emit the transition log (`recorded`/`prompted`/`degraded:<reason>`/`settled:<verdict>`/`expired`/`aborted`/`flooded`) with plane, subject, mode and written store — verify a test asserts a degraded hold is distinguishable from an ineligible denial in the log

## 5. Plane registration seam

- [ ] 5.1 Define the `AccessPlane` interface (`id`, `mode`, `subjectOf`, `keyOf`, `describe`, `grant`) and a registry of planes — verify a unit test registers a fake plane and drives a full record→prompt→settle cycle through it
- [ ] 5.2 Register the filesystem plane, normalising the subject to the same canonical form the path-grant store uses, with `grant` delegating to that store and accepting the denied subject **or one of the denial's offered ancestors** (ladder computed by `add-access-grants-and-review` task 7b.1a — this change consumes it, never recomputes it) — verify tests assert the verdict subject and the created grant's subject are byte-identical, an offered ancestor is accepted, and an unoffered directory is refused
- [ ] 5.3 Register the unknown-`cwd` plane with `grant` delegating to the pinned-directory store, and `allow-once` permitting only the raising request — verify tests cover allow-always pins exactly the named directory and allow-once pins nothing
- [ ] 5.4 Register the network and CORS planes as deferred-only with `allow-once` unavailable, delegating to `trustedNetworks` and the configured allowed origins — verify a test asserts an admitted origin is added verbatim with no wildcard derived from it
- [ ] 5.5 Assert `mode: "held"` never bypasses eligibility — verify a test declares a held plane and shows it still degrades under `report` mode and under ineligibility

## 6. Denial-site wiring

- [ ] 6.1 Thread a `DenialContext` from the universal network guard's single `onRequest` denial point into the registry — verify an injected-request test records a denial with the correct plane and subject
- [ ] 6.2 Thread `DenialContext` from the filesystem containment sites and the unknown-`cwd` denial sites — verify every site's existing denial body (including its unchanged `error` string) is returned when the outcome is deny
- [ ] 6.3 Implement request suspension with the `git-routes.ts:470-478` timeout clear/restore pattern plus `request.raw.once("close")` release — verify a test holds a request past the 10 s `connectionTimeout`, restores the prior socket timeout on finish, and releases the entry on client abort
- [ ] 6.4 Re-run the full containment check on resume rather than trusting the verdict — verify tests assert a sibling path outside the granted subject is still denied and symlink resolution still runs
- [ ] 6.5 Assert containment layer order is unchanged — verify the existing `file-read-containment` tests pass untouched with the feature disabled and with it enabled but unprompted

## 7. Client dialog

- [ ] 7.1 Add the overlay component in `packages/client/` built on `client-utils` `Dialog` (`size="md"`, non-flush, `Dialog.Action`/`Dialog.Cancel` — no new primitive), following `mockups/index.html` + `mockups/ui-plan.md`: plane-specific copy, the subject rendered monospace as the headline, and the store an allow-always answer writes, with allow-always never pre-selected — verify component tests cover each registered plane's copy
- [ ] 7.2 Implement dismissal-equals-deny, the held "request waiting" pill vs the deferred "applies to the next attempt" pill, and omit (do not disable) `Allow once` on deferred planes — verify tests assert a deferred prompt states the verdict applies to a later attempt and renders no allow-once control
- [ ] 7.3 Handle `grant_dismiss` so a losing client's modal disappears without interaction — verify a two-client test shows the second dialog removed and its late answer ignored
- [ ] 7.4 Escape displayed subjects (notably CORS origins) — verify a test with a markup-bearing origin renders it inert
- [ ] 7.5 Render the ancestor ladder on filesystem prompts: rungs exactly as carried by the denial, denied subject preselected, selected subject visible beside the answer controls, no free-text entry, and no ladder control when the denial carries none — verify tests cover preselection, subtree text tracking the selection, and the no-ancestors case

## 8. Access surface

- [ ] 8.1 List pending requests and recent verdicts on the Access page, each answerable there — verify a test answers a pending request from the page with prompting disabled
- [ ] 8.2 Show which store each allow-always verdict wrote, and mark verdict-created grants as prompt-originated — verify the path-grant row displays its origin
- [ ] 8.3 Surface the S4 banners — "held prompts unavailable — host-gate mode is `report`" and "prompting force-disabled by `PI_DASHBOARD_DISABLE_GRANT_PROMPT`" (toggle rendered inert, not hidden) — with the setting link — verify tests cover both states and the both-at-once state

## 2b. Corrections from adversarial review (gate: land before dependent work)

- [ ] 2b.1 Gate prompt-capability **issuance** on browser-shaped provenance: non-absent admitted `Origin`, `Sec-Fetch-Site` consistent with a page this server served, and the UI's own credential tier — verify a test asserts a WebSocket opened **without** an `Origin` header (the `cors-origin.ts:192` admitted path) is issued no capability and yields ineligible denials
- [ ] 2b.2 Implement the per-settlement-mode proof split: held planes require the **request** to carry a valid capability; deferred planes require a **live operator channel** and never require anything of the request — verify tests assert a network denial prompts with an operator channel present, does not prompt with none, and never suspends
- [ ] 2b.3 Make the forbidden-subject rule a **real-path subtree relation in both directions** (is / inside / contains) replacing any equality test — verify tests assert `~/.ssh/keys` is refused as a descendant and a candidate containing `~/.ssh` is refused as an ancestor
- [ ] 2b.4 Define the ladder boundary for every case per `path-anchor-grants`: nearest (not outermost) checkout root, worktree marker as file or directory, root detected on the **real** path, more-restrictive boundary wins when device and home rules disagree, no-`$HOME` still bounded, subject-is-the-boundary — verify one test per case
- [ ] 2b.5 Re-run the denying guard in full on release of a suspended request, including real-path/symlink resolution and the forbidden-subject rule — verify a test swaps the subject for a link to another location after the verdict and asserts the released request is denied
- [ ] 2b.6 Add a **per-channel** dimension to the prompt-volume controls so one requester cannot exhaust the shared budget — verify a test floods from one capability and asserts other planes and other requesters still prompt, and that the suppression reason is distinguishable from a global bound
- [ ] 2b.3a Perform every path comparison on a filesystem-appropriate canonical form — case-insensitive where the volume is, Unicode-normalised where the volume normalises, component-wise never string-prefix, sensitivity probed from the volume not assumed from the platform — verify tests cover `~/.SSH` vs `~/.ssh` on a case-insensitive volume, `/repo-secrets` vs `/repo`, and an unresolvable path being refused rather than compared unresolved
- [ ] 2b.3b Decide containment on the identity of the object actually opened rather than re-deriving from the path string, and record the hard-link limitation in `docs/` — verify a test asserts the documented limitation matches behaviour and that no code path claims path containment proves unreachability
- [ ] 2b.8 Name the YOLO environment variable and specify its value syntax (single root, multiple roots, explicit unscoped, separator handling on platforms where a path may contain the separator); an unparseable value leaves YOLO inactive — verify tests cover each form plus an unparseable one
- [ ] 2b.9 State and implement the lifetime of a remembered explicit `deny` — whether it survives restart, and if durable, that it is listed and clearable on the Access surface — verify a test asserts the documented lifetime matches behaviour
- [ ] 2b.7 **`eng-disciplines` → `security-hardening`** on the residual named in D1a: `isGenuinelyLocal` is address-based, so a **different-user or sandboxed** loopback process is treated as local and can forge provenance headers — decide whether capability issuance needs a credential a non-owner cannot read — verify the decision is recorded in `design.md`

## 8b. YOLO mode (filesystem + working-directory planes only)

- [ ] 8b.1 Add a `yoloEligible` field to the `AccessPlane` registration (D5) and make it unrepresentable together with `mode: "deferred"` — verify a type-level test plus a runtime test assert a deferred plane declaring eligibility is rejected, not honoured
- [ ] 8b.2 Implement the YOLO session: activation state, chosen expiry, chosen scope, no renewal on activity, immediate end — verify tests cover expiry-not-extended-by-use and end-takes-effect-on-the-next-denial
- [ ] 8b.2a Implement scope containment over a **set** of roots: an auto-allow is issued only when the **real** path of the denied subject lies within at least one root — verify tests assert an in-scope path is auto-allowed, a path outside every root is prompted/refused as if YOLO were off, and a path inside a root only before symlink resolution is **not** auto-allowed
- [ ] 8b.2b Offer scope roots from the existing ancestor ladder (`add-access-grants-and-review` task 7b.1a), consumed never recomputed — from the triggering denial when chosen at a prompt, from the session `cwd` when chosen in Settings; no free-text entry; unscoped offered but never pre-selected — verify tests assert the offered set equals the ladder
- [ ] 8b.2c Default the scope to the requesting session's working directory when no explicit choice is expressed — verify a test asserts a no-choice activation yields a cwd-scoped session and **not** an unscoped one
- [ ] 8b.2d Allow adding a root to a live session: drawn from the same ladder, subject to the same forbidden-subject rule, effective immediately, recorded with its add time — verify tests assert the expiry is **not** extended, and that no number of added roots ever produces the unscoped state
- [ ] 8b.3 Apply the automatic `allow-once` verdict at the prompt-raise point only, after eligibility, containment layers and the forbidden-subject filter — verify tests assert a `~/.ssh` denial is still refused under YOLO, a **descendant** of a forbidden directory is refused, symlink resolution still runs, and no persisted grant is created
- [ ] 8b.3a YOLO answers the prompt only and never resurrects a denied request: where the ladder allowed suspension the request is released; where it did not (the default reporting Host-admission configuration) the request stays denied and the verdict applies to the next attempt — verify a test runs under the shipped default and asserts no dialog, request still denied, next attempt allowed
- [ ] 8b.4 An auto-allow requires exactly the proof the prompt would have required — for the held-mode YOLO planes that means the request carries a valid capability even when the plane is degraded — verify tests assert a drive-by request and a capability-less local client both stay denied while YOLO is active
- [ ] 8b.4a An explicit prior `deny` is never reversed by a later YOLO session covering that subject — verify a test denies a subject, activates YOLO scoped to a containing root, and asserts the subject is still refused and recorded as refused-by-prior-refusal
- [ ] 8b.4b The default scope passes the forbidden-subject rule like any other root, falling back to the narrowest legal rung — verify a test with a session `cwd` of `$HOME` asserts `$HOME` is neither offered nor selected as default
- [ ] 8b.5 Assert no other plane is reachable — verify a test activates YOLO and shows network, CORS, auth and pairing denials are byte-identical to the YOLO-off case
- [ ] 8b.6 Add `PI_DASHBOARD_GRANT_YOLO` accepting one or more root directories (scoped) or an explicit unscoped value, process-lifetime with no expiry, and the operator toggle requiring a duration with the scope defaulting to the session `cwd` — verify tests cover both activation paths and the both-with-prompt-suppression case (auto-allowed, no dialog)
- [ ] 8b.6a Fail closed on an unusable environment root: if **any** supplied root is forbidden or unresolvable, YOLO stays **inactive** — no fallback to unscoped, and no activation on the surviving subset — verify a test asserts a typo'd root neither produces a filesystem-wide session nor silently changes which directories are open
- [ ] 8b.7 Add the undismissable active-YOLO indicator on three peer surfaces: a compact pill in the sidebar header's app-level control row beside `TunnelButton` (per `specs/sidebar-header` row 1) linking to where the session can be ended; remaining time on every session surface whose `cwd` is in scope (all of them when unscoped); and on the Access page the affected planes, every root, and the end-now control — verify component tests assert none can be dismissed, that an unscoped session is visually distinct from a scoped one, and that **a session surface still indicates when the sidebar header is not rendered** (the sidebar must not be the only signal)
- [ ] 8b.7c Update `specs/sidebar-header` row-1 control inventory to include the conditional YOLO pill — verify the existing "No controls removed" scenario still passes and the pill is absent when YOLO is inactive
- [ ] 8b.7a Add the three activation entry points writing one shared session: full card on the Access settings page; inline "stop asking for a while" in the grant dialog using **that denial's** ladder and **not** rendered as a fourth verdict; pre-scoped action on the directory settings page — verify tests assert the denial still requires an explicit verdict, the directory page pre-selects its own directory, and all three surfaces show one session
- [ ] 8b.7b When a surface offers activation while a session is already active, it adds its root to that session instead of starting a second one, and says the timer is unchanged — verify a test asserts no second session is created and the expiry is untouched
- [ ] 8b.8 List auto-allowed subjects in the Access surface, distinguished from operator-answered verdicts, and log each with "no human answered" — verify a test asserts the distinction survives after the session ends
- [ ] 8b.9 **`eng-disciplines` → `security-hardening`** on YOLO specifically: whether the plane-scoping is genuinely unrepresentable, whether an auto-allow can be reached without prompt-eligibility or outside the session scope on any path, and whether the tunnel-reachable case needs the refusal that was deliberately not taken (design D13) — verify findings recorded and addressed

## 9. Kill switch, docs, and closeout

- [ ] 9.1 Implement `PI_DASHBOARD_DISABLE_GRANT_PROMPT=1` suppressing prompts regardless of configuration while leaving grants in force and denials recorded — verify a test asserts no dialog with a browser connected
- [ ] 9.2 Confirm the E2E suite is unaffected with the env var set — verify `npm run test:e2e` passes against the docker harness
- [ ] 9.3 Run `observability-instrumentation` over the transition log and add whatever `/api/health` counters it identifies — verify the counters appear and are asserted in a test
- [ ] 9.4 Delegate `docs/` prose (the eligibility rule, the two modes, the degrade ladder, the ancestor ladder, YOLO's scope and its limits, both env vars) to `DocScribe` and apply the returned tree rows — verify `docs/architecture.md` and the nearest `AGENTS.md` rows describe the new `packages/server/src/access/` files
- [ ] 9.5 Run `review-code` on the full diff, then `npm run quality:changed` — verify both are clean before commit

## 10. Test scenarios folded from `test-plan.md`

The manifest (`test-plan.md`), not this file, is the source of truth for
automated-vs-manual. Rows `F10` and `F11` are `manual-only`: they are folded as manual
tasks in 10h, not as tests. Six rows carry a `[NEEDS CLARIFICATION]` marker — resolve `C1`–`C3`, `C5`,
`C6` in the manifest before authoring those (`C4` is resolved).

### 10a. L1 unit (vitest) — eligibility and capability issuance

Harness exemplar for every row in this group: `packages/server/src/auth/__tests__/api-origin-gate.test.ts` (header-shaped admission decisions) and `packages/server/src/auth/__tests__/host-admission.test.ts` (mode-driven gating).

- [ ] 10.1 Absent `Origin` on the WS upgrade · connection established · no capability issued, `grant_channel` never sent (test-plan #E1)
- [ ] 10.2 Non-absent admitted `Origin` + `Sec-Fetch-Site: same-origin` + valid credential tier · connection established · capability issued exactly once (test-plan #E2)
- [ ] 10.3 Admitted `Origin` with `Sec-Fetch-Site: cross-site` · connection established · outcome per the C5 accepted-value set (test-plan #E3 — blocked on C5)
- [ ] 10.4 `Origin: ""` empty not absent · connection established · refused by the existing origin rule, no capability (test-plan #E4)
- [ ] 10.5 Filesystem denial with no capability header · denial evaluated · not suspended, 403, recorded `degraded:ineligible` (test-plan #E5)
- [ ] 10.6 Capability value off by one byte · denial evaluated · treated exactly as absent, no prompt (test-plan #E6)
- [ ] 10.7 Capability issued then socket closed, value echoed later · denial evaluated · resolves to no socket, ineligible (test-plan #E7)
- [ ] 10.8 Network denial with zero operator channels · denial evaluated · no prompt, denial still recorded (test-plan #E8)
- [ ] 10.9 Network denial with one operator channel · denial evaluated · prompt on that channel, request stays denied and is never suspended (test-plan #E9)
- [ ] 10.9a `hostGate.mode = report` with a live channel and a prompt-eligible filesystem denial · denial evaluated · no dialog on any channel, existing denial returned, recorded reason names the Host-admission mode (test-plan #E51)
- [ ] 10.9b `hostGate.mode = report` with a live channel and a network denial · denial evaluated · no dialog, denial still recorded and answerable on the Access surface (test-plan #E52)
- [ ] 10.9c `hostGate.mode = enforce` with a capability-bearing filesystem denial · denial evaluated · dialog raised and request suspended (test-plan #E53)

### 10b. L1 unit (vitest) — registry lifecycle and volume control

Harness exemplar: `packages/server/src/__tests__/cors.test.ts` for plain in-process module tests; follow `ResyncRequesterRegistry`'s existing test for TTL/capacity shape.

- [ ] 10.10 Registry at capacity−1 · one more pending entry · accepted (test-plan #E10)
- [ ] 10.11 Registry at capacity · one more denial · recorded without prompting, no live entry evicted (test-plan #E11 — blocked on C2)
- [ ] 10.12 One pending entry, two `grant_response` frames 10ms apart · second arrives · no-op, verdict unchanged, no second store write (test-plan #E12)
- [ ] 10.13 Denials naming `/a/b` and `/a/b/` on one plane · both recorded · a single entry (test-plan #E13)
- [ ] 10.14 Filesystem `/a/b` and cwd `/a/b` · both recorded · two entries, settling one leaves the other pending (test-plan #E14)
- [ ] 10.15 Same subject denied repeatedly · per-subject backoff boundary · suppression per C1 constants (test-plan #E20 — blocked on C1)
- [ ] 10.16 One capability emitting denials to its per-channel share · share boundary crossed · further denials recorded without prompting (test-plan #E21)
- [ ] 10.17 Requester A at its bound, B idle · B's denial arrives · B prompts, A stays suppressed (test-plan #E22)
- [ ] 10.18 Suppression by per-channel bound vs global cap · each occurs · log/metric distinguishes the reason (test-plan #E23)
- [ ] 10.19 Verdict naming an unoffered directory · verdict submitted · refused, no grant written (test-plan #E47)
- [ ] 10.20 Verdict naming an offered rung · verdict submitted · grant written recording the widened-from subject (test-plan #E48)
- [ ] 10.21 Fresh install, no config · denial occurs · no dialog, denial recorded and answerable from the Access surface (test-plan #E49)

### 10c. L1 unit (vitest) — path containment and the ancestor ladder

Harness exemplar: `packages/server/src/auth/__tests__/file-absolute-containment.test.ts` (real-path containment with temp-dir fixtures) and `cwd-policy-funnel.test.ts` (boundary resolution).

- [ ] 10.22 Candidate `~/.ssh/keys` · forbidden rule applied · refused as a descendant (test-plan #E15)
- [ ] 10.23 Candidate `/Users` where home is `/Users/robson` · ladder computed · not offered, contains a forbidden directory (test-plan #E16)
- [ ] 10.24 Granted `/repo`, candidate `/repo-secrets/x` · containment evaluated · not contained, string-prefix must not match (test-plan #E17)
- [ ] 10.25 Subject in checkout `/a/b` nested in checkout `/a` · ladder computed · truncates at `/a/b` (test-plan #E24)
- [ ] 10.26 Subject in a linked worktree whose `.git` is a file · ladder computed · checkout root recognised (test-plan #E25)
- [ ] 10.27 Subject through a symlinked checkout directory · ladder computed · root detected on the real path, every rung an ancestor of it (test-plan #E26)
- [ ] 10.28 `$HOME` unset, subject outside any checkout · ladder computed · still bounded at mount point, every rung passes the forbidden rule (test-plan #E27)
- [ ] 10.29 Subject **is** the checkout root · ladder computed · ladder is exactly that subject (test-plan #E28)
- [ ] 10.30 Subject is the home directory · ladder computed · ladder empty (test-plan #E29)

### 10d. L1 unit (vitest) — YOLO session semantics

Harness exemplar: `packages/server/src/auth/__tests__/cwd-policy-funnel.test.ts` for path-scoped decisions; use fake timers as the existing TTL tests do.

- [ ] 10.31 Session with duration D · clock to D−1s then D+1s · active then inactive, next denial behaves as if never active (test-plan #E30)
- [ ] 10.32 Continuous auto-allows throughout D · clock reaches D · ends at the originally fixed time (test-plan #E31)
- [ ] 10.33 Roots `/repo` and `/scratch` · denial for `/scratch/x` · auto-allowed (test-plan #E33)
- [ ] 10.34 Scope `/repo`, path inside only before symlink resolution · denial evaluated · not auto-allowed (test-plan #E34)
- [ ] 10.35 Active session 3 min remaining · root added · still ends at the original time (test-plan #E35)
- [ ] 10.36 Operator denied `/repo/.env`, YOLO later scoped to `/repo` · `/repo/.env` denied again · not auto-allowed, recorded refused-by-prior-refusal (test-plan #E36)
- [ ] 10.37 Refusal recorded then server restarted · subject denied under active YOLO · not auto-allowed, refusal survived the restart (test-plan #E37)
- [ ] 10.37b Durable refusal cleared on the Access surface · same subject denied again · prompts again rather than staying refused (test-plan #E37b)
- [ ] 10.38 Session whose `cwd` is `$HOME` · activation offered · `$HOME` neither offered nor default, falls back to narrowest legal rung (test-plan #E38)
- [ ] 10.39 Session with 10 roots · denial outside all · still prompted or refused (test-plan #E39)
- [ ] 10.40 Env names 2 valid roots and 1 unresolvable · server starts · inactive, not unscoped, not activated on the valid subset (test-plan #E40)
- [ ] 10.41 Env single root / multiple roots / explicit unscoped / unparseable · each parsed · first three activate, unparseable leaves YOLO inactive (test-plan #E41)

### 10e. L1 unit (vitest) — performance and fault injection

Harness exemplar: `packages/server/src/routes/__tests__/` git-routes socket-timeout tests for the hold path; plain vitest timing for the rest.

- [ ] 10.42 One held request across the 10s Fastify `connectionTimeout` · not terminated at 10s, socket timeout restored on finish (test-plan #P1 — window blocked on C6)
- [ ] 10.43 Denial 12 levels deep, 1000 iterations · p95 ladder computation < 5ms (test-plan #P3)
- [ ] 10.44 10k prompt→settle cycles · RSS delta < 10MB, registry size returns to baseline (test-plan #P4)
- [ ] 10.45 Client aborts a suspended request mid-hold · entry released, socket timeout restored, no orphaned handle, nothing persisted (test-plan #X1)
- [ ] 10.46 Operator never answers, hold exceeds its maximum · outcome per C6 (test-plan #X2 — blocked on C6)
- [ ] 10.47 Subject replaced by a link to another location after the verdict · request released · guard re-runs and denies (test-plan #X3)
- [ ] 10.48 Grant revoked between verdict and release · request released · re-run guard reflects the revocation (test-plan #X4)
- [ ] 10.49 Browser gateway unavailable when a prompt would be pushed · denial evaluated · denial stands, no allow, recorded as degraded (test-plan #X5)
- [ ] 10.50 Denials beyond capacity · overflow · recorded without prompting, no silent drop of a live entry, no allow (test-plan #X6)
- [ ] 10.51 Chosen root deleted between offer and activation · activation submitted · refused, no session created (test-plan #X7)
- [ ] 10.52 Subject cannot be realpath-resolved · ladder computed · refused rather than compared unresolved (test-plan #X8)
- [ ] 10.53 A deferred-mode plane declares `yoloEligible` · registration · rejected, not honoured (test-plan #X9)
- [ ] 10.54 Host admission reporting · YOLO control opened and env-activated session attempted at startup · no session becomes active, control states the reason rather than hiding, no automatic verdict on any plane (test-plan #X10)

### 10f. L2 smoke (`qa/tests/*.sh` / `*.ps1`) — process and multi-OS

Harness exemplar: `qa/tests/03-websocket.sh` (per-OS process-level assertions, no rendered-UI asserts) and `qa/tests/02-server-start.sh`. **New infra:** E18/E19 need a case-insensitive volume fixture — see `test-plan.md` "New infra needed".

- [ ] 10.55 Candidate `~/.SSH` on a case-insensitive volume · forbidden rule applied · refused (test-plan #E18)
- [ ] 10.56 Case-sensitive volume on a case-insensitive host, candidates differing only in case · containment evaluated · treated as distinct, sensitivity read from the volume (test-plan #E19)
- [ ] 10.57 500 denials across 50 subjects from one capability · p95 denial-path added latency within the C1 threshold (test-plan #P2 — blocked on C1)
- [ ] 10.58 Env-activated YOLO, no browser connected · non-browser client's request denied by containment · remains denied (test-plan #X11)
- [ ] 10.59 `PI_DASHBOARD_DISABLE_GRANT_PROMPT=1` · denial occurs · no prompt, grants unaffected, toggle inert not hidden (test-plan #X12)

### 10g. L3 e2e (Playwright vs the docker harness) — rendered UI

Harness exemplar: `tests/e2e/openspec-artifact-dialog.spec.ts` (modal lifecycle) and `tests/e2e/blackhole-settings.spec.ts` (settings surfaces). Read the dashboard port from `.pi-test-harness.json` (`dashboardPort`) — never hardcode `:18000`.

- [ ] 10.60 Activation UI opened · shipped duration set rendered (test-plan #E32 — blocked on C3)
- [ ] 10.61 Filesystem prompt rendered · dialog opens · no verdict pre-selected or focus-defaulted to allow-always (test-plan #E42)
- [ ] 10.62 Network prompt rendered · dialog opens · allow-once absent from the DOM, not disabled (test-plan #E43)
- [ ] 10.62a Held prompt rendered · dialog opens · no answer pre-selected, focus-defaulted, or visually emphasised over the others (test-plan #E56)
- [ ] 10.62b `hostGate.mode = report` · Access page opened · states no dialog will be raised and why, denials still listed and answerable, prompting toggle inert not hidden (test-plan #E54)
- [ ] 10.62c Browser issued no prompt capability · Access page opened · states this browser will not receive dialogs, and why (test-plan #E55)
- [ ] 10.63 Filesystem prompt offering 3 rungs · dialog opens · exactly 3 selectable rungs, narrowest pre-selected, no free-text input (test-plan #E44)
- [ ] 10.64 Cwd prompt with no ancestors offered · dialog opens · no ladder control rendered (test-plan #E45)
- [ ] 10.65 CORS origin `https://<img src=x onerror=alert(1)>.example.com` · dialog opens · rendered as text, no element created, no script executes (test-plan #E46)
- [ ] 10.66 No active YOLO session · sidebar header renders · row 1 holds exactly today's controls, no pill (test-plan #E50)
- [ ] 10.67 Two browsers on one pending prompt · A answers · B's dialog unmounts, no residual backdrop, B cannot submit a second verdict (test-plan #F1)
- [ ] 10.68 Open prompt · Escape pressed · converges to denied, nothing persisted (test-plan #F2)
- [ ] 10.69 Held prompt · time elapses unanswered · converges to expired, dialog removed, ledger shows nothing written (test-plan #F3)
- [ ] 10.70 Network prompt · dialog opens · states the verdict applies to a later attempt, no countdown affordance (test-plan #F4)
- [ ] 10.71 YOLO active, sidebar header not rendered · session surface in scope displayed · still indicates active YOLO and remaining time (test-plan #F5)
- [ ] 10.72 YOLO active · dismissal attempted on the indicator · remains rendered (test-plan #F6)
- [ ] 10.73 Activated from the directory settings page · Access page opened · same session shown, not a second one (test-plan #F7)
- [ ] 10.74 Filesystem prompt · YOLO activated from inside the dialog · the pending denial still requires an explicit verdict (test-plan #F8)
- [ ] 10.75 Prompt open, WS drops and reconnects · reconnection completes · converges to one consistent state — re-rendered if pending, removed if settled meanwhile (test-plan #F9)

### 10h. Manual verification (deferred post-merge)

- [ ] 10.76 Compare `mockups/index.html` against the shipped dialog · human judgement on spacing and typography parity (test-plan: manual-only, #F10)
- [ ] 10.77 View the prompt in all 4 themes, dark + light · human judgement that severity tokens read correctly in every theme (test-plan: manual-only, #F11)
