## 1. Predicate and effective-host resolution (implementation)

- [x] 1.1 Implement the pure containment helper in `packages/client/src/lib/gateway/gateway-config-ops.ts` (exact IP, wildcard incl. multi-segment, CIDR), exported for tests
- [x] 1.2 Implement the predicate in the documented order: loopback exemption → non-IPv4 fail-open → `0.0.0.0` → containment; evaluate the union of `auth.bypassHosts` and top-level `trustedNetworks`; return the unreachable entries, not a boolean
- [x] 1.3 Implement `pendingBindHost` (re-evaluate `--host` → `PI_DASHBOARD_HOST` → `config.bindHost` → default against current config) and capture `resolvedBindHost` frozen at boot
- [x] 1.4 Decide the shared home for the predicate and the well-known-range table so client and server cannot drift; record the choice under `design.md` Open Questions

## 2. Server surfaces (implementation)

- [x] 2.1 Add the top-level `reachability` object (`resolvedBindHost`, `pendingBindHost`, `unreachable[]`) to the `GET /api/config` response in `packages/server/src/routes/system-routes.ts`, failure-isolated like `eventLoopDelay` / `storeTrim` / `notifyLog`
- [x] 2.2 Strip `reachability` on the config write path, in the same manner as `resolvedTrustedNetworks` (`config-api.ts`)
- [x] 2.3 Emit the `[bind-reachability]`-prefixed `console.warn` line at startup when the predicate reports unreachable entries, matching the `[openspec-poll]` / `[hydration]` convention
- [x] 2.4 Broadcast the updated `reachability` object to connected browsers as a `ServerToBrowserMessage` when `pendingBindHost` changes, mirroring `display_prefs_updated`, and replay it on connect
- [x] 2.5 Add `label`, `pointToPoint`, and `suggestions` to each `/api/network-interfaces` entry; keep one entry per address (the listen-interface picker consumes the same payload)

## 3. Client surfaces (implementation)

- [x] 3.1 Thread the pending effective host into `TrustedNetworksSection` at `SettingsPanel.tsx:1452` — sourced from the `reachability` object, never `config.bindHost`
- [x] 3.2 Render the advisory between the section description and the entry list, above a concurrent block-event banner, as a live region so it is announced when it appears
- [x] 3.3 Add the inline remediation control setting draft `bindHost` to `0.0.0.0`, and the navigation link to `/settings/server`
- [x] 3.4 Surface pending-restart state through the Settings header's existing Restart affordance; do not add a new notice component
- [x] 3.5 Render the Add Local Network dropdown from `label` + `suggestions`, deduplicated on suggestion `value`, wide offers visually distinct with the block-event banner's risk copy, unofferable interfaces shown non-selectable with an explanation
- [x] 3.6 Add `--warn-bg` / `--warn-border` / `--warn-fg` / `--warn-body` to the theme layer with light values; dark values equal today's hardcoded fallbacks
- [x] 3.7 Add i18n keys for all new copy with English fallbacks

## 4. Folded scenarios — L1 unit (vitest)

- [x] 4.1 Author the L1 test for predicate (see packages/client/src/lib/__tests__/gateway-config-ops.test.ts). Triple: bind `127.0.0.1`, entries `["192.168.1.0/24"]` · predicate evaluated · returns `["192.168.1.0/24"]` (test-plan #E1)
- [x] 4.2 Author the L1 test for predicate (see packages/client/src/lib/__tests__/gateway-config-ops.test.ts). Triple: bind `10.0.0.5`, entries `["192.168.1.0/24"]` · predicate evaluated · returns `["192.168.1.0/24"]` (test-plan #E2)
- [x] 4.3 Author the L1 test for predicate (see packages/client/src/lib/__tests__/gateway-config-ops.test.ts). Triple: bind `192.168.1.42`, entries `["192.168.1.0/24"]` · predicate evaluated · returns `[]` (test-plan #E3)
- [x] 4.4 Author the L1 test for predicate (see packages/client/src/lib/__tests__/gateway-config-ops.test.ts). Triple: bind `192.168.1.0`, entries `["192.168.1.0/24"]` (network address, lower boundary) · predicate evaluated · returns `[]` (test-plan #E4)
- [x] 4.5 Author the L1 test for predicate (see packages/client/src/lib/__tests__/gateway-config-ops.test.ts). Triple: bind `192.168.1.255`, entries `["192.168.1.0/24"]` (broadcast, upper boundary) · predicate evaluated · returns `[]` (test-plan #E5)
- [x] 4.6 Author the L1 test for predicate (see packages/client/src/lib/__tests__/gateway-config-ops.test.ts). Triple: bind `192.168.2.1`, entries `["192.168.1.0/24"]` (just outside upper) · predicate evaluated · returns `["192.168.1.0/24"]` (test-plan #E6)
- [x] 4.7 Author the L1 test for predicate (see packages/client/src/lib/__tests__/gateway-config-ops.test.ts). Triple: bind `0.0.0.0`, entries `["192.168.1.0/24","10.0.0.*","1.2.3.4"]` · predicate evaluated · returns `[]` for every entry (test-plan #E7)
- [x] 4.8 Author the L1 test for predicate (see packages/client/src/lib/__tests__/gateway-config-ops.test.ts). Triple: bind `10.0.0.5`, entry `127.0.0.1` · predicate evaluated · returns `[]` — loopback exemption precedes containment (test-plan #E8)
- [x] 4.9 Author the L1 test for predicate (see packages/client/src/lib/__tests__/gateway-config-ops.test.ts). Triple: bind `127.0.0.1`, entries `["127.0.0.1","127.0.0.2","127.0.0.*","127.0.0.0/8"]` · predicate evaluated · returns `[]` for all four (test-plan #E9)
- [x] 4.10 Author the L1 test for predicate (see packages/client/src/lib/__tests__/gateway-config-ops.test.ts). Triple: bind `127.0.0.1`, entry `127.0.0.0/7` · predicate evaluated · returns `["127.0.0.0/7"]` — matches `126.x`, not loopback-only (test-plan #E10)
- [x] 4.11 Author the L1 test for predicate (see packages/client/src/lib/__tests__/gateway-config-ops.test.ts). Triple: bind `::`, entries `["192.168.1.0/24"]` · predicate evaluated · returns `[]` — non-IPv4 literal fails open (test-plan #E11)
- [x] 4.12 Author the L1 test for predicate (see packages/client/src/lib/__tests__/gateway-config-ops.test.ts). Triple: bind `myhost.local`, entries `["192.168.1.0/24"]` · predicate evaluated · returns `[]` — hostname fails open (test-plan #E12)
- [x] 4.13 Author the L1 test for predicate (see packages/client/src/lib/__tests__/gateway-config-ops.test.ts). Triple: bind `10.0.0.5`, entries `["10.0.*.*","192.168.1.*"]` · predicate evaluated · returns `["192.168.1.*"]` only (test-plan #E13)
- [x] 4.14 Author the L1 test for predicate (see packages/client/src/lib/__tests__/gateway-config-ops.test.ts). Triple: bind `127.0.0.1`, entries `[]` and `undefined` · predicate evaluated · returns `[]`, no throw (test-plan #E14)
- [x] 4.15 Author the L1 test for predicate (see packages/client/src/lib/__tests__/gateway-config-ops.test.ts). Triple: entry `not-an-ip`, `999.1.1.1`, `10.0.0.0/33` · predicate evaluated · entries skipped, not reported unreachable, no throw (test-plan #E15)
- [x] 4.16 Author the L1 test for predicate union (see packages/client/src/lib/__tests__/gateway-config-ops.test.ts). Triple: `trustedNetworks:["192.168.1.0/24"]`, `auth.bypassHosts:["10.0.0.0/8"]`, bind `127.0.0.1` · predicate evaluated · both returned — union of the two sources (test-plan #E16)
- [x] 4.17 Author the L1 test for pendingEffectiveHost (see packages/server/src/__tests__/pi-gateway-bind-host.test.ts). Triple: draft edit `0.0.0.0`, saved `127.0.0.1`, resolved `127.0.0.1` · resolve input · returns `0.0.0.0` (draft wins) (test-plan #E17)
- [x] 4.18 Author the L1 test for pendingEffectiveHost (see packages/server/src/__tests__/pi-gateway-bind-host.test.ts). Triple: no draft, config `0.0.0.0`, no flag/env, resolved `127.0.0.1` · resolve input · returns `0.0.0.0` (test-plan #E18)
- [x] 4.19 Author the L1 test for pendingEffectiveHost (see packages/server/src/__tests__/pi-gateway-bind-host.test.ts). Triple: `--host 127.0.0.1`, config `bindHost 0.0.0.0` · resolve `pendingBindHost` · returns `127.0.0.1` — flag wins on next start too (test-plan #E19)
- [x] 4.20 Author the L1 test for pendingEffectiveHost (see packages/server/src/__tests__/pi-gateway-bind-host.test.ts). Triple: `PI_DASHBOARD_HOST=0.0.0.0`, config default `127.0.0.1` · resolve both values · both `0.0.0.0` — container case, no presence flag needed (test-plan #E20)
- [x] 4.21 Author the L1 test for interface suggestions (see packages/server/src/__tests__/trusted-networks-config.test.ts). Triple: `utun4` `100.97.246.31`/`255.255.255.255` · derive suggestions · `pointToPoint:true`, no `100.97.246.31/32` offer, one `{value:"100.64.0.0/10", wide:true}` (test-plan #E21)
- [x] 4.22 Author the L1 test for interface suggestions (see packages/server/src/__tests__/trusted-networks-config.test.ts). Triple: `en0` `192.168.10.123`/`255.255.255.0` · derive suggestions · one `{value:"192.168.10.0/24", wide:false}` (test-plan #E22)
- [x] 4.23 Author the L1 test for interface suggestions (see packages/server/src/__tests__/trusted-networks-config.test.ts). Triple: `/32` at `203.0.113.7` (no well-known containing range) · derive suggestions · `pointToPoint:true`, `suggestions: []` (test-plan #E23)
- [x] 4.24 Author the L1 test for interface suggestions (see packages/server/src/__tests__/trusted-networks-config.test.ts). Triple: `/32` at `172.20.0.5` and at `10.9.9.9` · derive suggestions · `172.20.0.0/16` and `10.0.0.0/8`, both `wide:true` (test-plan #E24)
- [x] 4.25 Author the L1 test for endpoint completeness (see packages/server/src/__tests__/trusted-networks-config.test.ts). Triple: `en0` `192.168.10.123/24` + `en7` `192.168.10.224/24` · endpoint response built · two entries, both addresses present (test-plan #E25)
- [x] 4.26 Author the L1 test for dropdown dedupe (see packages/client/src/__tests__/trusted-networks-section.test.ts). Triple: the two entries from E25 · dropdown rows derived · one row, value `192.168.10.0/24`, label of the first entry in response order (test-plan #E26)
- [x] 4.27 Author the L1 test for dropdown dedupe (see packages/client/src/__tests__/trusted-networks-section.test.ts). Triple: two `/32` p2p interfaces, different addresses, both suggesting `100.64.0.0/10` · dropdown rows derived · one row `100.64.0.0/10` (test-plan #E27)
- [x] 4.28 Author the L1 test for label fallback (see packages/server/src/__tests__/trusted-networks-config.test.ts). Triple: interface matching no well-known range · label derived · `label === name` (test-plan #E28)
- [x] 4.29 Author the L1 test for range table parity (see packages/server/src/__tests__/trusted-networks-config.test.ts). Triple: address `100.97.246.31` · containing range derived from interface path AND block-event path · both yield `100.64.0.0/10` (test-plan #E29)
- [x] 4.30 Author the L1 test for computed field stripped (see packages/server/src/__tests__/config-api.test.ts). Triple: `PUT /api/config` body echoing `reachability` · write persisted · `reachability` absent from written config.json (test-plan #E30)
- [x] 4.31 Author the L1 test for failure isolation (see packages/server/src/__tests__/config-api.test.ts). Triple: reachability computation throws · `GET /api/config` served · response still 200; remaining config fields present; `reachability` omitted or null (test-plan #X1)
- [x] 4.32 Author the L1 test for topology disclosure (see packages/server/src/__tests__/config-api.test.ts). Triple: reachability populated with `192.168.1.0/24` · `GET /api/health` served · body contains no `resolvedBindHost`, no `pendingBindHost`, no trusted-entry value (test-plan #X2)
- [x] 4.33 Author the L1 test for endpoint guard (see packages/server/src/__tests__/localhost-guard.test.ts). Triple: request from a non-loopback IP · `GET /api/network-interfaces` · 403 (test-plan #X3)
- [x] 4.34 Author the L1 test for interface enumeration (see packages/server/src/__tests__/localhost-guard.test.ts). Triple: `os.networkInterfaces()` throws · endpoint served · error surfaced without crashing the server (test-plan #X4)

## 5. Folded scenarios — L2 process smoke (qa/)

- [x] 5.1 Author the L2 test for startup log (see qa/tests/02-server-start.sh). Triple: config bind `127.0.0.1`, `auth.bypassHosts` `["192.168.1.0/24"]` · server starts · exactly one `[bind-reachability]` warn line, containing `127.0.0.1` and `192.168.1.0/24` (test-plan #S1)
- [x] 5.2 Author the L2 test for startup log (see qa/tests/02-server-start.sh). Triple: bind `0.0.0.0`, same entries · server starts · no `[bind-reachability]` line (test-plan #S2)
- [x] 5.3 Author the L2 test for container default (see qa/tests/02-server-start.sh). Triple: `PI_DASHBOARD_HOST=0.0.0.0`, no `bindHost` in config.json, trusted entries present · server starts in the docker harness · no `[bind-reachability]` line; `reachability.unreachable` empty (test-plan #S3)

## 6. Folded scenarios — L3 browser e2e (Playwright)

- [x] 6.1 Author the L3 test for advisory (see tests/e2e/settings-field-descriptions.spec.ts). Triple: bind `127.0.0.1`, `auth.bypassHosts` `["192.168.1.0/24"]` · open Settings → Security · advisory visible, naming `127.0.0.1` and `192.168.1.0/24` (test-plan #F1)
- [x] 6.2 Author the L3 test for advisory (see tests/e2e/settings-field-descriptions.spec.ts). Triple: bind `0.0.0.0`, same entries · open Settings → Security · advisory absent (test-plan #F2)
- [x] 6.3 Author the L3 test for advisory (see tests/e2e/settings-field-descriptions.spec.ts). Triple: bind `127.0.0.1`, no entries · add `192.168.1.0/24`, do NOT save · advisory converges to visible without a save or reload (test-plan #F3)
- [x] 6.4 Author the L3 test for advisory (see tests/e2e/settings-field-descriptions.spec.ts). Triple: advisory visible · activate "Listen on all interfaces" · advisory converges to absent; draft `bindHost` is `0.0.0.0`; config.json unchanged (test-plan #F4)
- [x] 6.5 Author the L3 test for remediation (see tests/e2e/settings-field-descriptions.spec.ts). Triple: advisory visible on Security · activate the inline control · Save Bar dirty chip names **Server**, not Security (test-plan #F5)
- [x] 6.6 Author the L3 test for remediation (see tests/e2e/settings-field-descriptions.spec.ts). Triple: advisory visible on Security · inspect the Security page · listen-interface picker NOT rendered there; navigation link to Server present (test-plan #F6)
- [x] 6.7 Author the L3 test for remediation (see tests/e2e/settings-field-descriptions.spec.ts). Triple: advisory visible · activate the navigation link · app is at `/settings/server`; unsaved Security edits still present (test-plan #F7)
- [x] 6.8 Author the L3 test for coexistence (see tests/e2e/settings-field-descriptions.spec.ts). Triple: bind `10.0.0.5`, entries `["192.168.1.0/24"]`, one recorded denial from `10.0.0.9` · open Settings → Security · BOTH advisory and block-event banner rendered; advisory above (test-plan #F8)
- [x] 6.9 Author the L3 test for placement (see tests/e2e/settings-field-descriptions.spec.ts). Triple: advisory condition holds · render Trusted Networks section · advisory sits between section description and entry list (test-plan #F9)
- [x] 6.10 Author the L3 test for restart signal (see tests/e2e/settings-field-descriptions.spec.ts). Triple: saved `bindHost` `0.0.0.0`, server not restarted · open Settings · header Restart affordance indicates pending restart (test-plan #F10)
- [x] 6.11 Author the L3 test for restart signal (see tests/e2e/settings-field-descriptions.spec.ts). Triple: pending restart indicated · server restarts, `resolvedBindHost` becomes `0.0.0.0` · indication converges to cleared (test-plan #F11)
- [x] 6.12 Author the L3 test for WS push (see tests/e2e/settings-field-descriptions.spec.ts). Triple: browser connected, `pendingBindHost` `127.0.0.1` · `pendingBindHost` becomes `0.0.0.0` server-side · client converges to the new value with no reload and no panel reopen (test-plan #F12)
- [x] 6.13 Author the L3 test for WS replay (see tests/e2e/settings-field-descriptions.spec.ts). Triple: `pendingBindHost` already `0.0.0.0` · a browser socket connects afterwards · receives current `reachability` on connect (test-plan #F13)
- [x] 6.14 Author the L3 test for dropdown (see tests/e2e/settings-field-descriptions.spec.ts). Triple: host with a Tailscale `/32` interface · open "+ Add Local Network" · row labelled as tailnet (not `utun4`), offering `100.64.0.0/10` marked wide; no `<self>/32` offer (test-plan #F14)
- [x] 6.15 Author the L3 test for dropdown (see tests/e2e/settings-field-descriptions.spec.ts). Triple: `/32` interface with no derivable range · open "+ Add Local Network" · row shown, non-selectable, with an explanation (test-plan #F15)
- [x] 6.16 Author the L3 test for picker unaffected (see tests/e2e/settings-field-descriptions.spec.ts). Triple: two NICs on one subnet · open Server → listen-interface picker, Specific interface · both addresses selectable (test-plan #F16)
- [x] 6.17 Author the L3 test for guard unchanged (see tests/e2e/settings-field-descriptions.spec.ts). Triple: advisory visible · issue a request that the guard would deny · still denied, same `network_not_allowed` shape as before (test-plan #F17)
- [x] 6.18 Author the L3 test for exposure warning intact (see tests/e2e/settings-field-descriptions.spec.ts). Triple: bind `0.0.0.0`, no providers and no trusted entries · open Server page · existing all-interfaces exposure warning still shown (test-plan #F18)
- [x] 6.19 Author the L3 test for advisory a11y (see tests/e2e/settings-field-descriptions.spec.ts). Triple: advisory absent, screen-reader semantics observed · add an unreachable entry · advisory is announced as a status message when it appears (test-plan #F19)
- [x] 6.20 Author the L3 test for dropdown fetch (see tests/e2e/settings-field-descriptions.spec.ts). Triple: `/api/network-interfaces` returns 500 · user opens "+ Add Local Network" · dropdown degrades without breaking the section; manual entry still usable (test-plan #X5)
- [x] 6.21 Author the L3 test for WS push (see tests/e2e/settings-field-descriptions.spec.ts). Triple: browser socket dropped, then reconnects · `pendingBindHost` changed while disconnected · client converges to the current value after reconnect via replay (test-plan #X6)

## 7. Manual verification (deferred post-merge)

- [ ] 7.1 Manually verify advisory visual polish: Security page, both themes · human looks at advisory + block-event banner together · [judgment: amber ramp reads correctly in light and dark, banners do not fight] (test-plan: manual-only)

Evidence for section 8: 8.1 — the page-attribution exception is design Decision 6, re-checked in review round 1 and pinned by #F5 (dirty dot lands on **Server**, not Security). 8.2 — the guarded-surface placement, the topology-disclosure probe (#X2, seeded with a real entry so absence is meaningful), the endpoint guard (#X3), and the wide-offer marking were all reviewed; the review found no leak to an unguarded surface. 8.3 — the `[bind-reachability]` line is asserted at process level (#S1–#S3) and its remediation text is L1-tested per deciding link. 8.4 — two review rounds by `@review`; round 1 found one blocking issue (a vacuous #X1) plus two correctness gaps, all fixed and mutation-verified; round 2 returned no blocking findings.

## 8. Discipline checkpoints

- [x] 8.1 Run `doubt-driven-review` on the `settings-panel` page-attribution exception before it lands
- [x] 8.2 Run `security-hardening` on the advisory, the wide-range suggestion, and the guarded-surface placement of `reachability`
- [x] 8.3 Run `observability-instrumentation` on the startup log line and the `reachability` field
- [x] 8.4 Run `review-code` on the full diff once tests are green

## 9. Verification and docs

- [x] 9.1 Manual check on a Tailscale host: dropdown offers `100.64.0.0/10` marked wide, never `<self>/32`; bind to the Tailscale NIC and confirm no advisory fires (test-plan: manual-only — DEFERRED, needs a real tailnet host. The logic is pinned mechanically by #E21 (no `<self>/32`, one wide `100.64.0.0/10`), #E29 (interface path and block-event path agree) and #F14 (rendered offer, marked wide, labelled `tailnet`); what remains human is only the on-a-real-tailnet confirmation.)
- [x] 9.2 Confirm the docker harness shows no advisory and no `[bind-reachability]` line
- [x] 9.3 Run `npm run quality:changed` and resolve findings
- [x] 9.4 Delegate to `DocScribe`: `docs/architecture.md` gains the bind-vs-trust reachability coupling and the `reachability` object; `docs/faq.md` gains entries for "I added a trusted network and the device still cannot connect" and "my Tailscale device is not trusted after Add Local Network"
- [x] 9.5 Update the directory `AGENTS.md` rows for every touched file with a `See change: warn-unreachable-trusted-networks` marker
