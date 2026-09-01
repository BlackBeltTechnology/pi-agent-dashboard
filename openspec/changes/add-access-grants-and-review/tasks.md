# Tasks — add-access-grants-and-review

Test-first throughout: write the failing test named in each `→ verify`, watch it
fail, then implement to green. Discipline-skill checkpoints are called out where
their trigger fires (`eng-disciplines`).

Nothing here suspends or holds open a request — that is `add-access-grant-dialog`.

## 0. Dependency gate

- [ ] 0.1 Confirm `add-universal-network-guard` is archived (or explicitly waived by the user). → verify: `openspec list --json` shows it archived, or a recorded waiver in this change's notes
- [ ] 0.2 Record which UNG outputs this change consumes: the single `onRequest` denial site, the settled `request.isAuthenticated`, and the denial log fields. → verify: each named with a file:line reference
- [ ] 0.3 If UNG is waived, add the ledger-generalization tasks it would have supplied to group 4 before starting. → verify: group 4 task count reflects the decision

## 1. Path-grant store

- [ ] 1.1 Add `packages/server/src/access/access-grants.ts` persisting `~/.pi/dashboard/access-grants.json` with subject, scope, grantedAt, origin. → verify: test writes and re-reads a grant with all four fields
- [ ] 1.2 Implement `"session" | "project"` scope per the `worktree-init-trust.ts` precedent; session scope is in-memory only. → verify: two tests — project survives reload, session does not
- [ ] 1.3 Treat a missing or malformed store as empty. → verify: tests for absent file and invalid JSON both yield zero grants
- [ ] 1.4 Implement `listGrants` / `recordGrant` / `revokeGrant`. → verify: round-trip test through all three
- [ ] 1.5 Enforce that a subject is a directory; a file path is stored as its `dirname`. → verify: test asserts `/a/b/c.txt` records `/a/b`
- [ ] 1.6 Store the subject as its `realpath` at grant time, and display that value. → verify: two tests — granting a symlinked dir persists the target; retargeting the symlink afterwards does not move the grant
- [ ] 1.7 Add a store-path override env var so tests never touch the real `~/.pi`. → verify: suite passes with a temp-dir store and no writes under `$HOME`
- [ ] 1.8 Decide and implement the behaviour when a grant write fails — surface, do not silently swallow as the TOFU precedent does. → verify: test injects a write failure and asserts the outcome is not a false "granted"

## 2. Containment integration

- [ ] 2.1 Add a grant subtree predicate to `path-containment.ts` — realpath both sides, no `gitRoot`, no widening — and prove it is NOT wired into `isAllowed`'s anchor list. → verify: test grants `/repo/sub` in a real git repo and asserts `/repo/other` is still refused
- [ ] 2.2 Assert the grant check preserves layer 2's symlink safety. → verify: two tests — a symlink out of a granted directory is refused; a symlink within it is allowed
- [ ] 2.3 Assert `isAllowed` itself is behaviourally unchanged. → verify: the pre-existing `file-read-containment` suite passes with zero edits
- [ ] 2.4 Apply the grant check at the 7 `isAllowed` sites in `file-routes.ts`, preserving each site's existing anchors — including `homePiAnchor()` at `:348,:744,:899` and the pinned anchor at `:659`. → verify: per-site test asserts the anchor set is unchanged and `~/.pi` reads still succeed
- [ ] 2.5 Apply the same treatment to `session-routes.ts:146`, preserving its `"path outside session directory"` string, and add the backing requirement to the `file-read-containment` delta. → verify: route test plus the delta naming this site
- [ ] 2.6 Apply the grant check to the two containment sites outside `file-routes` — `grep-routes.ts:60` (filters matches rather than 403ing) and `resolve-file-mention.ts`. → verify: test asserts a granted directory's matches appear in grep results
- [ ] 2.7 Assert the empty-store invariant. → verify: test asserts identical outcomes to layers 1–2 alone with no grants present
- [ ] 2.8 **`eng-disciplines` → `systematic-debugging`** if any pre-existing containment test goes red — root-cause before touching the test. → verify: the full `file-read-containment` suite is green

## 3. Denial bodies name their remedy

- [ ] 3.1 Add `reason` and `hint` beside the unchanged `error` string at the four HTTP cwd sites: `goal-routes.ts`, `openspec-group-routes.ts`, `kb-plugin/src/server/kb-routes.ts` (bare `{ error }` shape), and `file-routes.ts:645` (`"unknown cwd"`, a distinct string). → verify: test per site asserts the added fields and a byte-identical `error`
- [ ] 3.2 Add the grantable subject to the containment denial bodies, preserving both `{ success, error }` and the `{ code, error }` shape used by `gateFilePath`/`gateOfficeFile` at `:193`/`:247`. → verify: test per shape asserts byte-identical pre-existing fields
- [ ] 3.3 Confirm the non-HTTP denial sites stay untouched: `kb-plugin/src/server/index.ts:48`, `apple-tools/src/server/index.ts:169`, `embed-lifecycle/visitor-session-registry.ts:155`. → verify: test asserts their behaviour is unchanged
- [ ] 3.4 Wire the pinned-directory remedy so accepting it pins the refused directory, and assert a path grant never pins a cwd. → verify: two tests — remedy pins and retry returns 200; a path grant alone leaves the cwd refused

## 4. Denial ledger and network request/accept

- [ ] 4.1 Generalize `BlockEventBuffer` past tunnel-only denials into the pending-access-request queue. → verify: test records a denial from a non-tunnel guarded namespace
- [ ] 4.2 Assert all four anti-poisoning properties survive — socket-peer-only IP, dedupe, cap eviction, `trustable`. → verify: the existing `network-denial-ring-buffer` suite passes unchanged
- [ ] 4.3 Add the refused-origin field for CORS entries without changing the IP dedupe key. → verify: test asserts origin captured and dedupe still by IP
- [ ] 4.4 Assert eviction under the queue role degrades to a terminal 403 and re-records on retry. → verify: flood test asserts no grant side effect and successful re-record
- [ ] 4.5 Expose pending access requests to trusted clients (auth-gated read). → verify: route test asserts the list and that an unauthenticated read is refused
- [ ] 4.6 Implement accept → add the peer to trusted networks through the existing config write path. → verify: test asserts the config patch and that the ledger never mutated policy itself
- [ ] 4.7 Suppress accept for `trustable: false` entries. → verify: test asserts no accept action for loopback and proxy-terminated peers
- [ ] 4.8 Assert no unauthenticated inbound endpoint exists for creating a pending request. → verify: route-inventory test asserts the ledger is written only by the guard
- [ ] 4.9 **`eng-disciplines` → `security-hardening`** on the accept path — the one action that widens network trust. → verify: findings recorded and addressed
- [ ] 4.10 **Spawn `Audit`** on the diff for groups 1–4 (auth/untrusted-input surface). → verify: findings triaged; parent fixes what lands

## 5. CORS observability

- [ ] 5.1 Record CORS origin refusals into the ledger without altering the CORS decision. → verify: test asserts the entry exists and the response is unchanged
- [ ] 5.2 Distinguish configured origins (revocable) from structural allowances. Note `cors-origin.ts` allows more than the configured list — loopback any port, the active tunnel URL, every live tunnel origin, any `*.share.zrok.io` / `*.shares.zrok.io` host, `pi-dashboard.dev`, and any host matching `trustedNetworks`/`bypassHosts`. → verify: unit test classifies each of those branches

## 6. Revoke support in stores that lack it

- [ ] 6.1 Add a revoke function to `git-worktree/worktree-init-trust.ts` clearing both the persisted entry and the in-memory `sessionTrust` Set. → verify: test grants at session scope, revokes, asserts not trusted without restart
- [ ] 6.2 Add a revoke function to `packages/kb/src/trust.ts`. → verify: test records then revokes and asserts `isTrusted` is false
- [ ] 6.3 Record the source subject alongside the hash in `kb-source-trust.json`, additively. → verify: two tests — a new entry exposes its subject; a legacy hash-only entry reads without error
- [ ] 6.4 Assert no existing store file is rewritten or migrated. → verify: test snapshots each store file before/after a read and asserts equality

## 7. Client — Settings → Access tab

- [ ] 7.1 Add the `Access` page to `navGroups` in `SettingsPanel.tsx` with its route page id. → verify: test asserts the tab renders and routes
- [ ] 7.2 Aggregate entries from all eight in-scope stores, each labelled with its origin store, with `auth.bypassHosts` listed separately from `config.trustedNetworks`. → verify: fixture test asserts each store appears and the two host stores are distinguishable
- [ ] 7.3 Confirm the two deliberately excluded stores stay excluded and the rationale is recorded: `paired-devices.json` and `auth.bypassUrls`. → verify: the exclusion rationale is present in `design.md` D6
- [ ] 7.4 Render an empty state when no store holds a grant. → verify: test asserts the empty state, not an error
- [ ] 7.5 Implement revoke per entry against the correct store. → verify: test per store asserts the correct write path is called
- [ ] 7.6 Render legacy hash-only KB entries as opaque hashes with a working revoke. → verify: test asserts no error and a functioning revoke
- [ ] 7.7 Assert loading the page performs no store writes. → verify: test asserts zero writes during render
- [ ] 7.8 Assert revocation takes effect on the next request without a restart. → verify: integration test grants, revokes, retries, expects 403
- [ ] 7.9 Decide whether the tab can add a grant proactively (design.md open question) and implement or explicitly defer. → verify: the decision is recorded in `design.md`
- [ ] 7.10 Add i18n strings for every new user-facing string. → verify: no hard-coded English; i18n source updated
- [ ] 7.11 Style with theme tokens only, per the `theme-system` skill. → verify: no raw hex or px in the new component

## 8. Verification and landing

- [ ] 8.1 Add an E2E spec covering grant → read succeeds → revoke → denied again, per `author-dashboard-e2e-spec`. → verify: `npm run test:e2e` green against the docker harness
- [ ] 8.2 Assert suite runtime is unchanged within noise. → verify: before/after timing on `npm test`
- [ ] 8.3 Run `npm run quality:changed` and clear findings (`code-quality`). → verify: clean
- [ ] 8.4 Full suite: `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log`, then grep the summary. → verify: no `FAIL`, summary line shows passed
- [ ] 8.5 Update the directory `AGENTS.md` rows for every new and changed file. → verify: `kb dox lint` reports no `missing` or `stale` rows
- [ ] 8.6 **Spawn `DocScribe`** for `docs/` prose — why grants are a subtree check rather than an `isAllowed` anchor, and the realpath-at-grant-time rule. → verify: caveman-style rows returned and applied by the parent
- [ ] 8.7 **`eng-disciplines` → `review-code`** on the full diff before commit. → verify: findings resolved or consciously accepted
- [ ] 8.8 **`eng-disciplines` → `doubt-driven-review`** on the persisted store format — effectively irreversible once shipped. → verify: decision recorded in `design.md` if anything changes

## 9. Folded test scenarios

Every `automated` row in `test-plan.md` maps to exactly one task here. Each
carries its exemplar (copy harness glue from it), its Triple, and its manifest
id. Five rows are blocked on a clarification in the manifest's banner — author
them only after C1–C5 are answered.

### 9a. Grant semantics — L1

Exemplar for all of 9a: `packages/server/src/lib/__tests__/path-containment.test.ts`

- [ ] 9a.1 Grant does not widen to git root. grant `/repo/sub` in a real git repo whose common root is `/repo` · read `/repo/other/secret.txt` · 403 `{success:false,error:"path outside working directory"}` (test-plan #E1)
- [ ] 9a.2 Grant admits its subtree. grant `/a/b` · read `/a/b/deep/c.txt` · allowed 200 (test-plan #E2)
- [ ] 9a.3 Prefix-adjacent sibling refused. grant `/a/b` · read `/a/bb/c.txt` · 403, separator-aware compare not raw startsWith (test-plan #E3)
- [ ] 9a.4 Grant does not admit its parent. grant `/a/b` · read `/a/sibling` · 403 (test-plan #E4)
- [ ] 9a.5 Empty-store equivalence. grant store absent · run the full pre-existing containment suite · every outcome byte-identical to layers 1-2, suite passes with zero edits (test-plan #E5)
- [ ] 9a.6 `isAllowed` untouched. store populated with `/other` · call `isAllowed(p,{anchors})` directly · return value identical to pre-change for every input, grants never reach it (test-plan #E6)
- [ ] 9a.7 Grant store bounds. BLOCKED on C1 — no cap specified. Author after the cap decision lands (test-plan #E7)
- [ ] 9a.8 Scope decision table. scope {session,project} x restart {yes,no} · evaluate after each · only session+restart is NOT in force (test-plan #E8)
- [ ] 9a.9 Subject normalisation. grant requested for `/a/b/c.txt` · record it · persisted subject is `/a/b` (test-plan #E9)
- [ ] 9a.10 Symlink escape refused. `/a/b` granted containing `esc -> /etc` · read `/a/b/esc/passwd` · 403 (test-plan #X2)
- [ ] 9a.11 Symlink retarget does not move the grant. `/wt/current -> /wt/v1` granted at v1 · repoint to `/wt/v2`, read under v2 · 403 (test-plan #X3)
- [ ] 9a.12 Grant write failure. BLOCKED on C2 — behaviour undecided (test-plan #X4)
- [ ] 9a.13 TOCTOU between check and open. BLOCKED on C5 — scope undecided (test-plan #X5)
- [ ] 9a.14 realpath on a missing subject. granted dir deleted after grant · read under it · 403, no unhandled rejection, no 500 (test-plan #X6)
- [ ] 9a.15 Granted dir recreated as a symlink. `/a/b` deleted then recreated as symlink to `/etc` · read `/a/b/passwd` · 403, stored real path no longer matches (test-plan #X7)
- [ ] 9a.16 Degraded git still fails closed. `git` unavailable, store populated · read outside every anchor and grant · 403, grant check does not mask fail-closed (test-plan #X8)
- [ ] 9a.17 Malformed store degrades to empty. `access-grants.json` containing `{not json` · any containment check · zero grants, falls back to layers 1-2, no throw and no 500 (test-plan #X1)

### 9b. Denial bodies and cwd remedy — L1

Exemplar: `packages/server/src/__tests__/file-absolute-containment.test.ts`

- [ ] 9b.1 Denial body additivity across all three shapes. refuse at `{success,error}`, `{code,error}` and bare `{error}` sites · inspect each · pre-existing fields byte-identical, `reason`/`hint` added alongside (test-plan #E13)
- [ ] 9b.2 Path grant never pins a cwd. `/a/b` granted as path anchor and not pinned · request with `cwd=/a/b` · still 403 unknown-cwd (test-plan #E14)
- [ ] 9b.3 Non-HTTP denial sites untouched. trigger unknown-cwd at kb-plugin `index.ts:48`, apple-tools `index.ts:169`, `visitor-session-registry.ts:155` · behaviour byte-identical, no remedy fields, no crash (test-plan #X11)

### 9c. Denial ledger — L1

Exemplar for all of 9c: `packages/server/src/__tests__/tunnel-block-events.test.ts`

- [ ] 9c.1 Ledger cap under the queue role. ledger at 50 distinct IPs · denial from a 51st · oldest-distinct evicted, size stays 50, no grant side effect (test-plan #E10)
- [ ] 9c.2 Anti-poisoning properties preserved. generalized ledger · run the pre-existing ring-buffer suite · passes unchanged (test-plan #E11)
- [ ] 9c.3 CORS origin captured without changing the dedupe key. two refusals, same IP, different origins · record both · one entry keyed by IP, origin captured as an extra field (test-plan #E12)
- [ ] 9c.4 Recording never disrupts the denial. ledger `record()` throws · a denial occurs · error swallowed, 403 still sent (test-plan #X9)
- [ ] 9c.5 Accept writes only through the config path. trustable pending entry · accept it · `trustedNetworks` mutated via the existing config write path only, ledger never mutates policy (test-plan #X10)
- [ ] 9c.6 No unauthenticated write to the ledger. full route inventory · scan for an endpoint creating a pending request · none exists, ledger written only by the guard (test-plan #X12)

### 9d. Performance — L1

Exemplar: any timed vitest in `packages/server/src/lib/__tests__/`

- [ ] 9d.1 Hot path unaffected. 1000 layer-1 reads with 50 grants stored · added p95 ~0 and zero `realpath` calls attributable to the grant check (test-plan #P1)
- [ ] 9d.2 Cold path bounded. 200 containment misses with 50 grants · p95 of the grant check under 50ms (test-plan #P2)
- [ ] 9d.3 Suite runtime unaffected. full `npm test` before and after · within +/-5% over 3 runs each (test-plan #P3)

### 9e. Access tab — L3

Exemplar for all of 9e: `tests/e2e/blackhole-settings.spec.ts`; read `dashboardPort` from `.pi-test-harness.json`, never hardcode a port

- [ ] 9e.1 Every in-scope store is listed. fixtures in all 8 stores · open Settings > Access · at least one entry per store, each labelled with its origin store (test-plan #F1)
- [ ] 9e.2 bypassHosts distinguishable from trustedNetworks. a host in `auth.bypassHosts` and a CIDR in `config.trustedNetworks` · open the tab · separate entries with distinct labels, revoking one leaves the other (test-plan #F2)
- [ ] 9e.3 Empty state. every store empty · open the tab · empty state, no error boundary, no console error (test-plan #F3)
- [ ] 9e.4 Revoke takes effect without restart. `/other/repo` granted and readable · revoke then repeat the read · converges to 403 with no server restart (test-plan #F4)
- [ ] 9e.5 Proactive grant creation. BLOCKED on C3 — add support undecided (test-plan #F5)
- [ ] 9e.6 Project-trust revoke. BLOCKED on C4 — revoke feasibility unverified (test-plan #F6)
- [ ] 9e.7 Legacy KB entry renders. pre-change hash-only entry in `kb-source-trust.json` · open the tab · renders as opaque hash with working revoke, no error (test-plan #F7)
- [ ] 9e.8 Accept suppressed for non-trustable peers. ledger with loopback, proxy-terminated and genuine remote entries · open the pending-request surface · accept offered only for the genuine remote (test-plan #F9)

### 9f. Access tab purity — L1

Exemplar: `packages/client/src/components/settings/__tests__/settings-page-composition.test.tsx`

- [ ] 9f.1 Rendering the tab writes nothing. hash all 8 store files before render · render the Access tab · every hash unchanged (test-plan #F8)
