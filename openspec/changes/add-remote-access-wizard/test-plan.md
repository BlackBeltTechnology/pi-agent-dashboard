# Test Plan — add-remote-access-wizard

Stage: design   Generated: 2026-10-16

Hard gate: no unfillable Triple remained (one gap — reachability word for discovered-but-unknown servers — was closed in the spec: they read "found on this network").

L1 = vitest (`packages/client/src/**/__tests__/*.test.ts(x)`, RTL for components). L3 = Playwright vs the docker harness (port from `.pi-test-harness.json`; harness binds `PI_DASHBOARD_HOST=0.0.0.0` — `docker/compose.yml:44`, so restart/resume is L1 only).

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | wizard: Tasks are ordered step lists (Share) | decision-table | L1 | automated | snapshot: zrok primary, readiness `disconnected`, reservedName `robson-home`, not degraded, not connected | `planTask("share", snap)` | `current === "connect"`; provider/install/enable/address rows `skipped`; `k=5,n=6` |
| E2 | wizard: Install/Enable satisfaction | EP | L1 | automated | readiness ∈ {`not-installed`,`not-set`,`disconnected`,`connected`} | evaluate install + enable | install sat = [F,T,T,T]; enable sat = [F,F,T,T] |
| E3 | wizard: Who may enter | EP+BVA | L1 | automated | trusted entries: `[]`, `["127.0.0.1","::1"]`, `["::1/128"]`, `["127.0.0.0/1"]`, `["0.0.0.0/0"]`, `["*.*.*.*"]`, `["localhost"]`, `["192.168.16.0/24"]`+GitHub provider enabled | evaluate door | sat = T,T,T,F,F,F,F,F |
| E4 | wizard: Listen on network satisfaction | EP | L1 | automated | `resolvedBindHost` ∈ {`127.0.0.1`,`localhost`,`::1`,`0.0.0.0`,`::`,`192.168.16.220`} | evaluate bind | sat = F,F,F,T,T,T |
| E5 | wizard: landing LAN road states | decision-table | L1 | automated | (resolved, pending, acceptLan) ∈ {(127,127,F),(127,0.0.0.0,F),(0.0.0.0,0.0.0.0,F),(0.0.0.0,0.0.0.0,T)} | `roads(snap).lan` | Off · Restart pending · Listening, but requests are off · On "all networks (0.0.0.0)" |
| E6 | wizard: Public address satisfaction + applicability | decision-table | L1 | automated | (provider, reservedName, degraded, persistent) ∈ {(zrok,set,F,T),(zrok,set,T,T),(zrok,∅,F,T),(zrok,∅,F,F),(tailscale,∅,F,T)} | plan share | skipped · current+degraded notice · current · skipped (temporary) · row absent and `n=5` |
| E7 | wizard: Satisfied steps collapsed / folded | state-transition | L1 | automated | rows `[skipped,skipped,current]`, `[skipped,current]`, `[skipped,done,current]`, then `showSkipped` | render plan | one folded row "2 steps already set" · single skipped row unfolded · "2 steps done" · 2 individual rows |
| E8 | wizard: Let a device in road inference | decision-table | L1 | automated | (internet on https, lan on, lan listening-only, none) | plan device | road sat showing https URL · road sat LAN · road unsat · road unsat |
| E9 | wizard: inserted steps | state-transition | L1 | automated | no road; branch `wifi` then `anywhere` (separate runs); later bind+accept become satisfied | plan device | wifi ⇒ `[road,bind,accept,qr,approve]`; anywhere ⇒ `[road,provider,install,enable,address,connect,qr,approve]` (no `door`); inserted rows remain after satisfied |
| E10 | wizard: No unloaded value rendered as fact | EP | L1 | automated | config field `loading` / `error` | evaluate bind + accept | satisfied `unknown`; row label "Checking…" / "unknown" |
| E11 | qr-code-dialog: button states precedence | decision-table | L1 | automated | (tunnel states, bind) ∈ {(failed+connected, 0.0.0.0),(1/2 connected, 127),(2/2, 127),(0/1 idle, 0.0.0.0),(0/1 idle, 127),(0/1, unknown)} | `remoteAccessIndicator()` | red · amber · green · blue "listening on the network" · grey "this computer only" · grey + title "network status unknown" |
| E12 | wizard: Choose provider never changes a connected primary | decision-table | L1 | automated | (primary, connected) ∈ {(none,–),(zrok,F),(zrok,T)}; pick tailscale | activate continue | PUT `tunnel.provider=tailscale` · PUT tailscale · no PUT + explanation + Settings link; no `gateway-make-primary-*` rendered in wizard |
| E13 | wizard: Approve completion diff | EP | L1 | automated | paired ids before `[a]`; after `[a,b]` / `[a,b,c]` / `[a]` | pending id leaves list | "‹b label› is paired" · "2 devices paired" · "denied or expired" |
| E14 | wizard: Connect — Which machine | decision-table | L1 | automated | typed `MacBook.local:8000` with list containing `macbook.local:8000`; unknown address; POST → 409 `already_known` (other host); POST → 409 `identity_changed` | continue | no POST, created=F · POST, created=T · existing entry address shown, created=F · task stops showing identity changed |
| E15 | wizard: Connect — discovered entry label | EP | L1 | automated | mDNS result not in known list | render Which machine | row word "found on this network"; no probe request |
| E16 | wizard: Connect — desktop knock identity | decision-table | L1 | automated | (pin, advert, proven) ∈ {(F,–,F),(F,G,F),(F,–,G),(–,–,H)} | Ask runs | knock · no knock (advert mismatch) · no knock identity mismatch · H shown, knock only after confirm |
| E17 | wizard: Open it on the device transport | EP | L1 | automated | endpoint `https://robson-home.shares.zrok.io` / `http://192.168.16.220:8000` (LAN) / `http://10.147.17.5:8000` (zerotier) | render step | pairing payload QR · QR text `http://192.168.16.220:8000` + "choose Request access", no payload QR · no QR + "needs an https address or the same Wi-Fi" |
| E18 | wizard: resume TTL | BVA | L1 | automated | `remoteAccess.run.at` = now−119 s / now−121 s | app reconnects | dialog reopens on stored task+step / dialog stays closed; key removed in both |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | tunnel-provider: Readiness polled only while a provider step is current | invariant (fake timers) | L1 | automated | dialog open on landing 60 s, then provider step 12 s with first evaluation resolving after 7 s, then landing again | readiness calls: 1 on open, 0 more on landing; on provider step ticks at 5 s skipped while in flight, 10 s fires; return to landing +1 | 72 s fake time |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | wizard: status landing | state-convergence | L3 | automated | harness defaults (binds `0.0.0.0` via env, acceptLan off, no tunnel) | click `tunnel-btn` | `gateway-dialog` visible; LAN row "Listening, but requests are off"; Internet Off; 4 `remote-access-task-*` entries |
| F2 | wizard: Listen on network — container already binds all interfaces | state-convergence | L3 | automated | harness `PI_DASHBOARD_HOST=0.0.0.0` | open Allow devices on my network | Listen on network collapsed "already set · all networks (0.0.0.0)"; current step Let devices ask |
| F3 | wizard: LAN consequence before action | DOM order | L1 | automated | Listen on network current; trusted `192.168.16.0/24` | render | consequence text (all networks, unencrypted http, restart, names `192.168.16.0/24`) precedes primary button in DOM order |
| F4 | wizard: re-open satisfied step | state-transition | L1 | automated | Public address skipped | click its row | expands as current showing `robson-home` |
| F5 | wizard: loading then value | state-convergence | L1 | automated | config response delayed 300 ms | open dialog | LAN row shows loading, never "Off", then converges to the loaded state |
| F6 | qr-code-dialog: reachability broadcast | state-convergence | L1 | automated | button grey; WS `reachability_updated {resolvedBindHost:"0.0.0.0"}` | message dispatched | title "Remote access: listening on the network"; no additional fetch issued |
| F7 | qr-code-dialog: devices waiting badge | EP | L1 | automated | `pairingApprovalStore` pending = 0 / 2 | render button | no badge / badge "2" + accessible name contains "2 devices waiting" |
| F8 | wizard: Review raises approval dialog | state-transition | L1 | automated | pending request dismissed | click Review (landing callout and Approve step) | `pairingApprovalStore.preferred === pendingId`, not in `dismissed` |
| F9 | qr-code-dialog: click opens landing in every state | decision-table | L1 | automated | status unavailable / inactive / active | click `tunnel-btn` | dialog landing opens; no navigation to `/settings/gateway` |
| F10 | qr-code-dialog: settings link + disconnect | state-transition | L1 | automated | Internet On | click "All network settings"; separately click Disconnect | dialog closes + location `/settings/gateway`; `POST /api/tunnel-disconnect` then Internet row Off and button grey |
| F11 | design D2: GatewayPage gains orphaned sections | DOM presence | L1 | automated | `/settings/gateway` render | mount `GatewayPage` | readiness board rows, `gateway-make-primary-*` (connected non-primary), reserved-name input, `gateway-degraded-banner` (degraded) present |
| F12 | design D9: ported e2e regression | state-convergence | L3 | automated | existing specs `gateway-board-mobile`, `gateway-reserved-name`, `gateway-primary-offer`, `gateway-readiness-board`, `zrok-v2-tunnel` re-pointed per testid map | run specs | all pass via wizard / `/settings/gateway` navigation; no `gateway-tab-*` selector remains (`rg gateway-tab- tests/e2e` empty) |
| F13 | ui-plan: theme parity + breakpoints | visual | — | manual-only | dialog landing + one wizard per task | view Base dark / Base light / one non-base palette at 375 / 768 / 1440 | [judgment: matches mockup layout, no clipping — no automatable observable] |
| F14 | proposal: dialog is understandable | usability | — | manual-only | first-time operator | asked to "share over the internet" and "let my phone in" | [judgment: completes without help — subjective] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | wizard: Refused changes leave state untouched | fault-injection (abort) | L1 | automated | `PUT /api/config` → 403 | activate Listen on network | message "this browser is not allowed to make the change"; no `POST /api/restart`; step stays current; sessionStorage key absent |
| X2 | wizard: pinned bind | fault-injection | L1 | automated | `reachability.bindHostSource = "env"`, pending `127.0.0.1` | render + activate Listen on network | text names `PI_DASHBOARD_HOST` and `127.0.0.1`; no PUT; no restart; no primary action |
| X3 | wizard: restart refused after save | fault-injection (abort) | L1 | automated | PUT ok; `POST /api/restart` → 500 | activate Listen on network | step "restart pending" with Restart; sessionStorage key removed |
| X4 | wizard: resume happy path | state-transition | L1 | automated | PUT ok, restart ok, socket drops and reconnects within 5 s with resolved `0.0.0.0` | reconnect | dialog on Allow devices on my network; Listen on network "done"; Let devices ask current; key removed |
| X5 | wizard: probe failure | fault-injection | L1 | automated | probe → `{status:"timeout"}` with entry created this run / pre-existing | Check it can be reached | reason "timeout" shown; no advance; Remove offered / not offered |
| X6 | wizard: browser Ask for access | fault-injection (unobservable) | L1 | automated | browser client, target `http://192.168.16.204:8000` | Ask runs | `window.open("http://192.168.16.204:8000/pair?request","_blank","noopener")`; step text says confirmation is not verified; finish offers new-tab open, not in-page switch |
| X7 | wizard: config read failure | fault-injection (abort) | L1 | automated | `GET /api/config` → 500, then 200 | open dialog, click retry | rows "unknown" + retry; after retry converge to loaded values |
| X8 | wizard: tunnel connect fails | fault-injection (abort) | L1 | automated | connect → provider `failed` reason "zrok: name taken" | Go online | step stays current with reason; button red |
| X9 | wizard: identity changed on add | fault-injection | L1 | automated | `POST /api/known-servers` → 409 `identity_changed` | continue Which machine | task stops; message names identity change; no probe call |

## Coverage summary

- Requirements covered: 17/17 delta requirements (wizard 13, qr-code-dialog 5 incl. lazy fetch, tunnel-provider 3, qr-device-pairing 1 via E17) + design D2/D9 regressions.
- Scenarios by class: edge 18 · perf 1 · frontend 14 · error 9
- Scenarios by level: L1 37 · L3 3 · — 2
- Scenarios by disposition: automated 40 · manual-only 2

## New infra needed

- none (RTL + fake timers + Playwright harness already used by `GatewayReadinessBoard.test.tsx`, `TunnelButton.test.tsx`, `tests/e2e/gateway-*.spec.ts`).
