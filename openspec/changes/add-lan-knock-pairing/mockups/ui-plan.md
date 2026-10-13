# UI plan — LAN knock pairing

Change: `add-lan-knock-pairing`. Board: `knock-pairing.html` (as-built vs
proposed per state; toolbar: Base dark / Base light / Nord dark × 375 / 768 /
1440). Anti-slop binding: profile `product-ui`, redesign mode `preserve`.

## Ground (sources read)

| Surface | Source | As-built facts used |
|---|---|---|
| 1 Approval dialog | `components/pairing-approval/PairingApprovalDialog.tsx` | `Dialog` size md, title "A device wants to connect", `DeviceDetails` `<dl>` (Browser / Came in via / From / When), code + name fields, consequence line, Deny + Approve footer |
| 2 Request page | `components/connectivity/PairLanding.tsx` | `max-w-md` centred column, `text-xl` h1, code card `border-[var(--accent)] bg-[var(--accent-soft)]`, severity callouts for done / rejected / error; no-hash → "missing its code" dead end |
| 3 Gateway | `components/Gateway/GatewayPairQR.tsx`, `WaitingDevices.tsx` | `NoSecureRoadBlock` copy "A browser on a plain-http LAN address cannot pair"; waiting rows = UA · viaHost + Review |
| 4 Discovery | `components/connectivity/NetworkDiscoverySection.tsx`, `connectivity-ui.ts` | `ROW`, `META`, `BTN_SMALL` (32 px), identity pills, "Already added" |
| 5 Banner | `components/connectivity/ConnectionStatusBanner.tsx:58-75` | Tailwind amber palette (`bg-amber-500/15`, `text-amber-200`) — contract violation |
| Switch | `components/settings/FocusSettingsSection.tsx:47-58` | `role="switch"` 40×20 track, `bg-blue-600` palette class when on |

Contract: root `ui-contract.md` (severity callout, primary/secondary button,
input, dialog, a11y #1–#7). Kit reused from
`surface-operate-required-remedy/mockups` (`tokens.css` generated from
`index.css` + nord dark, `mockup.css`); `knock.css` holds the new recipes,
`asbuilt.css` the banner replica.

## Decisions

| # | Decision | Rule cited |
|---|---|---|
| D1 | Knock dialog titles with the **source address** ("A device on 192.168.16.31 asks to connect"); the address is the first `<dl>` row in mono bold. | Spoofing defence: identity from what the server observed, not what the requester claims — NN/g "security UX: show verifiable information"; Nielsen #1 (system status) |
| D2 | Requester name appears only as **Says it is “…”** plus "(name typed on that device, not verified)"; it prefills the editable name field. | Spec (untrusted display text); Nielsen #2 (match real world — say who asserted it) |
| D3 | Unencrypted knock → **warning callout** with open-lock icon, bold lead "Unencrypted on this network." and the consequence + safer alternative. Placed before the code field, so it is read before approval. | WCAG 1.4.1 (icon + words, not colour); Nielsen #5 (error prevention — warn before the commit point); GOV.UK warning-text pattern |
| D4 | QR dialog unchanged. | Jakob's law; preserve mode |
| D5 | Request page shows the **page host** (`192.168.16.204:8000`), not a dashboard display name — the host is known client-side, so nothing is disclosed pre-auth. | Spec disclosure posture; Nielsen #2 |
| D6 | One primary action per state ("Request access" / "Request again"); recovery buttons secondary. | Von Restorff; ui-contract "exactly one visually-primary action" |
| D7 | Code shown grouped **4821 7730** with an `aria-label` that reads digits in two groups; instruction names *where* to type it ("the 'asks to connect' window" on the dashboard host). | Miller's law / chunking (lawsofux.com/chunking); Nielsen #6 (recognition over recall) |
| D8 | **No Cancel** while waiting: the server cannot withdraw a knock, so Cancel would only hide it while it still pops on the operator's screen. Copy says "Keep this page open"; expiry is shown. | Nielsen #1 (honest system status) over #3; a false control is worse than none |
| D9 | Every refusal code maps to: what happened + what to do + an action only when retrying can help (`knock_not_lan` has none; `knock_rate_limited` shows a disabled countdown button). | Nielsen #9 (diagnose and recover); GOV.UK error messages (say how to fix) |
| D10 | Refusals use **info** severity, rejected uses **error**: a refusal is policy, not a fault; a deny is a definitive "no". | Same rationale as `surface-operate-required-remedy` D1 |
| D11 | Gateway gains a **Devices on this network** inset: labelled switch with visible On/Off word, helper stating the unencrypted trade-off, and (when on) the copyable **Request page** URL built from the LAN endpoints `collectEndpoints` already lists. | Recognition over recall (Nielsen #6); WCAG 1.4.1 (state word, not colour); Fitts (copy beside URL) |
| D12 | `NoSecureRoadBlock` copy no longer claims a LAN browser cannot pair; it points to the switch. | Nielsen #4 (consistency — copy must not contradict a sibling control) |
| D13 | Waiting rows lead with a provenance pill (**Network request** / **Pairing link**), the address in mono, and an **Unencrypted** warning pill (icon + word); Review gets an accessible name naming the request. | WCAG 1.4.1, 2.4.6; Gestalt similarity |
| D14 | Discovery: **Connect ↗** on remote rows only, placed before Add / Already added; accessible name "Connect to {name} (opens in a new tab)". | WCAG 3.2.5 / G201 (warn of new window); Hick's law (local row unchanged) |
| D15 | Banner moves from the Tailwind amber palette to `--severity-warning-*` and gains **Request access** as its one strong action; the hint wraps instead of truncating. | ui-contract Rule (severity tokens, no palette classes); WCAG 1.4.10 reflow |
| D17 | Knock dialog adds an **Access for this device** radio group (Observe / Control / Operate, shipped `TIER_OPTIONS` copy), Operate preselected; the consequence line names the picked tier. QR dialog unchanged. Added after doubt review (user decision). | Least privilege (OWASP ASVS V4.1.3); Jakob's law (same copy as Paired devices); Nielsen #1 (consequence stated before commit) |
| D18 | Banner keeps the server `hint` text verbatim after the bold title (spec `connection-status-banner`); only the colour family, icon, wrapping and the new action change. | Spec contract; preserve mode |
| D16 | Switch is one button containing track + state word (≥32 px, 44 px below `sm`); the on-fill is `--accent-solid` instead of `bg-blue-600`. | WCAG 2.5.8 target size; ui-contract a11y #2 |

## States (board ids)

1 Dialog: `qr-redeem (unchanged)`, `knock-unencrypted`, `knock-tls-no-name`.
2 Request page: `intro (http)`, `sending`, `waiting`, `approved`, `rejected`,
`expired`, `refused: knock_disabled | knock_not_lan | knock_pending |
knock_rate_limited | knock_busy`.
3 Gateway: `no-secure-road + off`, `switch on + waiting`.
4 Discovery: `results`. 5 Banner: `network-denied`.

## Copy (i18n keys — final strings)

| Key | String |
|---|---|
| `pairingApproval.knockTitle` | A device on {address} asks to connect |
| `pairingApproval.knockSubtitle` | Someone on your network asked for access from the request page. Approve only if you expect it and the code matches the one on that device. |
| `pairingApproval.address` | Address |
| `pairingApproval.saysItIs` | Says it is |
| `pairingApproval.nameUnverified` | (name typed on that device, not verified) |
| `pairingApproval.unencryptedTitle` | Unencrypted on this network. |
| `pairingApproval.unencryptedBody` | This request came over plain http. After you approve, someone else on this network could copy this device's access. For a protected connection, pair over the Gateway or TLS instead. |
| `landing.request.title` | Request access |
| `landing.request.intro` | Ask the dashboard at {host} to let this browser in. The person at that computer approves it by typing a code you'll see here. |
| `landing.request.unencrypted` | This page isn't encrypted. The request, and the access you get, travel in the clear on this network. |
| `landing.request.nameHint` | Shown to the person approving, next to this device's network address. |
| `landing.request.send` / `.sending` | Request access / Sending request… |
| `landing.request.typeCode` | On the computer running the dashboard ({host}), type this code in the "asks to connect" window: |
| `landing.request.waiting` | Waiting for approval · expires in {time} |
| `landing.request.keepOpen` | Keep this page open. It continues on its own once approved. |
| `landing.request.approved` | Approved. Opening the dashboard… |
| `landing.request.rejected` / `.rejectedHint` | The dashboard declined this request. / If that was a mistake, ask the person at that computer, then request again in about 10 minutes. |
| `landing.request.expired` / `.expiredHint` | The request expired before anyone approved it. / Make sure someone is at the dashboard computer, then send a new request. |
| `landing.request.err.knock_disabled` | This dashboard isn't accepting requests from the network. Its owner can turn on "Accept requests from devices on this network" in Gateway ▸ Connect a device. Then try again. |
| `landing.request.err.knock_not_lan` | Requests are only accepted from the same local network. Connect this device to the same network as the dashboard, or ask its owner for a pairing link (QR). |
| `landing.request.err.knock_pending` | A request from this device is already waiting. Approve it on the dashboard computer, or wait up to 5 minutes for it to expire and request again. |
| `landing.request.err.knock_rate_limited` | Too many requests from this device. You can request again in {time}. |
| `landing.request.err.knock_busy` | Several devices are already waiting for approval. Try again in a minute. |
| `gateway.lan.heading` | Devices on this network |
| `gateway.lan.switch` / `.switchHelp` | Accept requests from devices on this network / A device on your local network can ask to connect. You approve each request by typing the code it shows. Without the Gateway or TLS, requests and the access you grant are unencrypted. |
| `gateway.lan.requestPage` / `.requestPageHelp` | Request page / Open it on the other device, or use Connect in that dashboard's Network Discovery. |
| `gateway.pair.noSecureRoadTitle` (changed) | No secure road for a pairing link yet |
| `common.pairingNeedsSecureRoad` (changed) | A QR pairing link needs a secure road (the Gateway or a publicly-trusted TLS URL). For a device on this network, turn on "Accept requests from devices on this network" below. |
| `gateway.pair.provenanceKnock` / `.provenanceQr` / `.unencrypted` | Network request / Pairing link / Unencrypted |
| `connection.connect` / `.connectAria` | Connect / Connect to {name} (opens in a new tab) |
| `connection.requestAccess` | Request access |
| `pairingApproval.tierLegend` | Access for this device |
| `pairingApproval.consequenceObserve` / `.consequenceControl` | Approving lets this browser watch the dashboard read-only (observe). / Approving lets this browser drive sessions (control), but not restart or install. |
| `landing.request.err.generic` | This dashboard refused the request. |
| `landing.request.keepFailed` | This browser couldn't keep its access. Check that cookies are allowed, then request again. |

## Protected elements (preserve mode)

All existing `data-testid`s on the five surfaces stay (`pairing-dialog*`,
`pair-landing*`, `gateway-pair-*`, `pairing-waiting-*`); new ones are additive
(`pairing-dialog-unencrypted`, `pairing-dialog-says`, `pair-landing-request*`,
`gateway-lan-switch`, `gateway-lan-request-url`, `pairing-waiting-provenance`,
`discovery-connect`, `network-denied-request-access`). QR dialog, QR landing
and the banner's "Settings → Servers" action are behaviourally unchanged.

## Verification (scored — derived in code)

Probe: `/tmp/knock-probe.mjs` (Playwright, computed contrast of every text node
in `.col.proposed` after alpha blending, target sizes, horizontal overflow,
console) × {base-dark, base-light, nord-dark} × {375, 1440}.

| Check | Result |
|---|---|
| Text contrast ≥ 4.5:1 (3:1 large), 195 text nodes × 6 runs (re-run after D17/D18) | PASS — 0 failures |
| Targets ≥ 24 px; buttons ≥ 44 px below `sm` | PASS (after fix F-d0); tier radios 13 px pass via the 2.5.8 equivalent-target exception (whole label row ≥32 px, 44 px below `sm`) |
| No horizontal overflow | PASS ×6 |
| Console errors/warnings | PASS — none |
| axe-core (validate_mockup L2) | PASS |
| L1 literal scan | Only expected literals: generated `tokens.css`, as-built replica (the finding), white on `--accent-solid` (contract-sanctioned) |

Fix log: F-d0 switch track was the only hit area (40×20, WCAG 2.5.8) → whole
track+word is the button. F-d1 (sev 3) waiting-row text crushed to a 4-char
column at 375 → text `flex-basis` so pills wrap. F-d2 (sev 2) discovery meta
squeezed by the new Connect → `.main` basis so actions wrap below. F-d3 (sev 1)
mono addresses broke mid-token → break only when needed.

Heuristic rubric (boolean, 10 items): one primary action per state ✔ · state
never by colour alone ✔ · every refusal names a recovery ✔ · no false controls
(D8) ✔ · untrusted text attributed (D2) ✔ · warning before commit point (D3) ✔ ·
new-tab warned (D14) ✔ · copy consistent across surfaces (D12) ✔ · real data,
no placeholders ✔ · tokens only in proposed recipes ✔ → **10/10**.

## Approval

Board approved as-is by the user; D8 (no Cancel) confirmed. D17 (tier choice) and D18 (banner keeps hint) were added after doubt review cycle 1 on the user's decision. D11 lists one request-URL row per LAN endpoint `collectEndpoints` reports.
