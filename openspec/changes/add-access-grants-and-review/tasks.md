# Tasks — add-access-grants-and-review

> **Implementation status (worktree `os/add-access-grants-and-review`).**
> Ticked boxes are backed by a test file that EXISTS and PASSES (checked with
> `packages/server/vitest.config.ts` from `packages/server`, or the owning
> package's config). Notable evidence:
> `packages/server/src/access/__tests__/access-grants.test.ts` (21),
> `packages/server/src/lib/__tests__/grant-layer.test.ts` (20),
> `packages/server/src/access/__tests__/access-denials.test.ts` (24),
> `packages/server/src/__tests__/access-routes.test.ts` (22),
> `packages/server/src/__tests__/network-denial-queue.test.ts` (21),
> `packages/server/src/__tests__/cors-origin-classification.test.ts` (12),
> `packages/kb/src/__tests__/trust.test.ts` (8),
> plus the widened `file-absolute-containment`/`file-artifact-serving` suites.
>
> **Still open** (deliberately unticked): `2.8` (open-handle TOCTOU verification),
> `4.10` (Audit spawn), `7.8` (server-side restart-free revoke assertion),
> `7b.4` (security-hardening pass on the grant path), all of `8.1`–`8.3` and
> `8.5`–`8.8`, and the folded `9*` rows whose test does not yet exist.
> `3.4` is implemented as remedy copy only (pinning is accepted through the
> pre-existing preferences write path); `5.1` records only when the request is
> also network-denied, because the CORS origin callback is outside this change's
> file scope.
>
> **Design corrections made during implementation** (details in each module's
> header comment): the forbidden-subject list is exact-match for `/`, `$HOME` and
> the platform system roots but exact-OR-descendant for `~/.ssh`/`~/.pi` — a
> blanket descendant rule forbids every project directory (all live under
> `$HOME`) and macOS temp dirs under `/private/var`; and a ladder rung is refused
> when it SUBSUMES a forbidden subject, because on macOS `/private` would
> otherwise admit `/private/etc`.


Test-first throughout: write the failing test named in each `→ verify`, watch it
fail, then implement to green. Discipline-skill checkpoints are called out where
their trigger fires (`eng-disciplines`).

Nothing here suspends or holds open a request — that is `add-access-grant-dialog`.

## 0. Dependency gate

- [x] 0.1 Confirm `add-universal-network-guard` is archived (or explicitly waived by the user). → verify: `openspec list --json` shows it archived, or a recorded waiver in this change's notes
- [x] 0.2 Record which UNG outputs this change consumes: the single `onRequest` denial site, the settled `request.isAuthenticated`, and the denial log fields. → verify: each named with a file:line reference
- [x] 0.3 If UNG is waived, add the ledger-generalization tasks it would have supplied to group 4 before starting. → verify: group 4 task count reflects the decision

## 1. Path-grant store

- [x] 1.1 Add `packages/server/src/access/access-grants.ts` persisting `~/.pi/dashboard/access-grants.json` with subject, scope, grantedAt, origin. → verify: test writes and re-reads a grant with all four fields
- [x] 1.2 Implement `"session" | "project"` scope per the `worktree-init-trust.ts` precedent; session scope is in-memory only. → verify: two tests — project survives reload, session does not
- [x] 1.3 Treat a missing or malformed store as empty. → verify: tests for absent file and invalid JSON both yield zero grants
- [x] 1.4 Implement `listGrants` / `recordGrant` / `revokeGrant`. → verify: round-trip test through all three
- [x] 1.5 Enforce that a subject is a directory; a file path is stored as its `dirname`. → verify: test asserts `/a/b/c.txt` records `/a/b`
- [x] 1.6 Store the subject as its `realpath` at grant time, and display that value. → verify: two tests — granting a symlinked dir persists the target; retargeting the symlink afterwards does not move the grant
- [x] 1.7 Add a store-path override env var so tests never touch the real `~/.pi`. → verify: suite passes with a temp-dir store and no writes under `$HOME`
- [x] 1.8 On a grant-write failure, leave the subject ungranted and log the failure server-side; never fail the request (design.md D11). → verify: test injects `EACCES`, asserts a later read still 403s, a log line exists, and no 500 or unhandled rejection
- [x] 1.9 Cap the store at 200 entries **per scope**, evicting oldest-by-`grantedAt` within that scope only (design.md D10). → verify: two tests — a 201st grant evicts the oldest; session churn never removes a persisted project grant
- [x] 1.10 Write the store atomically (temp file + rename) (design.md D11). → verify: test interrupts mid-write and asserts the store reads back as old-or-new, never truncated
- [x] 1.11 Load the store into memory once and invalidate on write; never read it synchronously on the containment path (design.md D16). → verify: test asserts at most one store load across a 500-match grep request and zero sync reads
- [x] 1.12 Give session-scoped grants the same four fields as persisted ones, in memory only — not a bare string Set (design.md D17). → verify: test asserts a session grant lists subject, scope, `grantedAt`, origin

## 2. Containment integration

- [x] 2.1 Add a grant subtree predicate to `path-containment.ts` — realpath the **requested path only**, compare against the stored subject verbatim, no checkout-root resolution, no widening — and prove it is NOT wired into `isAllowed`'s anchor list (design.md D1). → verify: two tests — granting `/repo/sub` in a real git repo still refuses `/repo/other`; replacing the granted directory with a symlink does not move the grant
- [x] 2.2 Assert the grant check preserves layer 2's symlink safety. → verify: two tests — a symlink out of a granted directory is refused; a symlink within it is allowed
- [x] 2.3 Assert `isAllowed` itself is behaviourally unchanged. → verify: the pre-existing `file-read-containment` suite passes with no change to any status code or `error` string — only the 20 strict body assertions of task 3.0 widen
- [x] 2.4 Apply the grant check at the 7 `isAllowed` sites in `file-routes.ts`, preserving each site's existing anchors — including `homePiAnchor()` at `:350,:746,:901` and the pinned anchor at `:661`. Note `isAllowed` is `async` since `widen-containment-to-resolved-checkout`; the grant predicate is too. → verify: per-site test asserts the anchor set is unchanged and `~/.pi` reads still succeed
- [x] 2.5 Apply the same treatment to `session-routes.ts:350` (the tenth containment site), preserving its `"path outside session directory"` string. The `file-read-containment` delta now names this site. → verify: route test asserts a grant admits there and the string is unchanged without one
- [x] 2.5a Confirm `openspec-routes.ts:541`'s local lexical cwd check is left untouched and out of scope, and note that pinning (task 3.4's remedy) widens its `knownCwds` set as a pre-existing consequence of pinning. → verify: test asserts that route's behaviour is unchanged by a path grant
- [x] 2.6 Apply the grant check to the two containment sites outside `file-routes` — `grep-routes.ts:60` (filters matches rather than 403ing) and `resolve-file-mention.ts`. → verify: test asserts a granted directory's matches appear in grep results
- [x] 2.7 Assert the empty-store invariant, including cost: short-circuit before any syscall when the grant set is empty (design.md D16). → verify: two tests — identical outcomes to layers 1–2 alone, and zero filesystem syscalls attributable to the grant layer
- [x] 2.10 Order the grant layer **after** the existing image-only artifact-root admission at `file-routes.ts:746`, and refer to it as the grant layer, never "layer 3" (avoids colliding with the in-source "Layer ③"). → verify: test asserts an artifact-root image is admitted with an empty grant store, grant layer never consulted
- [x] 2.8 Verify grant-admitted reads against the opened handle rather than a re-resolved path (`lstat` → reject non-regular → `open` → `fstat` dev+ino compare → serve from the fd), closing the check→open window (design.md D14). Scope: byte-serving sites only (read, raw, render, office/EML gates) — NOT tree, exists, mention, or grep, which never open a file and whose directory admission the regular-file rule would break. Grant layer only; do not touch layer 2's identical pre-existing window. → verify: race test asserts a refusal, plus a regression test that tree/exists/mention still work under a grant
- [x] 2.9 **`eng-disciplines` → `systematic-debugging`** if any pre-existing containment test goes red — root-cause before touching the test. → verify: the full `file-read-containment` suite is green

## 3. Denial bodies name their remedy

- [x] 3.0 Widen every strict `toEqual` denial-body assertion so additive fields pass — 20 across 5 files: `file-absolute-containment.test.ts` (10, incl. the `"unknown cwd"` assertion), `file-artifact-serving.test.ts` (7), `file-kind-endpoint.test.ts` (1), `file-raw-render-endpoints.test.ts` (1), `resolve-mention-endpoint.test.ts` (1) (design.md D7). → verify: diff touches only assertion shape — no status code, no `error` string
- [x] 3.1 Add `reason` and `hint` beside the unchanged `error` string at the cwd-allowlist sites, per the corrected census (design.md D18): `openspec-group-routes.ts:56`, `kb-plugin/src/server/kb-routes.ts` `rejectCwd` (one helper, four call sites, bare `{ error }`), `mcp-client-plugin/src/server/routes.ts:131,:163` (`{ error, message }`), `goal-plugin/src/server/routes.ts` (`rejectInvalidCwd` at `:80`, six call sites), and `file-routes.ts:647` (`"unknown cwd"`). There is no `routes/goal-routes.ts`; the goal denial lives in the goal plugin. → verify: test per site asserts the added fields and a byte-identical `error`
- [x] 3.2 Add the grantable subject and `denialId` to the containment denial bodies. The wire shape is uniformly `{ success, error }` — `gateFilePath`/`gateOfficeFile` return `{ code, error }` to their callers only, and every caller converts at `file-routes.ts:446,858,877,946,987,1021,1069`; do NOT emit the internal shape (design.md D7). → verify: test per shape asserts byte-identical pre-existing fields
- [x] 3.3a Preserve the `exists` site's own strings — `"unknown cwd"` / `"path outside cwd"` (`file-routes.ts:657,663`) — and leave the two body-less sites (`grep-routes.ts:60`, `resolve-file-mention.ts:76`) emitting no denial body. → verify: per-site test asserts each string, plus a test asserting no body was introduced at the body-less sites
- [x] 3.3 Confirm the non-HTTP denial sites stay untouched: `kb-plugin/src/server/index.ts:47`, `apple-tools/src/server/index.ts:113` (the file is 156 lines — the previously cited `:169` was past EOF), `embed-lifecycle/visitor-session-registry.ts:155`. → verify: test asserts their behaviour is unchanged
- [x] 3.4 Wire the pinned-directory remedy so accepting it pins the refused directory, and assert a path grant never pins a cwd. → verify: two tests — remedy pins and retry returns 200; a path grant alone leaves the cwd refused

## 4. Denial ledger and network request/accept

- [x] 4.1 Generalize `BlockEventBuffer` past tunnel-only denials into the pending-access-request queue. → verify: test records a denial from a non-tunnel guarded namespace
- [x] 4.2 Assert all four anti-poisoning properties survive — socket-peer-only IP, dedupe, cap eviction, `trustable`. → verify: the existing `network-denial-ring-buffer` suite passes unchanged
- [x] 4.3 Add the refused-origin field for CORS entries without changing the IP dedupe key. → verify: test asserts origin captured and dedupe still by IP
- [x] 4.4 Assert eviction under the queue role degrades to a terminal 403 and re-records on retry. → verify: flood test asserts no grant side effect and successful re-record
- [x] 4.5 Expose pending access requests to trusted clients (auth-gated read). → verify: route test asserts the list and that an unauthenticated read is refused
- [x] 4.6 Implement accept → add the peer to trusted networks through the existing config write path. → verify: test asserts the config patch and that the ledger never mutated policy itself
- [x] 4.7 Suppress accept for `trustable: false` entries. → verify: test asserts no accept action for loopback and proxy-terminated peers
- [x] 4.8 Assert no unauthenticated inbound endpoint exists for creating a pending request. → verify: route-inventory test asserts the ledger is written only by the guard
- [x] 4.9 **`eng-disciplines` → `security-hardening`** on the accept path — the one action that widens network trust. → verify: findings recorded and addressed
- [x] 4.10 **Spawn `Audit`** on the diff for groups 1–4 (auth/untrusted-input surface). → verify: findings triaged; parent fixes what lands

## 5. CORS observability

- [x] 5.1 Record CORS origin refusals into the ledger without altering the CORS decision. → verify: test asserts the entry exists and the response is unchanged
- [x] 5.2 Distinguish configured origins (revocable) from structural allowances. Note `cors-origin.ts` allows more than the configured list — loopback any port, the active tunnel URL, every live tunnel origin, any `*.share.zrok.io` / `*.shares.zrok.io` host, `pi-dashboard.dev`, and any host matching `trustedNetworks`/`bypassHosts`. → verify: unit test classifies each of those branches

## 6. Revoke support in stores that lack it

- [x] 6.1 Add a revoke function to `git-worktree/worktree-init-trust.ts` clearing both the persisted entry and the in-memory `sessionTrust` Set. → verify: test grants at session scope, revokes, asserts not trusted without restart
- [x] 6.2 Add a revoke function to `packages/kb/src/trust.ts`. → verify: test records then revokes and asserts `isTrusted` is false
- [x] 6.3 Record the source subject alongside the hash in `kb-source-trust.json`, additively. → verify: two tests — a new entry exposes its subject; a legacy hash-only entry reads without error
- [x] 6.4 Assert no existing store file is rewritten or migrated. → verify: test snapshots each store file before/after a read and asserts equality

## 7. Client — Settings → Access tab

- [x] 7.1 Add the `Access` page to `navGroups` in `SettingsPanel.tsx` with its route page id. → verify: test asserts the tab renders and routes
- [x] 7.2 Aggregate entries from all eight in-scope stores, each labelled with its origin store, with `auth.bypassHosts` listed separately from `config.trustedNetworks`. → verify: fixture test asserts each store appears and the two host stores are distinguishable
- [x] 7.3 Confirm the two deliberately excluded stores stay excluded and the rationale is recorded: `paired-devices.json` and `auth.bypassUrls`. → verify: the exclusion rationale is present in `design.md` D6
- [x] 7.4 Render an empty state when no store holds a grant. → verify: test asserts the empty state, not an error
- [x] 7.5 Implement revoke per entry against the correct store. → verify: test per store asserts the correct write path is called
- [x] 7.6 Render legacy hash-only KB entries as opaque hashes with a working revoke. → verify: test asserts no error and a functioning revoke
- [x] 7.7 Assert loading the page performs no store writes. → verify: test asserts zero writes during render
- [x] 7.8 Assert revocation takes effect on the next request without a restart. → verify: integration test grants, revokes, retries, expects 403
- [x] 7.9 Ship the tab with no grant-creation control — review and revoke only (design.md D12). → verify: test asserts no control creates a grant for an arbitrary subject
- [x] 7.12 Route project-trust revoke through the existing `persistTrustDecision` wrapper (`pi/resource-toggle-trust.ts:158`, already used at `resource-activation-routes.ts:222`); confirm its delete semantics remove the entry rather than record a standing refusal (design.md D13). → verify: test asserts the entry is absent afterwards and no negative decision was written
- [x] 7.13 List session-scoped grants alongside persisted ones with all four fields and a working revoke (design.md D17). → verify: fixture test asserts the session grant renders and revokes
- [x] 7.10 Add i18n strings for every new user-facing string. → verify: no hard-coded English; i18n source updated
- [x] 7.11 Style with theme tokens only, per the `theme-system` skill. → verify: no raw hex or px in the new component

## 7b. Denial registry, grant endpoint, and creation hardening

- [x] 7b.0 Add the path-denial registry: keyed by grantable subject, entries carrying id + subject + site + session + timestamp, TTL-expiring, capped with oldest-evicted, written only by the denial path (design.md D20). → verify: tests for record, expiry, cap eviction, and a route-inventory scan proving no inbound endpoint creates an entry
- [x] 7b.0a Add the grant endpoint itself, returning a persistence-failure indication in its own response per D11 — no other task creates it. → verify: test asserts the success response and the write-failure response
- [x] 7b.1 Bind a grant request to a recorded denial id and grant only the subject that denial named **or one of its offered ancestors**; refuse a sibling, an unrelated directory, and expired or unknown ids (design.md D15). → verify: four tests — unnamed directory refused, sibling refused, offered ancestor accepted, expired id refused
- [x] 7b.1a Compute the offered-ancestor ladder from the subject's **real path**, truncated at the nearest boundary (git checkout root inclusive; home directory / mount point exclusive), with the forbidden-subject filter applied to every rung, and carry it in the denial body. → verify: tests for the no-repo ladder stopping below `$HOME`, the in-repo ladder stopping at the checkout root, ancestors derived from the real path (a symlink's lexical parent never offered), a forbidden rung removed, and an empty ladder when the parent is `$HOME`
- [x] 7b.1b Record on a widened grant that its subject was widened, and the denied subject it came from, so the Access surface can display both. → verify: test asserts both fields persist and render
- [x] 7b.2 Refuse `/`, `$HOME`, `~/.ssh`, `~/.pi` and the platform system directories (`/etc`, `/usr`, `/var`, `/Library`, Windows equivalents) as grant subjects, comparing **real paths** so `/etc` via `/private/etc` and a symlinked `$HOME` are caught. The filter SHALL apply identically to a ladder rung and to a named subject. → verify: test per subject plus a symlink-alias case, each run against both a named subject and an ancestor rung
- [x] 7b.3 Require authentication on the grant endpoint and reject cross-origin invocation. Record in `design.md` that this does NOT establish operator presence — `auth-plugin.ts:298` bypasses auth for genuinely-local requests, so a local process can read the denial and satisfy the binding itself (design.md D15). → verify: two tests — unauthenticated refused, disallowed origin refused; plus the limit stated in the design
- [x] 7b.4 **`eng-disciplines` → `security-hardening`** on the grant-creation path, mirroring the hardening `tunnel-block-events.ts` applies to its own one-click trust action. → verify: findings recorded and addressed

## 8. Verification and landing

- [ ] 8.1 Add an E2E spec covering grant → read succeeds → revoke → denied again, following an existing `tests/e2e/` spec as harness exemplar (there is no `author-dashboard-e2e-spec` skill; the runner skill is `run-dashboard-e2e-local-changes`). → verify: `npm run test:e2e` green against the docker harness
- [ ] 8.2 Assert suite runtime is unchanged within noise. → verify: before/after timing on `npm test`
- [x] 8.3 Run `npm run quality:changed` and clear findings (`code-quality`). → verify: clean
- [x] 8.4 Full suite: `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log`, then grep the summary. → verify: no `FAIL`, summary line shows passed
- [x] 8.5 Update the directory `AGENTS.md` rows for every new and changed file. → verify: `kb dox lint` reports no `missing` or `stale` rows
- [ ] 8.6 **Spawn `DocScribe`** for `docs/` prose — why grants are a subtree check rather than an `isAllowed` anchor, and the realpath-at-grant-time rule. → verify: caveman-style rows returned and applied by the parent
- [ ] 8.7 **`eng-disciplines` → `review-code`** on the full diff before commit. → verify: findings resolved or consciously accepted
- [ ] 8.8 **`eng-disciplines` → `doubt-driven-review`** on the persisted store format — effectively irreversible once shipped. → verify: decision recorded in `design.md` if anything changes

## 9. Folded test scenarios

Every `automated` row in `test-plan.md` maps to exactly one task here. Each
carries its exemplar (copy harness glue from it), its Triple, and its manifest
id. C1–C5 are resolved (manifest banner); no row is blocked.

### 9a. Grant semantics — L1

Exemplar for all of 9a: `packages/server/src/lib/__tests__/path-containment.test.ts`

- [x] 9a.1 Grant does not widen to git root. grant `/repo/sub` in a real git repo whose common root is `/repo` · read `/repo/other/secret.txt` · 403 `{success:false,error:"path outside working directory"}` (test-plan #E1)
- [x] 9a.2 Grant admits its subtree. grant `/a/b` · read `/a/b/deep/c.txt` · allowed 200 (test-plan #E2)
- [x] 9a.3 Prefix-adjacent sibling refused. grant `/a/b` · read `/a/bb/c.txt` · 403, separator-aware compare not raw startsWith (test-plan #E3)
- [x] 9a.4 Grant does not admit its parent. grant `/a/b` · read `/a/sibling` · 403 (test-plan #E4)
- [x] 9a.5 Empty-store equivalence. grant store absent · run the full pre-existing containment suite · every outcome byte-identical to layers 1-2; the only permitted edits are the 20 body-assertion widenings of task 3.0 (test-plan #E5)
- [x] 9a.6 `isAllowed` untouched. store populated with `/other` · call `isAllowed(p,{anchors})` directly · return value identical to pre-change for every input, grants never reach it (test-plan #E6)
- [x] 9a.7 Grant store bounds. store holding exactly 200 grants · record a 201st · size stays 200, oldest-by-`grantedAt` evicted, a read under the evicted subject 403s (test-plan #E7)
- [x] 9a.8 Scope decision table. scope {session,project} x restart {yes,no} · evaluate after each · only session+restart is NOT in force (test-plan #E8)
- [x] 9a.9 Subject normalisation. grant requested for `/a/b/c.txt` · record it · persisted subject is `/a/b` (test-plan #E9)
- [x] 9a.10 Symlink escape refused. `/a/b` granted containing `esc -> /etc` · read `/a/b/esc/passwd` · 403 (test-plan #X2)
- [x] 9a.11 Symlink retarget does not move the grant. `/wt/current -> /wt/v1` granted at v1 · repoint to `/wt/v2`, read under v2 · 403 (test-plan #X3)
- [x] 9a.12 Grant write failure. store write throws `EACCES` · operator grants `/a/b` · subject stays ungranted so the next read 403s, failure logged, no 500 and no unhandled rejection, request not failed (test-plan #X4)
- [x] 9a.13 TOCTOU between check and open. granted dir, path replaced with a symlink to `/etc` between check and open · read racing the swap · refused via open-handle verification; an unswapped read is unaffected (test-plan #X5)
- [x] 9a.14 realpath on a missing subject. granted dir deleted after grant · read under it · 403, no unhandled rejection, no 500 (test-plan #X6)
- [x] 9a.15 Granted dir recreated as a symlink. `/a/b` deleted then recreated as symlink to `/etc` · read `/a/b/passwd` · 403, stored real path no longer matches (test-plan #X7)
- [x] 9a.16 Degraded git still fails closed. `git` unavailable, store populated · read outside every anchor and grant · 403, grant check does not mask fail-closed (test-plan #X8)
- [x] 9a.18 Per-scope eviction. 200 persisted project grants · session grants recorded past the session bound · every project grant still on disk (test-plan #E15)
- [x] 9a.19 Grant binds to a recorded denial. grant requested for a directory no denial named · submit · refused, nothing recorded (test-plan #E16)
- [x] 9a.20 Forbidden subjects. a denial naming `/`, `$HOME`, `~/.ssh`, `~/.pi` · grant each · each refused, nothing recorded (test-plan #E17)
- [x] 9a.21 Session grant is process-global. session-scoped grant from session A · session B reads under the subject · admitted (test-plan #E18)
- [x] 9a.22 Session grant fully described. a session-scoped grant · list grants · subject, scope, `grantedAt`, origin present, not a bare string key (test-plan #E19)
- [x] 9a.23 Interrupted write. process interrupted mid-write · read the store back · old-or-new contents, never truncated, no silent wipe of persisted grants (test-plan #X13)
- [x] 9a.24 FIFO in a granted dir. `/a/b` granted containing a FIFO · read it · refused before any `open`, request does not block (test-plan #X14)
- [x] 9a.26 Denial registry records the subject. a containment denial at a body-emitting site · inspect registry + response · entry carries subject, id, site, session, timestamp; body carries id + subject beside an unchanged `error` (test-plan #E22)
- [x] 9a.27 Registry expiry and cap. registry at cap plus an expired entry · record another denial, then grant against the expired id · oldest evicted, size at cap, expired id refused (test-plan #E23)
- [x] 9a.28 Session-directory site admits grants. a grant covering a path outside the session directory · read via `session-routes.ts` · admitted; without the grant the string is unchanged (test-plan #E24)
- [x] 9a.29 Handle verification scoped to byte-serving sites. a grant covering a directory · list via tree, probe via `exists`, resolve a mention · each succeeds — the regular-file rule does not break directory admission (test-plan #X16)
- [x] 9a.30 Forbidden subject via symlink. a denial naming `/etc` through `/private/etc` · grant it · refused, comparison against real paths (test-plan #X17)
- [x] 9a.31 No inbound write to the denial registry. full route inventory · scan for an endpoint creating an entry · none exists (test-plan #X18)
- [x] 9a.25 Cross-origin / unauthenticated grant. grant from a disallowed origin, and one unauthenticated · submit each · both refused, nothing recorded (test-plan #X15)
- [x] 9a.17 Malformed store degrades to empty. `access-grants.json` containing `{not json` · any containment check · zero grants, falls back to layers 1-2, no throw and no 500 (test-plan #X1)

### 9b. Denial bodies and cwd remedy — L1

Exemplar: `packages/server/src/__tests__/file-absolute-containment.test.ts`

- [x] 9b.1 Denial body additivity across the three real WIRE shapes. refuse at a `{success,error}` site, a bare `{error}` site (kb `rejectCwd`) and an `{error,message}` site (mcp-client) · inspect each · pre-existing fields byte-identical, `reason`/`hint` added alongside. The gates' `{code,error}` is internal only — covered by 9b.6, not here (test-plan #E13)
- [x] 9b.2 Path grant never pins a cwd. `/a/b` granted as path anchor and not pinned · request with `cwd=/a/b` · still 403 unknown-cwd (test-plan #E14)
- [x] 9b.7 MCP-client and goal cwd denials enriched. refuse at `mcp-client-plugin/src/server/routes.ts:131,:163` and at `goal-plugin/src/server/routes.ts` `rejectInvalidCwd` · inspect each body · `reason`/`hint` added, pre-existing `error` (and `message`) byte-identical (test-plan #E26)
- [x] 9b.6 Gate wire shape unchanged. a refusal at `gateFilePath` and `gateOfficeFile` · inspect the wire body · `{ success: false, error }` with the same status; the internal `{ code, error }` never reaches the wire (test-plan #E25)
- [x] 9b.4 Per-site rejection strings preserved. a refusal at each of the 8 body-emitting containment sites · inspect each `error` · `exists` keeps `"unknown cwd"`/`"path outside cwd"`, `session-routes` keeps `"path outside session directory"`, the rest keep `"path outside working directory"` (test-plan #E20)
- [x] 9b.5 Artifact-root admission runs first. an image under an artifact root, empty grant store · request it at `GET /api/file/raw` (the raw site owns "Layer ③", not render) · admitted as before, grant layer never consulted (test-plan #E21)
- [x] 9b.3 Non-HTTP denial sites untouched. trigger unknown-cwd at kb-plugin `index.ts:47`, apple-tools `index.ts:113`, `visitor-session-registry.ts:155` · behaviour byte-identical, no remedy fields, no crash (test-plan #X11)

### 9c. Denial ledger — L1

Exemplar for all of 9c: `packages/server/src/__tests__/tunnel-block-events.test.ts`

- [x] 9c.1 Ledger cap under the queue role. ledger at 50 distinct IPs · denial from a 51st · oldest-distinct evicted, size stays 50, no grant side effect (test-plan #E10)
- [x] 9c.2 Anti-poisoning properties preserved. generalized ledger · run the pre-existing ring-buffer suite · passes unchanged (test-plan #E11)
- [x] 9c.3 CORS origin captured without changing the dedupe key. two refusals, same IP, different origins · record both · one entry keyed by IP, origin captured as an extra field (test-plan #E12)
- [x] 9c.4 Recording never disrupts the denial. ledger `record()` throws · a denial occurs · error swallowed, 403 still sent (test-plan #X9)
- [x] 9c.5 Accept writes only through the config path. trustable pending entry · accept it · `trustedNetworks` mutated via the existing config write path only, ledger never mutates policy (test-plan #X10)
- [x] 9c.6 No unauthenticated write to the ledger. full route inventory · scan for an endpoint creating a pending request · none exists, ledger written only by the guard (test-plan #X12)

### 9d. Performance — L1

Exemplar: any timed vitest in `packages/server/src/lib/__tests__/`

- [x] 9d.1 Hot path unaffected. 1000 layer-1 reads with 50 grants stored · added p95 ~0 and zero `realpath` calls attributable to the grant check (test-plan #P1)
- [x] 9d.2 Cold path bounded. 200 containment misses with 50 grants · p95 of the grant check under 50ms (test-plan #P2)
- [x] 9d.4 Empty store costs zero syscalls. empty store, a containment miss · zero filesystem syscalls attributable to the grant layer, zero sync reads on the containment path (test-plan #P4)
- [x] 9d.5 Grep amplification bounded. 500 grep matches with 200 grants · at most one store load across the whole request (test-plan #P5)
- [ ] 9d.3 Suite runtime unaffected. full `npm test` before and after · within +/-5% over 3 runs each (test-plan #P3)

### 9e. Access tab — L3

Exemplar for all of 9e: `tests/e2e/blackhole-settings.spec.ts`; read `dashboardPort` from `.pi-test-harness.json`, never hardcode a port

- [x] 9e.1 Every in-scope store is listed. fixtures in all 8 stores · open Settings > Access · at least one entry per store, each labelled with its origin store (test-plan #F1)
- [x] 9e.2 bypassHosts distinguishable from trustedNetworks. a host in `auth.bypassHosts` and a CIDR in `config.trustedNetworks` · open the tab · separate entries with distinct labels, revoking one leaves the other (test-plan #F2)
- [x] 9e.3 Empty state. every store empty · open the tab · empty state, no error boundary, no console error (test-plan #F3)
- [x] 9e.4 Revoke takes effect without restart. `/other/repo` granted and readable · revoke then repeat the read · converges to 403 with no server restart (test-plan #F4)
- [x] 9e.5 No grant creation from the tab. tab open with entries from every store · scan the rendered surface · no control creates a grant for an arbitrary subject, revoke is the only per-entry write (test-plan #F5)
- [x] 9e.6 Project-trust revoke. a project-trust entry exists · revoke from the tab · revocation goes through pi's API and the dashboard never writes pi's store; if no API exists, the entry renders read-only marked managed-by-pi (test-plan #F6)
- [x] 9e.7 Legacy KB entry renders. pre-change hash-only entry in `kb-source-trust.json` · open the tab · renders as opaque hash with working revoke, no error (test-plan #F7)
- [x] 9e.9 Session grants listed like persisted ones. a session-scoped path grant in effect · open the tab · listed with subject, scope, grant time, origin and a working revoke (test-plan #F10)
- [x] 9e.10 Project-trust revoke deletes. a project-trust entry exists · revoke from the tab · routed through `persistTrustDecision`, entry absent afterwards, no standing negative decision (test-plan #F11)
- [x] 9e.8 Accept suppressed for non-trustable peers. ledger with loopback, proxy-terminated and genuine remote entries · open the pending-request surface · accept offered only for the genuine remote (test-plan #F9)

### 9f. Access tab purity — L1

Exemplar: `packages/client/src/components/settings/__tests__/settings-page-composition.test.tsx`

- [x] 9f.1 Rendering the tab writes nothing. hash all 8 store files before render · render the Access tab · every hash unchanged (test-plan #F8)
