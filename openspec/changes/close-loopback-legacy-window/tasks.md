## 1. Token rotation (D3, D4) — tests first

- [ ] 1.1 In `packages/server/src/__tests__/local-token.test.ts`, add failing cases under a temp HOME: fresh install mints the token and writes `token-epoch`=1; a token with no epoch is replaced by a different 43-char base64url value and the epoch is written; epoch=1 → token reused byte-identical across two calls; token written + epoch missing (interrupted rotation) → rotates again; token and epoch files are `0600` (POSIX). Verify they fail against the current `ensureLocalToken`.
- [ ] 1.2 Add failing concurrency cases: a held fresh `token.rotate.lock` → the caller waits and returns the token the winner wrote; a lock older than 10 s is removed and rotation proceeds; two parallel `ensureLocalToken` calls on an epoch-less token return the same value. Verify they fail.
- [ ] 1.3 Implement in `packages/server/src/auth/local-token.ts`: `REQUIRED_TOKEN_EPOCH = 1`, the epoch file, atomic tmp+fsync+rename writes (token before epoch), and the `wx` lock with re-check, bounded poll and stale-lock removal. Keep the case 1/2 path lock-free. Verify 1.1–1.2 pass.
- [ ] 1.4 Add a test that a proof minted with the pre-rotation token is rejected `bad-mac` by a verifier built on the rotated token (`local-credential.test.ts`). Verify it passes.

## 2. Close the window (D1, D2) — tests first

- [ ] 2.1 In `local-credential.test.ts`, add failing cases with the window closed: a raw header that matches the token → verdict `absent`, `verifyLocalToken` not called (spy); a non-empty raw header → one `outdated client` log line per caller kind per 60 s carrying the suppressed count, never the header value; raw header + valid proof → `proof`. Verify they fail.
- [ ] 2.2 Implement in `packages/server/src/auth/local-credential.ts`: export `LEGACY_LOCAL_WINDOW_OPEN = false`; when `acceptLegacyToken` is false, skip the comparison and emit the rate-limited outdated-client line. Verify 2.1 passes and the existing `rejects the raw token when acceptLegacyToken is off` still passes.
- [ ] 2.3 Add a failing wiring test asserting the production server refuses a loopback TCP bridge upgrade with no credential (`local-token-missing`) and one carrying only a valid raw token (`local-token-missing` + outdated-client log), and admits one with a valid proof plus counter-proof. Use `bridge-local-token-upgrade.test.ts` or a `createServer` inject harness. Verify it fails.
- [ ] 2.4 In `packages/server/src/server.ts`, wire `acceptLegacyToken: LEGACY_LOCAL_WINDOW_OPEN` (≈L623) and `requireTicketOnLoopback: !LEGACY_LOCAL_WINDOW_OPEN` (≈L1133); rewrite both comments to say the window closed at 1.0.0 (see change: close-loopback-legacy-window). Verify 2.3 passes.
- [ ] 2.5 Add failing-then-passing HTTP cases showing that a raw `X-Pi-Local-Token` alone gets the same status and body as no credential on: `POST /api/paired-devices` from non-loopback (401); `POST /api/pair/approve` (401, device stays pending); local-code mint (no code); a strict-mode (`requireLocalProof`) `operate` route (denied). Extend `local-credential-sites.test.ts` / `local-proof-strict.test.ts` / `paired-devices.test.ts`.
- [ ] 2.6 Add a strict-mode test where a `pi_dash_local` cookie issued before rotation is rejected after it, and a fresh bootstrap succeeds (`local-proof-strict.test.ts`).

## 3. Client and repo sweep

- [ ] 3.1 `rg -n -i "x-pi-local-token" packages scripts docker qa tests --glob '!**/node_modules/**' --glob '!**/__tests__/**'` lists only server-side definitions and comments, with no shipped sender. Verify the existing "shipped local tooling never sends the raw token" tests still pass.
- [ ] 3.2 Update the `local-proof.ts` header comment, which still names `X-Pi-Local-Token` as a proof, to say `X-Pi-Local-Proof`. Verify with a diff review.

## 4. Docs and records

- [ ] 4.1 CHANGELOG `## [Unreleased]`: add a **BREAKING** entry listing the raw header retired, the grace ended, the one-time token rotation, the upgrade steps (stop all instances → start → `npm run reload`), and the rollback note (delete `local/token-epoch` before re-upgrading). Verify the entry is present.
- [ ] 4.2 Delegate to DocScribe: update the auth / local-credential section of `docs/architecture.md`, plus any `docs/faq.md` entry naming `X-Pi-Local-Token` or the deprecation window, in caveman style. Verify with `grep -n "X-Pi-Local-Token\|deprecation window" docs/` that only historical mentions remain.
- [ ] 4.3 Update the `AGENTS.md` rows (or sidecars) for `auth/local-token.ts`, `auth/local-credential.ts`, `server.ts` and `pi/bridge-upgrade-auth.ts` with the new exports and contracts plus `See change: close-loopback-legacy-window`.
- [ ] 4.4 At archive, edit the Purpose of `openspec/specs/local-ipc-allowlist-token/spec.md` so it names `X-Pi-Local-Proof` (proof of possession) instead of the raw header. Verify with `openspec validate --strict`.

## 5. Verification

- [ ] 5.1 Run `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` and confirm it is green. Fix any existing test that relied on the production wiring granting the grace.
- [ ] 5.2 `openspec validate close-loopback-legacy-window --strict` passes.
- [ ] 5.3 Manual QA: with a 0.9.x-era token file and no epoch, start the server → the token file changes and `token-epoch`=1; a current pi session reconnects after `npm run reload`; a raw-token `curl` / `wscat` upgrade to the loopback listener is refused and logged as an outdated client; restart → the token is unchanged.
