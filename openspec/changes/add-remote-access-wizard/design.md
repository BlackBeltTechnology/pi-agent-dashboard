## Context

See proposal.md — Why. Today `connectivity/TunnelButton.tsx` (`mdiQrcode`, polls `/api/tunnel-status` every 30 s — `TunnelButton.tsx:42`, colour from `gatewayIndicator`) opens `Gateway/GatewayDialog.tsx`: three tabs composed of reusable sections (`GatewayReadinessBoard`, `GatewayProviderSection`, `GatewayReservedName`, `GatewaySetupGuide`, `GatewayPairQR`, `GatewayEndpoints`, `GatewayConnectToggle`). `GatewayPage` (Settings ▸ Network ▸ Gateway) composes the same sections. Every fact the wizard needs is already served:

| Fact | Source |
|---|---|
| bind host live / next restart | `GET /api/config` → `reachability.{resolvedBindHost, pendingBindHost}` (guarded); WS `reachability_updated` (`packages/shared/src/browser-protocol.ts:65`), replayed on connect |
| loopback / trust classification | `packages/shared/src/bind-reachability.ts` — `isLoopbackIpv4`, `isLoopbackOnlyEntry`, `collectTrustedEntries` |
| LAN requests | `GET /api/config` → `pairing.acceptLanRequests` (`packages/shared/src/config.ts:1095`) |
| network trust | `GET /api/config` → `resolvedTrustedNetworks` (`config.ts:885`) |
| provider + reserved name | `GET /api/config` → `tunnel.provider`, `tunnel.zrok.reservedName` |
| readiness | `getProviderReadiness` → `ProviderReadinessState` (`packages/shared/src/tunnel-provider.ts:149`) |
| connected by this server | `GET /api/tunnel-status-detail` → `connectedProviders` |
| waiting requests | `pairingApprovalStore` (`packages/client/src/lib/pairing/pairing-approval-store.ts:58`) |
| paired devices | `listPairedDevices()` (`lib/pairing/paired-devices-api.ts`) |
| other machines | `/api/known-servers` + `POST /api/known-servers/probe` (known entries only — `known-servers-routes.ts:355`, result `{status}` only — `rest-api.ts:1117`); `knockServer(baseUrl, …)` (`lib/pairing/knock.ts`) |

No new route or config key is required.

**Lands after** `fix-pairing-approval-credential` (refusal remedies shown by the approval dialog the wizard relies on, D6). Independent of `retire-trusted-networks-bypass`: D3 reads the trusted entries today; that change extends the predicate with its `trustMode`. The denied-device Request access bar belongs to that change and is only referenced here.

## Goals / Non-Goals

**Goals:** one pure, unit-testable step engine; the wizard and the Settings page render the same section components; zero new server surface.

**Non-Goals:** changing any admission rule; redesigning Settings ▸ Network pages; changing the pairing approval flow itself.

## Decisions

### D1 — Pure step engine over a snapshot
`lib/remote-access/steps.ts` exports step definitions `{ id, applies(snap), satisfied(snap) }`, the task lists, `roads(snap)` and `planTask(task, snap, run) → { rows, current, k, n }` (rows: `current | todo | skipped | done | folded`). Every snapshot field is tri-state (`loading | error | value`); `satisfied` returns `unknown` for a non-value input and the row renders "Checking…" / "unknown". Road definitions live once in `roads()` and are shared by landing, "Where is the device" and the toolbar.
*Alternative:* per-step hooks each fetching their own data — rejected: N fetches, inconsistent snapshots, untestable skip logic.

### D2 — One snapshot hook, existing APIs; one readiness poll owner
`useRemoteAccessSnapshot(open)` performs one `GET /api/config`, one `/api/tunnel-status-detail`, one readiness read on open and on every return to the landing; subscribes to `reachability_updated` and `pairingApprovalStore`; re-reads config after every wizard write. The 5 s overlap-suppressed readiness loop moves out of `GatewayReadinessBoard` into `useReadinessPoll(active)`; the board takes `active` from its host — the dialog passes "a provider-dependent step is current". `GatewayPage` does not compose the board, `GatewayReservedName` or `GatewayDegradedBanner` today (`GatewayPage.tsx:17-25`; they live only in `GatewayDialog.tsx`), so deleting the dialog would orphan them: `GatewayPage` gains all three (passing `active` = mounted), keeping the board's Make-primary actions reachable in Settings.

### D3 — "Who may enter" is derived, and sign-in is not a substitute
`satisfied = collectTrustedEntries(cfg).every(e => isLoopbackOnlyEntry(e) || e === "::1" || e === "::1/128")` — client-side only, no server or guard change. Deliberately NOT `loopbackCoveringEntries` (`packages/server/src/auth/localhost-guard.ts:225`), which counts match-all entries (`0.0.0.0/0`, `*.*.*.*`) as covering loopback; this matches `retire-trusted-networks-bypass/design.md` (match-all is not loopback-only). A `localhost` entry is not loopback-only (the guard compares IPs, so it is inert), consistent with that change. A sign-in provider does not count: `auth.bypassHosts` admits without sign-in whether or not providers exist (main spec `trusted-networks` "auth.bypassHosts honored without OAuth providers"). `auth.bypassUrls` are path prefixes (webhooks, metrics), not dashboard admission, and are out of scope; the Go online consequence copy is about the dashboard page, and path bypasses stay listed in Settings ▸ Security. No new key; when `retire-trusted-networks-bypass` lands, its `network.trustMode === "pair"` also satisfies the step (that change updates this predicate). The step links to Settings ▸ Security; "Continue anyway" marks it done for this run only. The landing warning uses the same predicate.

### D4 — Listen on network: `0.0.0.0`, source check → write → restart → resume
Binding a single interface address would drop `127.0.0.1` — the operator's own `localhost` tab could not reconnect (so resume could never fire) and local self-probes (`packages/extension/src/instance-verification.ts:78`, `server-auto-start.ts:199`) would miss the server; a DHCP change would also break the next boot. So the step writes `bindHost: "0.0.0.0"`; choosing one interface stays in Settings ▸ Server. Sequence: read `reachability.bindHostSource` (`packages/shared/src/bind-reachability.ts` `BindReachability`); `flag` / `env` ⇒ pinned message naming the source and `pendingBindHost`, no write, no restart (also avoids relying on `/api/restart` re-passing `--host`, which it does not — `system-routes.ts:1498-1516`). Else `PUT /api/config {bindHost}` → persist `{task, branch, done[], at}` to `sessionStorage["remoteAccess.run"]` → `POST /api/restart`. On reconnect the app reopens the dialog on that run if `at` is under 2 minutes old, and always clears the key. A refused or failed `POST /api/restart` clears the key immediately and leaves the step in "restart pending" (config already holds `0.0.0.0`; Restart retries). "Loopback-only" = `isLoopbackIpv4` / `localhost` / `::1`; `0.0.0.0` and `::` count as all interfaces.

### D5 — Step bodies reuse the sections
Choose provider → `GatewayReadinessBoard` with a new `showProviderActions={false}` prop (hides `GatewayProviderActions`' Make-primary / register offers in the wizard; Settings keeps them) + `GatewayProviderSection` (mode); the wizard writes `tunnel.provider` only when no primary is connected — switching a connected primary stays in Settings (main spec `tunnel-provider` offers Make primary only for a connected provider). Install / Enable → per-step blocks split out of `GatewaySetupGuide` (the guide keeps composing them for Settings). Public address (zrok only) → `GatewayDegradedBanner` + `GatewayReservedName` + the Release-reserved-URL action moved out of the old dialog footer + "Use a temporary address", which saves `tunnel.zrok.persistent: false` (an existing key) — otherwise a persistent tunnel with no stored name auto-generates and reserves one on connect (main spec `zrok-tunnel` "Reserved-name lifecycle"), silently overriding the choice; degraded (`/api/tunnel-status-detail` `degraded`) keeps the step unsatisfied. Go online → `GatewayConnectToggle`. Open it on the device → `GatewayPairQR` restricted to https endpoints. On a plain-http LAN endpoint the step renders its own `QrCanvas` of the bare address (the same content as the main-spec link QR) with wizard copy "then choose Request access" — an unpaired device opening it lands on the refusal banner whose primary action is Request access (`lan-knock-pairing`). A plain-http non-LAN endpoint (zerotier without https) gets no QR: the knock's on-link gate would refuse it (`knock_not_lan`). Let devices ask → the `acceptLanRequests` switch panel extracted from `GatewayPairQR`.

### D6 — Approve via the existing app-wide approval dialog
Every operator browser already raises the modal approval dialog when a request arrives (main spec `qr-device-pairing`). The Approve step does not duplicate or suppress it: it shows the device row and a Review button (`pairingApprovalStore.review(id)`). Completion: snapshot `listPairedDevices()` ids when the request appears; when its `pendingId` leaves `pending`, re-read and diff — one new id ⇒ done (named), several ⇒ "N devices paired", none ⇒ "denied or expired". `PairedDeviceView` carries no `pendingId` (`lib/pairing/paired-devices-api.ts`), hence the diff.
*Alternative:* extract `PairingApprovalForm` and suppress the modal per `pendingId` — rejected: contradicts the every-browser requirement, needs suppression-lifetime rules, and a second request would still stack.

### D7 — Connect to another machine: add → probe → ask
First look the address up in `GET /api/known-servers` with the same `sameAddress` normalisation the server uses; a match is used and not re-posted (a re-POST would overwrite its label — main spec `known-servers`). The probe accepts only persisted entries (`known-servers-routes.ts:355`), so continuing with an unknown server does `POST /api/known-servers` (which itself verifies and pins identity — main spec `known-servers` "REST API to add a known server"); `409 already_known` (same identity at another address) ⇒ use that entry and show its address (not "created"), `409 identity_changed` ⇒ stop with the reason. Discovered entries already in the list are not re-added. Reach = probe status word only (`{status}` — `rest-api.ts:1117`; it cannot see approval). Ask: desktop app → always `challengeIdentity(baseUrl)` first; expected fp = entry pin and/or advert (all present ones must equal the proven fp); if neither exists, show the proven fp → operator confirms → `knockServer(baseUrl, confirmedFp, name)` (`packages/shared/src/pairing-knock-client.ts` requires an expected fp). Browser → `window.open(remote + "/pair?request", "_blank", "noopener")` and an explicitly unverified "I've been approved" confirm; the remote landing owns code, expiry and refusal copy. Finish: browser opens the remote dashboard in a new tab (this origin cannot use the remote's device cookie, so an in-page switch would hit the CORS/credential wall — `ServerSelector.tsx` `data-cors-blocked`); desktop app opens the existing server window.

### D8 — Toolbar button
`TunnelButton` keeps its file, `data-testid="tunnel-btn"` and the 30 s `/api/tunnel-status` read (now spec'd by the MODIFIED "Tunnel status lazy fetch"); adds `reachability_updated` and the `pairingApprovalStore` pending count. Pure `remoteAccessIndicator(tunnel, resolvedBindHost | unknown, pending)` in `gateway-connection.ts` returns `{ tone, title }` with precedence failed > partial > internet > network > local; no bind seen yet ⇒ dot from tunnel states, title "network status unknown". `unverified`: whether `reachability_updated` (sent via `broadcastToAll`) reaches low-tier sockets — if it does, that is pre-existing exposure outside this change, recorded for `security-hardening` review during build and not widened by this change (the button consumes the message; it does not change its delivery). Glyph `mdiAccessPointNetwork`; click always opens the dialog.

### D9 — Dialog replaces GatewayDialog; testid map
New `components/remote-access/RemoteAccessDialog.tsx`; `GatewayDialog.tsx` deleted. Every testid it owned gets a successor, and every consumer is ported in this change:

| Old testid | Successor |
|---|---|
| `gateway-dialog` | dialog root (kept) |
| `gateway-done` | landing footer primary (kept) |
| `gateway-dialog-error` | wizard error region (kept) |
| `gateway-save` | Choose provider primary while provider/mode is dirty (kept) |
| `gateway-forget-reserved` | Public address step (kept) |
| `gateway-tab-setup` | `remote-access-task-share` (opens the provider steps) |
| `gateway-tab-access` | `remote-access-task-device` |
| `gateway-tab-security`, `gateway-open-security` | `remote-access-who-may-enter-security-link` |
| `gateway-security-pane` | `remote-access-step-door` |
| `gateway-degraded-banner` (owned by `GatewayDegradedBanner`) | unchanged; now rendered in the Public address step and on `GatewayPage` |
| `gateway-make-primary-*` (owned by `GatewayProviderActions`) | unchanged; rendered on `GatewayPage` only |

Consumers: `tests/e2e/{gateway-board-mobile,gateway-reserved-name,gateway-primary-offer,gateway-readiness-board,zrok-v2-tunnel}.spec.ts` (provider-board and Make-primary specs move to `/settings/gateway`; reserved-name / release / error specs drive the wizard), `packages/client/src/components/__tests__/TunnelButton.test.tsx`.

## Risks / Trade-offs

- [Restart mid-wizard drops the socket] → run persisted in sessionStorage (D4); resume tested.
- [`0.0.0.0` exposes every interface incl. VPN/tailnet] → consequence copy names it; narrower binds stay in Settings ▸ Server.
- [Unsaved Settings edits vs wizard writes/restart] → the restart notice in Listen on network states that unsaved Settings edits are discarded by the restart (`unverified`: whether both surfaces can be open at once — checked during build).
- [Landing readiness ages while open] → re-read on every return to the landing and on the refresh control; accepted for the landing itself.
- [Browser remote flow relies on operator confirmation] → the step says the confirmation is unverified; the remote tab shows the real outcome, and opening the remote dashboard surfaces any refusal there.
- [Splitting `GatewaySetupGuide` / `GatewayPairQR` regresses Settings] → existing `GatewayPage` / section tests run unchanged.

## Migration Plan

Client-only. Rollback = revert the commit (GatewayDialog returns). No config migration.
