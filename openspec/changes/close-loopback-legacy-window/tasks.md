## 1. Tests first — token file, rotation, lock, source (L1, fail before section 2)

- [ ] 1.1 E1 (test-plan #E1) in `packages/server/src/__tests__/local-token.test.ts` (exemplar: the existing cases in that file): temp HOME, no `local/` dir · `ensureLocalToken(dir,{allowRotate:true})` · returns 43-char base64url, `token-epoch`=`1`, files `0600`, dir `0700`. Verify it fails first.
- [ ] 1.2 E2 (test-plan #E2) in `local-token.test.ts`, table-driven: token `T0` × epoch ∈ {absent, `""`, `x`, `-1`, `0`, `1`, `1\n`, `2`, `1234567890`} × allowRotate · `ensureLocalToken` · rotates only for invalid/<1 epochs with allowRotate, else returns `T0` byte-identical with the epoch unchanged.
- [ ] 1.3 E3 (test-plan #E3) in `local-token.test.ts`: token written, no epoch · `ensureLocalToken(dir,{allowRotate:true})` · new token, epoch `1`, and a second call returns the same value.
- [ ] 1.4 E4 (test-plan #E4) in `local-token.test.ts`: pre-epoch `T0` · `ensureLocalToken(dir)` · returns `T0`, no epoch, no lock file.
- [ ] 1.5 E5 (test-plan #E5) in `packages/server/src/__tests__/cli-open.test.ts` (exemplar: that file): pre-epoch HOME · `cmdOpen` path · token still `T0`, no `token-epoch`.
- [ ] 1.6 E6 (test-plan #E6) in `local-token.test.ts`: `token.tmp-99-ab`, `token-epoch.tmp-99-cd`, `notes.tmp-1` present · locked mint · only the two `token*.tmp-*` files are removed.
- [ ] 1.7 X1 (test-plan #X1): add the child-process race fixture (exemplar for the spawn glue: `packages/server/src/__tests__/cli-stop-real.test.ts`) and a case in `local-token.test.ts`: 2 children, fresh HOME · concurrent `ensureLocalToken` · same value = file.
- [ ] 1.8 X2 (test-plan #X2) in `local-token.test.ts` via the fixture: 2 children, pre-epoch `T0` · concurrent `ensureLocalToken({allowRotate:true})` · same value ≠ `T0` = file, epoch `1`.
- [ ] 1.9 X3 (test-plan #X3) in `local-token.test.ts`: `token.lock` naming a dead pid · rotation · lock broken, rotation completes.
- [ ] 1.10 X4 (test-plan #X4) in `local-token.test.ts` (stale bound 300 ms injected): live-pid lock aged 301 ms vs 299 ms · rotation · broken vs waits.
- [ ] 1.11 X5 (test-plan #X5) in `local-token.test.ts` via the fixture: stale lock, 2 child breakers · simultaneous break · exactly one `token.lock.breaking.*` link succeeds, the other gets `EEXIST`, and exactly one rotation happens.
- [ ] 1.12 X6 (test-plan #X6) in `local-token.test.ts` (break hook pauses after reading C): a fresh lock is claimed meanwhile · the breaker resumes · the fresh lock is still present and the breaker waits.
- [ ] 1.13 X7 (test-plan #X7) in `local-token.test.ts`: H's lock is broken and re-claimed by K · H releases · K's lock is still present.
- [ ] 1.14 X8 (test-plan #X8) in `local-token.test.ts` (wait bound 350 ms): lock held by the live test pid with `at` refreshed · `ensureLocalTokenAsync` · rejects `LocalTokenLockTimeoutError` after ≥ 350 ms, token unchanged.
- [ ] 1.15 X9 (test-plan #X9) in `cli-open.test.ts`: lock held on a fresh HOME · CLI `open` · exit `1`, stderr `local token lock busy (~/.pi/dashboard/local/token.lock) — another dashboard is writing the token; retry`.
- [ ] 1.16 X10 (test-plan #X10) in `local-token.test.ts` with an injected `renameSync`: `EPERM` ×3 then OK, and separately ×21 · rotation · first succeeds; second throws, tmp removed, token unchanged.
- [ ] 1.17 F1 (test-plan #F1) in `local-token.test.ts`: source on `T0` · `writeAtomic(token,T1)` then `current()` ×2 · `T1`, `generation` +1 once, and no `readFileSync` on the second call (spy).
- [ ] 1.18 F2 (test-plan #F2) in `local-token.test.ts`: source on `T0`, file emptied / deleted / mode `000` (POSIX) · `current()` · `T0` each time, one log per fault kind.

## 2. Implement token file, lock and source (D3, D4, D5)

- [ ] 2.1 In `packages/server/src/auth/local-token.ts`, implement:
  - `REQUIRED_TOKEN_EPOCH = 1`, the epoch parse (`^\d{1,9}$` after trim) and `localTokenNeedsRotation`;
  - `ensureLocalToken(dir?, {allowRotate=false})` and `ensureLocalTokenAsync`;
  - `writeAtomic` (tmp + fsync + rename, Windows retry 20×50 ms, best-effort dir fsync, removing only its own tmp prefixes);
  - the D4 link-claimed lock with injectable stale (30 s) and wait (35 s) bounds, content-checked release and break, `LocalTokenLockTimeoutError`;
  - `createLocalTokenSource`.

  Verify that test-plan #E1–E4, #E6, #X1–X8, #X10, #F1, #F2 pass.
- [ ] 2.2 In `packages/server/src/cli.ts`, keep `safeEnsureLocalToken` on the default `allowRotate:false` (with a comment), and re-throw `LocalTokenLockTimeoutError` as exit 1 + the agreed stderr message. Verify test-plan #E5, #X9 pass.

## 3. Tests first — window close, source consumers, seams (L1)

- [ ] 3.1 E7 (test-plan #E7) in `packages/server/src/__tests__/local-credential.test.ts` (exemplar: `rejects the raw token when acceptLegacyToken is off`): real raw token, no proof · `stamp()` · `absent`, `verifyLocalToken` spy 0 calls.
- [ ] 3.2 E8 (test-plan #E8) in `local-credential.test.ts`: raw `"wrong"` vs the real token · `stamp()` · both `absent`, indistinguishable output.
- [ ] 3.3 E9 (test-plan #E9) in `local-credential.test.ts`: raw `""`, `"   "`, `"x"`, `["x","y"]` · `stamp()` · retired line only for the last two, never containing the value.
- [ ] 3.4 E10 (test-plan #E10) in `local-credential.test.ts` (fake clock): 3 http raw headers at t=0/1/2 s, one at t=61 s · `stamp()` · 1 line, then a line carrying suppressed `2`.
- [ ] 3.5 E11 (test-plan #E11) in `local-credential.test.ts`: valid proof + raw header · `stamp()` · `proof`, no retired line.
- [ ] 3.6 E16 (test-plan #E16) in `local-credential.test.ts`: proof minted with `T0`, verifier on `T1` · verify · `bad-mac`.
- [ ] 3.7 F3 (test-plan #F3) in `local-credential.test.ts` + `local-proof-strict.test.ts`: verifier and trust context on a source over `T0`, file rotated to `T1` · verify a `T1` proof, a `T0` proof and a `T1` cookie · admitted / `bad-mac` / admitted, with no rebuild.
- [ ] 3.8 E15 (test-plan #E15) in `packages/server/src/__tests__/bridge-upgrade-auth.test.ts` (exemplar: its `decide` cases) + `local-credential.test.ts`: options omitted · decide / stamp · refused / refused / `absent`.
- [ ] 3.9 E12 (test-plan #E12) in `packages/server/src/__tests__/bridge-local-token-upgrade.test.ts` (exemplar: its real-gateway cases): loopback upgrade with {none, raw-only, invalid proof, valid proof, ticket} against production options · upgrade · `local-token-missing` / `local-token-missing` + retired line / `local-proof-invalid` / 101 + counter-proof / 101 without counter-proof.
- [ ] 3.10 E13 (test-plan #E13) in `bridge-local-token-upgrade.test.ts`: replace `:105-107` ("still admits a tokenless loopback bridge while the deprecation window is open") · tokenless loopback upgrade · refused.
- [ ] 3.11 E18 (test-plan #E18) in `packages/server/src/__tests__/ws-origin-gate.test.ts` (exemplar: its pi-gateway Origin cases): no Origin + no credential; `Origin: http://localhost:8000` + raw header · upgrade · `local-token-missing`; browser-origin with no retired line.
- [ ] 3.12 E14 (test-plan #E14) in `local-credential-sites.test.ts`, `paired-devices.test.ts` and `local-proof-strict.test.ts` (exemplar: the no-credential cases in each): raw-only vs none on `POST /api/paired-devices` (non-loopback), `POST /api/pair/approve`, local-code mint, strict `operate` route · inject · identical status and body per pair.
- [ ] 3.13 E17 (test-plan #E17) in `local-proof-strict.test.ts`: strict mode, cookie from `T0`, rotate to `T1` · `operate` request, then fresh bootstrap · denied, then admitted.
- [ ] 3.14 F4 (test-plan #F4) in `packages/server/src/__tests__/gateway-listener-wiring.test.ts` (exemplar: its `createServer` harness): server A on `T0`, epoch removed, server B started on the same HOME · `T1` and `T0` proof upgrades to A · admitted / refused, with no restart of A.
- [ ] 3.15 P1 (test-plan #P1) in `local-credential.test.ts` (timed): 10 000 valid-proof verifications, unchanged file, source vs string verifier · measure · p99 delta < 1 ms and `readFileSync` count 0 after warm-up.
- [ ] 3.16 E19 (test-plan #E19) in the existing "shipped local tooling never sends the raw token" test (find it with `rg -l "never sends the raw token" packages`): repo source minus tests and `resources/server` · static scan · 0 raw-header send sites; `LOCAL_TOKEN_HEADER` imported only under `packages/server/src/auth/`.

## 4. Implement window close, source wiring, seams (D1, D2, D5, D8)

- [ ] 4.1 In `packages/server/src/auth/local-credential.ts`:
  - export `LEGACY_LOCAL_WINDOW_OPEN = false`;
  - make `acceptLegacyToken` optional, defaulting to `false`;
  - with the window closed, skip the comparison and emit the rate-limited retired-header line (non-empty trimmed first value, no proof);
  - accept `token: string | LocalTokenSource` and re-derive `key` (verify and counter-proof) on a `generation` change.

  Verify that test-plan #E7–E11, #E16, #P1 pass.
- [ ] 4.2 In `auth/local-proof.ts`, make `proofKey` a re-deriving getter over the source; keep the string overload used at `routes/pairing-routes.ts:142`. Verify test-plan #F3 and #E17 pass.
- [ ] 4.3 In `pi/bridge-upgrade-auth.ts`, grant the grace only when `requireTicketOnLoopback === false`, and admit the `legacy` verdict only with `allowLegacyVerdict: true`. Verify test-plan #E15 passes.
- [ ] 4.4 In `server.ts`:
  - call `await ensureLocalTokenAsync(undefined,{allowRotate:true})` (≈L617);
  - build one source and pass it to the verifier and `createLocalTrustContext`;
  - wire `acceptLegacyToken: LEGACY_LOCAL_WINDOW_OPEN` (≈L623) and `requireTicketOnLoopback: !LEGACY_LOCAL_WINDOW_OPEN` (≈L1133);
  - rewrite both comments (see change: close-loopback-legacy-window).

  Verify that test-plan #E12–E14, #E18, #F4 pass.
- [ ] 4.5 Inventory: run `rg -l -i "x-pi-local-token|requireTicketOnLoopback: false|acceptLegacyToken: true" packages --glob '**/__tests__/**'`. Classify each file as an explicit seam (passes the flags itself → keep, add `allowLegacyVerdict` where needed) or a dependency on production wiring (→ flip). Record the classification in the PR description. Rework `test-support/local-credential-stamp.ts` to stamp from a proof and update its 4 importers and `test-support/AGENTS.md`. Verify every grep hit is classified and the affected suites pass.

## 5. Harness and smoke (L2, L3)

- [ ] 5.1 X12 (test-plan #X12) in `qa/tests/39-cli-open.sh` (exemplar: its current X8 block): CLI verbs, then `curl -H 'X-Pi-Local-Token: x'` · count retired-header lines · +0 after the verbs, +1 after the curl (replaces the vacuous `DEPRECATED raw` count).
- [ ] 5.2 X13 (test-plan #X13) in `qa/tests/39-cli-open.sh`: delete `token-epoch`, start, restart · read `token` each time · changes on the first start, unchanged after the restart, epoch `1`.
- [ ] 5.3 X11 (test-plan #X11) in `qa/tests/28-gateway-windows.ps1` (exemplar: its token-ACL block): background 5 ms reader loop, pre-epoch token · server start · rotation succeeds, no empty read, epoch `1`.
- [ ] 5.4 (D7) Add `operatorCall(method, path, body)` to `tests/e2e/helpers/bridge-credential.ts`. It uses `docker exec` to run a Node script that mints a proof with `shared/local-credential-proof.ts`, dials loopback in the container, and prints JSON. Port the `operatorHeaders` callers, `tests/e2e/team/team-harness.ts`, `tests/e2e/remote-transcript-read.spec.ts` and `tests/e2e/identity-matrix/{multi-user,browser-login}.spec.ts` to it. Verify with `npm run test:e2e` (see `run-dashboard-e2e-local-changes`).
- [ ] 5.5 E20 (test-plan #E20) in `tests/e2e/identity-matrix/security.spec.ts` (exemplar: its current raw-token case): host-side raw-token `POST /api/pair/approve` and in-container `operatorCall` · request · 401 / 200.
- [ ] 5.6 E21 (test-plan #E21) in `tests/e2e/remote-transcript-read.spec.ts` (exemplar: its existing bridge setup): fresh pairing code · redeem → `operatorCall` approve → bearer → ticket → bridge dial · the bridge registers its session id.

## 6. Sweep, docs, records

- [ ] 6.1 Fix stale comments that name the raw header as a credential: `auth/local-proof.ts:6`, `routes/pairing-routes.ts` (≈L11, 87, 96, 134, 169), and `pi/bridge-upgrade-auth.ts` (≈L54 + the grace branch). Verify with a diff review.
- [ ] 6.2 Confirm the Electron build regenerates `packages/electron/resources/server/` from source: run the Electron build script, then `rg -i "x-pi-local-token['\"]?\s*:" packages/electron/resources/server/packages/extension` returns nothing.
- [ ] 6.3 CHANGELOG `## [Unreleased]`: add a **BREAKING** entry covering:
  - the raw header is retired and the grace has ended;
  - the token rotates once on the first 1.0.0 start, and other 1.0.0 servers on the HOME follow it without a restart;
  - upgrade steps: stop every instance (0.9.x peers cannot follow) → start → `npm run reload`;
  - reload any Electron window left open across the upgrade, and re-run `pi-dashboard open` for a strict-mode browser;
  - rollback: delete `local/token-epoch` before re-upgrading.

  Verify the entry is present.
- [ ] 6.4 Delegate to DocScribe: update the auth / local-credential section of `docs/architecture.md`, plus any `docs/faq.md` entry naming `X-Pi-Local-Token` or the deprecation window, in caveman style. Verify with `grep -n "X-Pi-Local-Token\|deprecation window" docs/` that only historical mentions remain.
- [ ] 6.5 Fix `packages/mcp-server-plugin/README.md:13` to name `X-Pi-Local-Proof` / `pi-dashboard token create`. Update the `AGENTS.md` rows or sidecars for `auth/local-token.ts`, `auth/local-credential.ts`, `auth/local-proof.ts`, `server.ts`, `cli.ts` and `pi/bridge-upgrade-auth.ts`, plus `packages/server/src/auth/AGENTS.md:21`, each with `See change: close-loopback-legacy-window`. Verify with a grep.
- [ ] 6.6 At archive, edit the Purpose of `openspec/specs/local-ipc-allowlist-token/spec.md` so it names `X-Pi-Local-Proof` instead of the raw header. Verify with `openspec validate --strict`.

## 7. Verification and manual QA

- [ ] 7.1 Run `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` and confirm it is green; `openspec validate close-loopback-legacy-window --strict` passes.
- [ ] 7.2 M1 (test-plan: manual-only): with an Electron window open on 0.9.x under strict mode, upgrade the server to 1.0.0 · the window loses local proof until reloaded, and works after a reload.
- [ ] 7.3 M2 (test-plan: manual-only): connect a real 0.9.0-era pre-proof pi bridge to a 1.0.0 server · it is refused and the server logs the retired-header line; `npm run reload` with the current extension reconnects.
- [ ] 7.4 M3 (test-plan: manual-only): go 1.0.0 → 0.9.x → delete `token-epoch` → 1.0.0 · 0.9.x starts on the rotated token, and the re-upgrade rotates again.

## Rebase note (from `fix-pairing-approval-credential`)

`fix-pairing-approval-credential` also MODIFIES `qr-device-pairing` "Compare-code approval; code consumed on approval, not redemption" and `trust-and-credential-boundaries` "Opt-in local proof for loopback trust" (adds the refusal `reason`/`remedies` paragraph and the `next=` paragraph). Whichever archives second must rebase both MODIFIED blocks onto the shipped text, keeping both sets of additions (design.md "Ordering").
