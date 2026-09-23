## 1. Lazy full icon set (client-build-config)

- [ ] 1.1 Record the baseline: `npm run build`, then list `modulepreload` hrefs + byte sizes from `packages/client/dist/index.html` into this change's notes (expect `mdi-*.js` ≈ 2.78 MB). Verify: numbers captured.
- [ ] 1.2 Rewrite `packages/client/src/__tests__/mdi-chunk-size.test.ts` to the modified spec: no chunk reachable from `index.html` (entry + `modulepreload` + their static imports) contains `mdiZodiacAquarius`; some emitted chunk does; gz `index` ≤ 900 KB. Verify: fails against the current build.
- [ ] 1.3 Add `loadMdiIconSet()` (memoized `import("@mdi/js/commonjs/mdi.js")`) and `useMdiIconByKey(key)` to `packages/client-utils/src/` with unit tests: unknown key → `null`, valid key → path after load, concurrent callers → a single import. Verify: new tests pass.
- [ ] 1.4 Switch `ActionList.tsx` and `StatusPill.tsx` to `useMdiIconByKey`, rendering a fixed-size empty slot while loading. Update their tests to `findBy*`. Verify: client-utils tests pass.
- [ ] 1.5 Make `packages/client/src/lib/preview/mdi-icon-lookup.ts` delegate to the client-utils hook, and switch `GenericExtensionDialog.tsx` + `FooterSegmentSlot.tsx` from `resolveMdiIcon` to the hook. Verify: extension-ui tests pass, including "unknown icon renders nothing".
- [ ] 1.6 Remove the `mdi` entry from `manualChunks` in `packages/client/vite.config.ts` and update the adjacent comment. Verify: `npm run build` shows no `dynamic import will not move module` line for `@mdi/js`; `index.html` has no `mdi-` preload; test 1.2 passes.
- [ ] 1.7 Dev-server check: `npm run dev`, open an extension-UI dialog with an icon key, and confirm the icon renders. If CJS interop fails, switch to the design D1 virtual-module fallback. Verify: icon visible in dev.
- [ ] 1.8 Record after-numbers next to 1.1 (cold-landing preload bytes). Verify: `mdi` ≈ 2.78 MB is gone from the landing set.

## 2. Browser WS diagnostics (browser-ws-diagnostics)

- [ ] 2.1 Test first: browser-gateway close logs `code=`, `reason=` (JSON-quoted), `lifetime=`, `frames=` for a 1000/"bye" close and for an abrupt `terminate()` (1006). Verify: fails.
- [ ] 2.2 Implement per-socket `connectedAt` + inbound frame counter and the new close line in `packages/server/src/pairing/browser-gateway.ts` (keep the existing prefix). Verify: 2.1 passes.
- [ ] 2.3 Test first (fake timers, injectable `browserPingIntervalMs`): a responsive socket survives; a socket with no pongs for 2 intervals is terminated and a `keepalive timeout` line is logged; `stop()` clears the timer. Verify: fails.
- [ ] 2.4 Implement the keepalive (30 s default, `missedPongs >= 2` → `terminate()`), with cleanup in `stop()`. Verify: 2.3 passes.
- [ ] 2.5 Test first for `packages/server/src/auth/ws-upgrade-reject-log.ts`: forwarding-header names present, values absent; `ticket=present` without the ticket value; no cookie value; 20 rejections in 60 s → 1 line, and the next line reports `suppressed=19`; map stays ≤ 256 entries under 1000 distinct peers. Verify: fails.
- [ ] 2.6 Implement the logger (reuse the forwarding-header list from `localhost-guard.ts`) and call it from every rejecting `socket.destroy()` branch of the upgrade handler in `packages/server/src/server.ts` (enumerate them all, not just 400/401/403 at ~L2925–2950). Verify: 2.5 passes, plus an integration test that a forwarded `/ws` upgrade rejected with 403 emits one line.

## 3. Mobile tool groups (mobile-resilience)

- [ ] 3.1 Test first in `ToolBurstGroup` tests: a running group on mobile (`useMobile` → true, `toolGroupDefaultCollapsed:false`) renders collapsed with the live header; a tap expands it; desktop still auto-expands. Verify: the mobile case fails.
- [ ] 3.2 Gate `autoOpen` on `isMobile` in `packages/client/src/components/chat/ToolBurstGroup.tsx`, and update its doc comment. Verify: 3.1 passes.

## 4. Closeout

- [ ] 4.1 Full test run (`set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log`) plus `npm run quality:changed`. Verify: green.
- [ ] 4.2 Update DOX rows: `packages/client-utils/src/AGENTS.md` (new loader/hook, ActionList/StatusPill), `packages/client/src/lib/preview/AGENTS.md`, `packages/client/src/components/chat/AGENTS.md` (ToolBurstGroup), `packages/server/src/pairing/AGENTS.md` (browser-gateway), `packages/server/src/auth/AGENTS.md` (new logger), and `server.ts` row. Verify: `See change: harden-ios-safari-memory-and-ws-diagnostics` on each.
- [ ] 4.3 Add a CHANGELOG `## [Unreleased]` entry (Fixed: iOS cold-load weight; Added: browser WS close/keepalive/upgrade-rejection logging). Verify: entry present.
- [ ] 4.4 `review-code` pass on the diff; `security-hardening` pass on 2.5/2.6 (no secret leakage, bounded map). Verify: findings resolved.
- [ ] 4.5 Manual QA on an iPhone (Safari, via tunnel): cold-load a large session, stream a turn, and confirm the server log shows the new close/keepalive lines on backgrounding. Verify: reported on issue #712.
