## 1. Probe hook

- [x] 1.1 Add `packages/client/src/hooks/useAnthropicPeerProbe.ts`: fetch `/api/health`, find the
      `flows-anthropic-bridge` plugin row, derive `peerMissing` strictly from
      `lastProbe.peers["@pi/anthropic-messages"].ok === false`, expose the probe `reason`. Follow the
      shape of `usePiCompatibility.ts` (same endpoint, same 60 s `POLL_INTERVAL_MS` precedent);
      re-read on mount, on a mounted poll, on window focus, and on `pi-package-event`
      `package_operation_complete`
- [x] 1.2 Import the probe map key from `PEER_AM_LEGACY` and the install source from the existing
      `RECOMMENDED_EXTENSIONS` entry — no new copies of either string

## 2. Row hint

- [x] 2.1 Add `peerMissing` / `peerReason` / `onInstallPeer` props to `OAuthProviderRow` and render an
      `InlineMessage` below the row header per `mockups/ui-plan.md`: `severity="warning"` + single
      `Install peer` pill for the missing state, `severity="info"` for the installed-pending-reprobe
      state. Static copy through `i18nT`
- [x] 2.2 Hold the post-install state in an explicit latch (not `statusFor(source) === "success"`,
      which auto-clears after 3 s); release it when the probe reports the peer resolving
- [x] 2.3 Wire the install to `usePackageOperations("global", undefined)` — third arg omitted — and
      render `statusFor` / `messageFor` for that source
- [x] 2.4 In `ProviderAuthSection`, call `useAnthropicPeerProbe()` once and pass the derived props to
      the OAuth rows

## 3. Automated scenarios — L1 unit (vitest)

Harness exemplar for 3.1–3.25: `packages/client/src/__tests__/ProviderAuthSection.test.tsx` (copy its
render + fetch-mock glue). Exemplar for 3.26:
`packages/flows-anthropic-bridge-plugin/src/__tests__/peer-probe.test.ts`.

- [x] 3.1 E1 hint renders · authenticated anthropic row + probe peer `{ok:false}` · section renders ·
      hint present naming `@blackbelt-technology/pi-anthropic-messages` with an install control
      (test-plan #E1)
- [x] 3.2 E2 peer resolving · same payload with `{ok:true}` · section renders · no hint node
      (test-plan #E2)
- [x] 3.3 E3 signed-out gate · `authenticated:false` + probe `{ok:false}` · section renders · no hint
      node (test-plan #E3)
- [x] 3.4 E4 other OAuth providers · authenticated `openai-codex` + `github-copilot` + probe
      `{ok:false}` · section renders · no hint on either row (test-plan #E4)
- [x] 3.5 E5 API-key row · `anthropic-api` row + probe `{ok:false}` · section renders · no hint in the
      API Keys list (test-plan #E5)
- [x] 3.6 E6 status is not the signal · `status:"waiting_peers"` with AM `{ok:true}` and pi-flows
      `{ok:false}` · authenticated row renders · no hint node (test-plan #E6)
- [x] 3.7 E7 legacy peers key only · probe carrying the scoped key instead of the legacy one · section
      renders · no hint node (test-plan #E7)
- [x] 3.8 E8 import failure withholds install · `{ok:false, reason:"import failed: Unexpected token"}`
      · section renders · reason reported, no install control (test-plan #E8)
- [x] 3.9 E9 non-import reasons keep install · `MODULE_NOT_FOUND`, absent reason, near-miss prefix
      `"imported failed: x"` · section renders · install control present in all three (test-plan #E9)
- [x] 3.10 F1 clears on a fresh probe · hint shown, next read returns `{ok:true}` · re-read ·
      converges to no hint without a section remount (test-plan #F1)
- [x] 3.11 F2 re-read on window focus · hint shown, server now `{ok:true}` · `focus` event ·
      converges to no hint (test-plan #F2)
- [x] 3.12 F3 re-read on package-operation completion · hint shown, server now `{ok:true}` ·
      `pi-package-event` `package_operation_complete` success · converges to no hint (test-plan #F3)
- [x] 3.13 F4 first probe on an open focused tab · mounted with no `lastProbe`, payload later gains
      `{ok:false}` · advance fake timers one poll interval, no focus/package event · hint appears
      (test-plan #F4)
- [x] 3.14 F5 poll stops with the section · mounted polling section · unmount then advance two
      intervals · zero further `/api/health` requests (test-plan #F5)
- [x] 3.15 F6 latch survives the queue success window · install completes, probe still `{ok:false}` ·
      advance fake timers past 3000 ms · informational state still rendered, install still withdrawn
      (test-plan #F6)
- [x] 3.16 F7 latch releases on a resolving probe · latched informational state · later read returns
      `{ok:true}` · whole surface gone (test-plan #F7)
- [x] 3.17 F8 duplicate enqueue blocked · install queued/running for the source · second activation ·
      exactly one `(source, install)` enqueue, control shows queued/running (test-plan #F8)
- [x] 3.18 F9 non-blocking · hint rendered on the authenticated row · inspect the row · Sign Out
      enabled, Connected marker + expiry unchanged, no modal role in the tree (test-plan #F9)
- [x] 3.19 X1 fail-open on a rejected request · `/api/health` fetch rejects · section renders · no
      hint node, no unhandled rejection (test-plan #X1)
- [x] 3.20 X2 fail-open on a non-OK status · `/api/health` returns 500 · section renders · no hint
      node (test-plan #X2)
- [x] 3.21 X3 fail-open while loading · `/api/health` never settles · first paint, no timer advance ·
      no hint node (test-plan #X3)
- [x] 3.22 X4 fail-open with no bridge row · `plugins[]` lacks `flows-anthropic-bridge` · section
      renders · no hint node (test-plan #X4)
- [x] 3.23 X5 fail-open with no lastProbe · bridge row without `lastProbe` · section renders · no hint
      node (test-plan #X5)
- [x] 3.24 X6 fail-open on a malformed payload · `plugins` absent/not an array, `lastProbe.peers`
      absent/not an object · section renders · no hint node, no throw (test-plan #X6)
- [x] 3.25 X7 install failure surfaced · queue reports an error for the source · after the operator
      activated install · the source's error message renders inside the hint and the control returns
      to an actionable state (test-plan #X7)
- [x] 3.26 E10 bridge/client prefix coupling · probe forced to fail at the import step · bridge builds
      its status payload · emitted `reason` starts with `import failed:` (test-plan #E10)

## 4. Manual verification (deferred post-merge)

- [x] 4.1 F10 visual fit of the warning under the green Connected marker, dark + light: reads as
      "next step", not "sign-in failed" (test-plan: manual-only)

## 5. Verify and land

- [x] 5.1 Run `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` and confirm the suite is green
- [x] 5.2 Run `npm run quality:changed` (`code-quality` skill) and clear any new findings
- [x] 5.3 Invoke the `review-code` skill on the diff (done: isolated @review pass, no blocking findings;
      three nits applied), then `npm run build` +
      `curl -X POST http://localhost:8000/api/restart` and eyeball the Provider Authentication section
- [x] 5.4 Update the nearest directory `AGENTS.md` rows for every touched file (`See change:
      warn-missing-anthropic-messages-peer`)
