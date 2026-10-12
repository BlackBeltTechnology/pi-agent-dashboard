## 1. Token rotation and file-following (D3, D4, D5) — tests first

- [ ] 1.1 In `packages/server/src/__tests__/local-token.test.ts`, add failing cases under a temp HOME: fresh install mints the token and writes `token-epoch`=1; a token with no epoch and `allowRotate: true` is replaced by a different 43-char base64url value and the epoch is written; epoch=1 → token reused byte-identical; a corrupt epoch (`""`, `"x"`, `"-1"`, 10+ digits) counts as missing, and `"1\n"` counts as 1; `ensureLocalToken(dir)` with no options never rotates (default `allowRotate: false`); `localTokenNeedsRotation` reports correctly without writing; token written + epoch missing (interrupted rotation) → rotates again; `allowRotate: false` on an epoch-less token → token unchanged, no epoch written; token and epoch files are `0600` (POSIX); a leftover `token.tmp-*` is removed by the next locked write. Verify they fail against the current `ensureLocalToken`.
- [ ] 1.2 Add failing cross-process cases that spawn child processes on a shared temp HOME. Check that two concurrent starters on (a) a fresh HOME and (b) an epoch-less token return the same value, equal to the file. Also check: a lock held by a dead pid is broken; a lock older than 30 s is broken; two waiters breaking the same stale lock produce exactly one break (`token.lock.breaking.*` `EEXIST`); a fresh lock that appears during a break is never removed; a holder whose lock was broken does not unlink the new lock; a waiter blocked past 35 s throws `LocalTokenLockTimeoutError`; the lock file is `0600`. Verify they fail.
- [ ] 1.3 Implement in `packages/server/src/auth/local-token.ts`: `REQUIRED_TOKEN_EPOCH = 1`, `localTokenNeedsRotation`, the `ensureLocalToken(dir?, { allowRotate = false })` signature, `writeAtomic` (tmp+fsync+rename, Windows rename retry, best-effort dir fsync, writing the token before the epoch, unlinking only its own tmp prefixes), and the D4 lock (claim with `link` from a private `token.lock.<nonce>`, `0600`, re-check under the lock, content-checked release and break, waiters return the on-disk value). Add `ensureLocalTokenAsync` (setTimeout wait) for the server and keep the sync variant (`Atomics.wait`) for the CLI. Keep case 2 lock-free. Verify 1.1–1.2 pass.
- [ ] 1.4 In `packages/server/src/cli.ts`, keep `safeEnsureLocalToken` on the default `allowRotate: false` with an explicit comment, and make it re-throw `LocalTokenLockTimeoutError` instead of returning `null`. Add a test that the timeout surfaces as a named CLI error. Add a CLI test showing that `open` on an epoch-less HOME leaves the token and epoch untouched (`cli` tests). Verify it passes.
- [ ] 1.5 Add failing tests for `createLocalTokenSource(dir)` in `local-token.test.ts`:
  - `current()` returns the file value;
  - after an atomic rewrite (new mtime/size/ino), `current()` returns the new value and `generation()` increments;
  - an unchanged file triggers no re-read (spy on `readFileSync`);
  - an empty, missing or unreadable file keeps the last good value and logs once.

  Implement, then verify they pass.
- [ ] 1.5a Make `createLocalCredentialVerifier` accept `token: string | LocalTokenSource` and re-derive its key when `generation` changes, and make `LocalTrustContext.proofKey` a re-deriving getter. Add tests in `local-credential.test.ts` and `local-proof-strict.test.ts`: a verifier and a trust context built on a source accept proofs and cookies minted with the new token after a rotation of the file, and reject old-token ones (`bad-mac` / invalid cookie), with no rebuild. Verify they pass.
- [ ] 1.5b In `server.ts`, call `await ensureLocalTokenAsync(undefined, { allowRotate: true })`, build one source, and pass it to the verifier and `createLocalTrustContext`. Add a two-server test on one temp HOME: server A runs; server B starts on a pre-epoch token and rotates; A then admits a proof minted with the new token and refuses one minted with the old token, without a restart. Verify it passes.
- [ ] 1.6 Add a test that a proof minted with the pre-rotation token is rejected `bad-mac` by a verifier built on the rotated token (`local-credential.test.ts`). Verify it passes.

## 2. Close the window (D1, D2) — tests first

- [ ] 2.1 In `local-credential.test.ts`, add failing cases with the window closed:
  - a raw header that matches the token → verdict `absent`, and `verifyLocalToken` is not called (spy);
  - a non-empty (trimmed, first-value) raw header → one "retired X-Pi-Local-Token" line per caller kind per 60 s carrying the suppressed count, never the header value;
  - a whitespace-only raw header → no log;
  - raw header + valid proof → `proof` verdict and no retired-header log.

  Verify they fail.
- [ ] 2.2 Implement in `packages/server/src/auth/local-credential.ts`: export `LEGACY_LOCAL_WINDOW_OPEN = false`; when `acceptLegacyToken` is false, skip the comparison and emit the rate-limited retired-header line. Verify 2.1 passes and the existing `rejects the raw token when acceptLegacyToken is off` still passes.
- [ ] 2.3 Add a failing wiring test showing the production server's loopback TCP bridge listener:
  - refuses an upgrade with no credential (`local-token-missing`);
  - refuses one carrying only a valid raw token (`local-token-missing` + the retired-header log);
  - refuses one with an invalid proof (`local-proof-invalid`);
  - admits one with a valid proof and returns a counter-proof.

  Use `bridge-local-token-upgrade.test.ts` or a `createServer` harness. Verify it fails.
- [ ] 2.3a (D8) Flip the seam defaults: `bridge-upgrade-auth.ts` grants the grace only when `requireTicketOnLoopback === false`; the `legacy` verdict admits only with an explicit `allowLegacyVerdict: true`; `acceptLegacyToken` is optional and defaults to `false`. Add tests showing that omitting each flag refuses. Verify they pass, and that tests using the legacy path pass the flags explicitly.
- [ ] 2.4 In `packages/server/src/server.ts`, wire `acceptLegacyToken: LEGACY_LOCAL_WINDOW_OPEN` (≈L623) and `requireTicketOnLoopback: !LEGACY_LOCAL_WINDOW_OPEN` (≈L1133). Rewrite both comments to say the window closed at 1.0.0 (see change: close-loopback-legacy-window). Verify 2.3 passes.
- [ ] 2.5 Add failing-then-passing HTTP cases showing that a raw `X-Pi-Local-Token` alone gets the same status and body as no credential on each of these routes: `POST /api/paired-devices` from non-loopback (401); `POST /api/pair/approve` (401, device stays pending); the local-code mint (no code); a strict-mode (`requireLocalProof`) `operate` route (denied). Extend `local-credential-sites.test.ts`, `local-proof-strict.test.ts` and `paired-devices.test.ts`.
- [ ] 2.6 Add a strict-mode test showing that a `pi_dash_local` cookie issued before rotation is rejected after it, and that a fresh bootstrap succeeds (`local-proof-strict.test.ts`).

## 3. Test harnesses and repo sweep

- [ ] 3.0 Inventory every unit test that sends the raw header or depends on the grace (`rg -l -i "x-pi-local-token|requireTicketOnLoopback: false|acceptLegacyToken: true" packages --glob '**/__tests__/**'`). Classify each file as either an explicit module seam (it passes the option itself → keep) or a dependency on production wiring (→ flip). Record the classification in the PR description. Known flip: `bridge-local-token-upgrade.test.ts:105-107` ("still admits a tokenless loopback bridge while the deprecation window is open") must assert refusal. Verify the classified list covers every grep hit.
- [ ] 3.1 Rework `packages/server/src/test-support/local-credential-stamp.ts` so it stamps from a proof instead of the `legacy` verdict. Update its 4 importers (`local-proof-strict`, `genuine-local`, `pairing-approval-dialog`, `pairing` tests) and `test-support/AGENTS.md`. Verify those suites pass.
- [ ] 3.2 (D7) Replace host-side raw-token operator calls with an in-container helper. Add `operatorCall(method, path, body)` in `tests/e2e/helpers/bridge-credential.ts`: it uses `docker exec` to run a Node script that mints a proof via `shared/local-credential-proof.ts`, dials the server's loopback literal, and prints the JSON result. Port these to it: `tests/e2e/helpers/bridge-credential.ts` (`operatorHeaders` callers), `tests/e2e/team/team-harness.ts`, `tests/e2e/remote-transcript-read.spec.ts`, and `tests/e2e/identity-matrix/{multi-user,browser-login}.spec.ts`. Flip `identity-matrix/security.spec.ts` so its host-side raw-token case expects the no-credential outcome (401), and add an in-container proof case that expects 200. Verify with `npm run test:e2e` on the docker harness (see `run-dashboard-e2e-local-changes`).
- [ ] 3.3 Send-site gate: confirm no non-test code builds a raw-header send. `rg -n -i "['\"]x-pi-local-token['\"]\s*:|LOCAL_TOKEN_HEADER\]\s*:" packages scripts docker --glob '!**/node_modules/**' --glob '!**/resources/server/**' --glob '!**/__tests__/**' --glob '!**/*.test.ts'` must return nothing. In addition, `LOCAL_TOKEN_HEADER` must be imported only under `packages/server/src/auth/`. Verify that the existing "shipped local tooling never sends the raw token" tests still pass.
- [ ] 3.3a Update `qa/tests/39-cli-open.sh` so the before/after counts use the new retired-header log line instead of the removed `DEPRECATED raw X-Pi-Local-Token accepted` string. Add a positive control that `curl -H 'X-Pi-Local-Token: x'` against the server increments the count, so the check cannot pass vacuously. Run the script in the macOS/Linux QA leg.
- [ ] 3.4 Fix stale comments that name the raw header as a credential: `auth/local-proof.ts:6`, `routes/pairing-routes.ts` (≈L11, 87, 96, 134, 169) and `pi/bridge-upgrade-auth.ts` (≈L54, plus the grace branch comment). Verify with a diff review.
- [ ] 3.5 Confirm the Electron build regenerates `packages/electron/resources/server/` from source, so no stale raw-header sender ships: run the Electron build script, then `rg -i x-pi-local-token packages/electron/resources/server/packages/extension` returns nothing.

## 4. Docs and records

- [ ] 4.1 CHANGELOG `## [Unreleased]`: add a **BREAKING** entry covering:
  - the raw header is retired and the grace has ended;
  - the token rotates once on the first 1.0.0 start, and other 1.0.0 servers on the HOME follow it without a restart;
  - upgrade steps: stop all instances → start → `npm run reload`;
  - rollback note: delete `local/token-epoch` before re-upgrading;
  - reload any Electron window left open across the upgrade, and re-run `pi-dashboard open` for a strict-mode browser.

  Verify the entry is present.
- [ ] 4.2 Delegate to DocScribe: update the auth / local-credential section of `docs/architecture.md`, plus any `docs/faq.md` entry naming `X-Pi-Local-Token` or the deprecation window, in caveman style. Verify with `grep -n "X-Pi-Local-Token\|deprecation window" docs/` that only historical mentions remain.
- [ ] 4.2a Fix `packages/mcp-server-plugin/README.md:13`, which says minting accepts `X-Pi-Local-Token`, so it names `X-Pi-Local-Proof` / `pi-dashboard token create`. Verify with a grep.
- [ ] 4.3 Update the `AGENTS.md` rows (or sidecars) for `auth/local-token.ts`, `auth/local-credential.ts`, `server.ts`, `cli.ts` and `pi/bridge-upgrade-auth.ts`, plus `packages/server/src/auth/AGENTS.md:21` (`hasLocalProof` = cookie OR proof) with the new exports and contracts plus `See change: close-loopback-legacy-window`.
- [ ] 4.4 At archive, edit the Purpose of `openspec/specs/local-ipc-allowlist-token/spec.md` so it names `X-Pi-Local-Proof` (proof of possession) instead of the raw header. Verify with `openspec validate --strict`.

## 5. Verification

- [ ] 5.1 Run `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` and confirm it is green. Fix any existing test that relied on the production wiring granting the grace.
- [ ] 5.2 `openspec validate close-loopback-legacy-window --strict` passes.
- [ ] 5.3 Manual QA, starting from a 0.9.x-era token file with no epoch:
  - start the server → the token file changes and `token-epoch`=1;
  - a current pi session reconnects after `npm run reload`;
  - a raw-token `wscat` upgrade to the loopback listener is refused and logs the retired-header line;
  - restart → the token is unchanged;
  - with a second 1.0.0 instance live in attach mode, a restart of the first on a pre-epoch HOME rotates, and the second instance's sessions keep working after their next reconnect.
