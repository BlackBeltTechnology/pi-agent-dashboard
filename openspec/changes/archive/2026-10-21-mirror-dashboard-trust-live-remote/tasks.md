# Tasks

Test tasks come from `test-plan.md`. That manifest is the source of truth for automated vs manual. Within each group, write the tests first, then implement until they pass.

## 1. Shared core (config, snapshot field, query types, resource digest, loopback predicate)

- [x] 1.1 Test (test-plan #E1), extending `packages/shared/src/__tests__/config-pi-trust-mirror.test.ts`. Input · trigger · observable: `liveQueryTimeoutMs` ∈ {unset, 49, 50, 1000, 1001, 5000, -1, NaN, Infinity, "300"} × bridge kind · `parsePiTrustMirror` + effective-timeout resolver · unset→300 local / 1000 remote, 49→50, 1001/5000→1000, -1→50, non-finite/string→default; `liveQuery` and `sources.yolo` default true.
- [x] 1.2 Test (test-plan #E2), extending `packages/shared/src/__tests__/pi-trust-mirror.test.ts`. Input · trigger · observable: snapshot `liveCount` ∈ {missing, -1, 1.5, "2", 0, 3} and a parent-era snapshot · `readPiTrustMirrorSnapshot` · invalid→0, 3→3, parent entries unchanged.
- [x] 1.3 Test (test-plan #E15), new `packages/shared/src/__tests__/pi-trust-resource-digest.test.ts`, harness after `pi-trust-mirror.test.ts` temp-dir fixtures. Input · trigger · observable: two mtime-preserving copies differing in nothing / `.pi/mcp.json` / `<cwd>/.agents/skills` / parent `.agents/skills` / `~/.agents/skills` · manifest + HMAC on both · equal, differ, differ, differ, equal.
- [x] 1.4 Test (test-plan #E16), same file as 1.3. Input · trigger · observable: empty set, symlink, fifo, unparseable `settings.json`, `packages` entry, `../ext` extension path, 1,000 vs 1,001 entries, 16 MiB vs 16 MiB + 1 B · `trustResourceManifest` · `null` for all except exactly 1,000 entries / exactly 16 MiB.
- [x] 1.5 Test (test-plan #E17), new golden `packages/shared/src/__tests__/pi-trust-resource-golden.test.ts`, harness after the parent `piTrustKey` golden cases in `pi-trust-mirror.test.ts`. Input · trigger · observable: installed pi `dist/core/trust-manager.js` + tree matrix · golden compare · our name list = pi's array literal; non-empty verdict = `hasTrustRequiringProjectResources`; manifest covers every consulted path.
- [x] 1.6 Test (test-plan #P1), timed, same file as 1.3. Input · trigger · observable: 200 files / 2 MiB on temp disk · 50 digest runs · p95 < 200 ms.
- [x] 1.7 Test (test-plan #E25), new `packages/shared/src/__tests__/loopback-host.test.ts`, harness after `local-credential-proof.test.ts`. Input · trigger · observable: `127.0.0.1`, `127.0.0.2`, `::1`, `localhost`, `10.0.0.5`, `[::ffff:127.0.0.1]` · shared predicate · loopback forms local, `10.0.0.5` remote.
- [x] 1.8 Implement: `PiTrustMirrorConfig` gains `liveQuery`, `liveQueryTimeoutMs` (local 300 / remote 1000, clamp 50–1000, non-finite → default) and `sources.yolo`; `PiTrustSnapshot.liveCount` gets a tolerant reader; query request/response types and validator (`packages/shared/src`). Verify that tasks 1.1–1.2 pass.
- [x] 1.9 Implement `trustResourceManifest(cwd, {home, signal})`:
  - async `fs/promises` walker in a Node-only shared module;
  - `c/` and `a<k>/` labels with k from 0;
  - files hashed; symlink / other types / settings parse failure / out-of-set refs → `null`;
  - caps 1,000 / 16 MiB.

  Also implement the shared loopback predicate. Verify that tasks 1.3–1.7 pass.
- [x] 1.10 Update `packages/shared/src/AGENTS.md` rows and the `pi-trust-mirror*.AGENTS.md` sidecars with `See change: mirror-dashboard-trust-live-remote`. Verify with `kb_search --doc-type agents trustResourceManifest`.

## 2. Server live sources and snapshot live count

- [x] 2.1 Test (test-plan #E3), extending `packages/server/src/__tests__/pi-trust-mirror-service.test.ts`. Input · trigger · observable: YOLO ∈ {scoped live, expired, ended, unscoped, env} × `sources.yolo` × root ∈ {`/w`, `~/Downloads/x`} · provider enumerate · counted only for (scoped live ∨ env) ∧ yolo ∧ not denied.
- [x] 2.2 Test (test-plan #E4), extending `packages/server/src/__tests__/worktree-init-trust.test.ts`. Input · trigger · observable: session trust `/tmp/r` at H1, then hook edited to H2 · enumerate · keyed `/private/tmp/r`, counted at H1, `hook-changed` at H2.
- [x] 2.3 Test (test-plan #E5), extending `packages/server/src/access/__tests__/access-grants.test.ts`. Input · trigger · observable: session grant on project root / non-root × choice {unset, true, false} · enumerate · counted only for root ∧ true.
- [x] 2.4 Test (test-plan #E6), extending `pi-trust-mirror-service.test.ts` and `packages/server/src/access/__tests__/yolo.test.ts`. Input · trigger · observable: grant add/revoke, worktree session add/revoke, YOLO activate/addRoot/end, expiry timer · transitions · `liveCount` sequence correct; rewrite precedes resolve; the file holds no live identities.
- [x] 2.5 Test (test-plan #E7), extending `worktree-init-trust.test.ts`. Input · trigger · observable: "until restarts" with choice false, then restart · record/reset · nothing on disk; not covered; gone after restart.
- [x] 2.6 Test (test-plan #E14), extending `pi-trust-mirror-service.test.ts` with temp dirs. Input · trigger · observable: `/r` session trust and YOLO `/w`, then each deleted and re-created · bridge verify of the server answer · trusted first, then `identity-mismatch`.
- [x] 2.7 Test (test-plan #E23), extending `packages/server/src/__tests__/pi-trust-mirror-service.test.ts` (host-project-trust section). Input · trigger · observable: `/r` with `.pi/mcp.json`, nothing recorded, session trust only · `host.isProjectTrusted` / `projectTrustSource` · true, "worktree-init (until dashboard restarts)".
- [x] 2.8 Test (test-plan #E24), extending `pi-trust-mirror-service.test.ts`. Input · trigger · observable: YOLO `/w` expiring at T; fake clock crosses T between lookup and proof · answer · `{covered:false}`.
- [x] 2.9 Test (test-plan #X4), extending `pi-trust-mirror-service.test.ts`. Input · trigger · observable: snapshot dir read-only · create a session grant · grant succeeds, one warning, disk unchanged.
- [x] 2.10 Test (test-plan #X5), extending `pi-trust-mirror-service.test.ts`. Input · trigger · observable: snapshot with `liveCount` 3 · boot · rewritten to 0 before the gateway accepts bridges.
- [x] 2.11 Implement:
  - notify calls in the session branches of `recordTrust`/`revokeTrust` and `recordGrant`/`revokeGrant`. These call the listener directly, never `save()`, so `worktree-init-trust.json` is still not written (worktree-init-hook TOFU requirement; asserted in 2.5);
  - `YoloController.setChangeListener` plus an unref'd expiry timer;
  - a `listSessionTrust()` export;
  - the live-entry provider: identity recorded at creation, in-memory choice map, key translation, YOLO liveness re-check;
  - `liveCount` maintenance with a synchronous rewrite;
  - `host.isProjectTrusted` over durable + live entries.

  Verify that tasks 2.1–2.10 pass.
- [x] 2.12 Accept a `piTrust` flag on the session-scope worktree-trust and session-grant routes, holding the choice in memory. Verify that 2.5 passes and the parent persisted-choice tests stay green.
- [x] 2.13 Update the `packages/server/src/access/AGENTS.md` (`yolo-session.ts`, `access-grants.ts`), `git-worktree/AGENTS.md` and mirror-service rows. Verify the rows name the live provider and listeners.

## 3. Server live trust query route

- [x] 3.1 Test (test-plan #E11), new `packages/server/src/__tests__/pi-trust-query-route.test.ts`, harness after `local-credential-fastify.test.ts` + `route-tier-gate.test.ts`. Input · trigger · observable: no credential / raw legacy token / login cookie / loopback + `X-Forwarded-For` + proof / loopback + proof / operate bearer / sub-operate bearer · `POST /api/pi-trust/query` · first four refused with no trust fields; proof and operate answered; sub-operate 403 `insufficient_scope`.
- [x] 3.2 Test (test-plan #E12), same file. Input · trigger · observable: body 8,192 vs 8,193 B; cwd 4,096 vs 4,097; NUL; `work/x`; symlinked cwd · query · 413 / 400 (never 500) / `{covered:false}` / in-bound answered.
- [x] 3.3 Test (test-plan #E13), same file. Input · trigger · observable: server `enabled`/`liveQuery` false, or cwd `~/.ssh/x` · query · `{covered:false}`.
- [x] 3.4 Test (test-plan #E18), same file. Input · trigger · observable: same device queries `/w/a` twice, then replays at `/w/b` · query + bridge verify · salts differ; replay → `identity-mismatch`.
- [x] 3.5 Test (test-plan #E19), same file. Input · trigger · observable: paired-device covered answer · inspect body · keys exactly `covered,salt,digest`.
- [x] 3.6 Test (test-plan #E20), same file. Input · trigger · observable: device 21st query in 10 s; local 201st; 2nd concurrent same-device digest; 5th global digest · burst · each → 429; one log line per window.
- [x] 3.7 Test (test-plan #E21), same file. Input · trigger · observable: 30 concurrent local queries covered by a live entry · burst · 0 refused, 0 permits taken.
- [x] 3.8 Test (test-plan #E22), extending `packages/server/src/__tests__/health-access-grants.test.ts`. Input · trigger · observable: injected clock, local 350 ms / remote 500 ms handling · query · `budgetMissed` +1 / +0 under `/api/health` `piTrustMirror.live`.
- [x] 3.9 Test (test-plan #E26), extending `packages/server/src/identity/__tests__/http-road-classification.test.ts`. Input · trigger · observable: route table · totality + `ROUTE_TIERS` lookup · route classified like `/api/ws-ticket`, tier `operate`.
- [x] 3.10 Test (test-plan #X7), same file as 3.1. Input · trigger · observable: 25 queries with cwd `"/w/\n[ok] \u001b[2Jx"` · rate-limit log · no `\n`/ESC; one line.
- [x] 3.11 Implement `POST /api/pi-trust/query`:
  - verified-proof-only local admission and operate bearer; `ROUTE_TIERS` + road classification;
  - body cap and validator, with throws → 400;
  - server switches and deny rules;
  - per-class fixed-window limiter; semaphore of 4 / 1 per device for remote digests only;
  - local identity answers and remote salted digests;
  - YOLO re-check, health counters, sanitized logs.

  Verify that tasks 3.1–3.10 pass.
- [x] 3.12 Run the `security-hardening` pass on the route (untrusted body/path, disclosure on refusal, covered vs not-covered timing). Record findings in the PR. Verify that each finding is addressed or justified.
  Findings (all addressed or justified):
  - Authentication runs in the route's `onRequest`, before the body is parsed or any trust state is read; every refusal is the same `401 {success:false,error:"unauthorized"}`.
  - Raw legacy token, login cookie, trusted network and a proof with a forwarding header are refused (tested).
  - Resource walk: `fs/promises` `opendir` iteration stops at the 1,000-entry cap, so a huge directory is never listed into memory (fixed during the pass).
  - Covered vs not-covered is observable to an authenticated paired device by timing and by `429`: justified, the answer itself discloses coverage to that device.
  - Log injection: cwd and device strings are control-character-stripped and capped (tested, #X7).
  - Replay: the digest binds the cwd key and a fresh salt (tested, #E18).
- [x] 3.13 Update `packages/server/src/routes/AGENTS.md` (new route row) and `server/src/auth/AGENTS.md` (`route-tier-gate.ts` entry). Verify the rows exist.

## 4. Bridge async live path

- [x] 4.1 Test (test-plan #E8), extending `packages/extension/src/__tests__/project-trust.test.ts`. Input · trigger · observable: decision table of enabled, liveQuery, session × coverInteractive, recorded entry, denied cwd, snapshot {cover, identity-mismatch, none}, liveCount {0,1}, remote · `decideBridgeProjectTrust` with fake `liveQuery` · query issued exactly when the spec conditions hold; never on snapshot cover.
- [x] 4.2 Test (test-plan #E9), same file. Input · trigger · observable: fake ECONNREFUSED / 401 / 403 / 404 / 429 / not covered / 500 / malformed / 302 / proof missing · handler · the mapped reason codes; redirect not followed.
- [x] 4.3 Test (test-plan #E10), same file. Input · trigger · observable: covered answer with valid proof while `isActive()` flips false · handler · `{trusted:"undecided"}`.
- [x] 4.4 Test (test-plan #P2), timed, same file. Input · trigger · observable: server that never answers, budget 300 · 20 runs · resolves ≤ 400 ms every run.
- [x] 4.5 Test (test-plan #P3), keeping the parent perf case in `project-trust.test.ts` green. Input · trigger · observable: 1,000-entry snapshot, cwd 20 deep, miss, liveCount 0 · 100 runs · snapshot part p95 < 20 ms.
- [x] 4.6 Test (test-plan #P4), same file. Input · trigger · observable: answer at 250 ms, walker reads 50 ms each · 20 runs · ≤ 400 ms with `live-timeout`; no open sockets or fs handles after.
- [x] 4.7 Test (test-plan #X1), same file. Input · trigger · observable: liveCount 1, closed port · project_trust · undecided ≤ 400 ms, `live-unreachable`.
- [x] 4.8 Test (test-plan #X2), same file. Input · trigger · observable: server delays 2 s · project_trust · undecided ≤ 400 ms, `live-timeout`; the server observes the abort.
- [x] 4.9 Test (test-plan #X3), same file. Input · trigger · observable: server 404 · project_trust · `live-unsupported`.
- [x] 4.10 Test (test-plan #X6), same file with the shared digest fixtures from 1.3. Input · trigger · observable: file under `.pi/extensions` changes between server and bridge hashing · verify · `identity-mismatch`.
- [x] 4.11 Implement:
  - async `decideBridgeProjectTrust` with step 5 (D2), `isRemoteBridge` via the shared predicate, and a per-call `AbortController` + `Promise.race`;
  - `fetch` with `redirect:"error"`, a minted local proof or bearer, and async identity / walker verification;
  - the reason codes, and a post-race `isActive()` check;
  - in `registerProjectTrust` (`bridge-handlers/lifecycle.ts`), the handler goes async, inside `safe()`, with its own try/catch.

  Verify that tasks 4.1–4.10 pass.
- [x] 4.12 Update `packages/extension/src/project-trust.ts.AGENTS.md`, `extension/src/AGENTS.md` and `bridge-handlers/AGENTS.md` rows. Verify the rows mention the async live step and the reason codes.

## 5. Client disclosure

- [x] 5.1 Test (test-plan #F1), extending `packages/client/src/components/settings/__tests__/PiTrustMirrorSection.test.tsx`. Input · trigger · observable: payload with YOLO `/w` until 14:30, `/r` until restart, env `/e` · render · three lifetime labels; `liveQuery`/`liveQueryTimeoutMs` controls; legend of 18 codes.
- [x] 5.2 Test (test-plan #F2; deviation: the grant prompt has no session-scope verdict and nothing in the client creates a session grant, so only the worktree-init "Trust until dashboard restarts" surface carries the checkbox; the server routes already accept `piTrust` for a session grant), extending `packages/client/src/components/__tests__/WorktreeInitButton.test.tsx` and `access-grant/__tests__/PiTrustCheckbox.test.tsx`. Input · trigger · observable: `sources.worktreeInit` {t,f}; session grant with `accessGrants` off · open/create · checked iff worktreeInit; grant unchecked; body carries `piTrust`.
- [x] 5.3 Test (test-plan #F3), extending `packages/client/src/components/access-grant/__tests__/YoloActivation.test.tsx`. Input · trigger · observable: `sources.yolo` {t,f} · render · disclosure present iff true.
- [x] 5.4 Test (test-plan #F4), extending `packages/mcp-client-plugin/src/client/__tests__/FolderMcpTrustBanner.test.tsx`. Input · trigger · observable: `/r` session trust only · render · names worktree-init trust "until the dashboard restarts"; no "not trusted" notice.
- [x] 5.5 Implement: the Access page live rows with a lifetime column, the new settings controls and the full code legend; the checkbox on the "Trust until dashboard restarts" path and on session-grant creation; the YOLO activation disclosure; the folder MCP banner lifetime text. Verify that tasks 5.1–5.4 pass.
- [x] 5.6 Update the client and mcp-client-plugin `AGENTS.md` rows for touched components. Verify the rows exist.

## 6. End-to-end, integration, docs

- [x] 6.1 E2E test (test-plan #F5), extending `tests/e2e/pi-trust-mirror.spec.ts` (harness port from `.pi-test-harness.json`). Input · trigger · observable: YOLO activated on `/workspace/a`, then ended · watch Access effective list · row appears then disappears without reload; never duplicated.
- [x] 6.2 E2E test (test-plan #F6), in `tests/e2e/pi-trust-mirror.spec.ts` (where the container helpers live; scoped to the server half like the parent change: the bridge decision on top is proven by 6.3). Input · trigger · observable: harness repo with `.pi/settings.json` and "Trust until dashboard restarts" · spawn headless in a new worktree, then restart the dashboard and spawn again · first session trusted (project resources loaded); after restart, not trusted through it.
- [x] 6.3 Integration test (test-plan #X8), new `packages/server/src/__tests__/pi-trust-live-integration.test.ts`, harness after `pi-trust-mirror-service.test.ts` temp-HOME setup. Input · trigger · observable: real server + bridge decision; trust `/r` until restart; decide `/r/wt`; restart; decide again · trusted, then `liveCount` 0, no query, undecided.
- [x] 6.4 Integration test (test-plan #X9), same file as 6.3. Input · trigger · observable: bridge configured remote (device token, non-loopback alias) on the same tree · decide, then edit `.pi/mcp.json` on the bridge copy · trusted via digest, then `identity-mismatch`.
- [x] 6.5 Delegate to DocScribe (caveman style):
  - the `docs/architecture.md` pi-trust-mirror section: live query, proofs, permits, `liveCount`;
  - `docs/faq.md` entries: remote pi without dashboard trust; `live-*` codes; `ssh -L` shared-home case; `.pi/settings.json` edits drop remote trust;
  - a release note: YOLO now confers pi trust by default.

  Verify by grepping `docs/` for `liveQueryTimeoutMs`, `live-not-covered` and `trustResourceManifest`.
- [x] 6.6 Run `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log`, `npm run quality:changed`, and `review-code` on the diff. Verify there are no failures and no blocking findings.
  Result: `npm test` parallel suite green apart from failures that also fail on an unmodified `origin/develop` in this environment (kb git-scope/perf, pi-version tracker/skew, tsc7-wrapper, verify-published-imports, explore-mockup wiring, large-resume-replay, eval-guard) plus the client-dist-dependent server specs; `test:real-process` 177 passed; the local review (`@review`, round 1) returned `BLOCKING_COUNT: 0`; CodeQL ratchet pass.
- [x] 6.7 Manual verification (test-plan #M1, manual-only): on two physical hosts sharing `/work/x` over NFS with a paired device, start pi on host B while host A trusts the folder. Confirm the trust decision lands within the remote budget and record the observed latency in the PR. (deferred: manual-only, validated post-merge)

## Workflow follow-up

- Commit the planning artifacts on `develop`, spawn the worktree, then run `ship-it` there.
- Archive syncs the `pi-trust-mirror`, `bridge-extension` and `mcp-client-folder-section` deltas.
