# Test Plan — add-gmail-auto-setup

Stage: design   Generated: 2026-10-17

Sources: proposal.md, design.md (D1–D12), specs/gmail-auto-setup, specs/gmail-plugin, specs/dedicated-agent-browser.

Gate: HARD (design stage). No unfillable slot: timings (1 s run poll, 30 s keep-alive, 60 s step limit, 15 min checkpoint limit, 2 s policy continue), step ids, the `wizardStep` map, handoff reasons and validation rules are fixed. No clarification markers.

Harness facts:
- Gmail server units use `capturingLogger` and fakes from `packages/gmail-plugin/src/__tests__/fakes.ts`; routes via `app.inject` as in `server/__tests__/routes.test.ts`.
- The console is simulated by a `FakeConsole` page model behind a fake CDP socket (role+name AX nodes per page, scripted transitions, dialog DOM with a `GOCSPX-` secret); the `browser.dedicated` service is a fake object.
- Browser-plugin service tests extend `packages/browser-plugin/src/server/__tests__/index.test.ts` and `relay-manager.test.ts`; real-Chrome rows follow `packages/browser-plugin/src/server/relay/__tests__/real-clients.integration.test.ts` and skip with a reason when Chrome is absent.
- Client: `client/__tests__/panel.test.tsx` and `wizard.test.tsx`; L3 probes extend `tests/e2e/gmail-plugin.spec.ts`.
- Timers: `vi.useFakeTimers()`.

Harness exemplars (verified on disk):
- L1 gmail routes ← `packages/gmail-plugin/src/server/__tests__/routes.test.ts`
- L1 gmail sign-in URL ← `packages/gmail-plugin/src/server/__tests__/google-oauth.test.ts`
- L1 gmail client ← `packages/gmail-plugin/src/client/__tests__/panel.test.tsx`, `wizard.test.tsx`
- L1 browser service ← `packages/browser-plugin/src/server/__tests__/index.test.ts`, `relay-manager.test.ts`
- L1 integration ← `packages/browser-plugin/src/server/relay/__tests__/real-clients.integration.test.ts`
- L3 probes ← `tests/e2e/gmail-plugin.spec.ts`

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | GAS Entry point | decision table | L1 | automated | (service present?, enabled∧available?, client?, accounts?, local?) ∈ {(n,·,n,0,y), (y,n,n,0,y), (y,y,n,0,y), (y,y,y,0,y), (y,y,y,1,y), (y,y,n,0,n)} | `GET /api/plugins/gmail/state` | `autoSetup.available` false / false / true / true with replace notice flag / false / false with `local:false` |
| E2 | GAS Entry point (genuine local) | EP | L1 | automated | start request from peer ∈ {`127.0.0.1`, `::1`, `192.168.1.5`, `127.0.0.1` + `X-Forwarded-For`, `127.0.0.1` + `Forwarded`, `127.0.0.1` + `Via`} | `POST setup/run` | first two start; the rest 403 `remote_dashboard` |
| E3 | GAS Lifecycle (validation) | EP | L1 | automated | body ∈ {`{mode:"existing"}`, `{mode:"existing",projectId:"PiDashboard"}`, `{mode:"new",ownerEmail:"x"}`, `{mode:"bogus"}`, valid new, valid existing} | `POST setup/run` | 400 ×4 naming the rule; 200 `{runId}` ×2 |
| E4 | GAS Lifecycle (single run) | state | L1 | automated | run live | second `POST setup/run` | 409 `run_active` |
| E5 | GAS Steps (wizardStep map) | EP | L1 | automated | handoff at each step id | read run view | `project`,`api`→1; `branding`→2; `publish`→3; `client`,`capture`→4 |
| E6 | GAS Steps (generated id) | EP | L1 | automated | new mode without `projectId` | start | project id matches `^pi-dashboard-[a-z0-9]{6}$` and passes the plugin's project-id rule |
| E7 | GAS Steps (client name suffix) | EP | L1 | automated | clients list ∈ {[], [`pi-dashboard`], [`pi-dashboard`, `pi-dashboard-2`]} | `client` step | names `pi-dashboard`, `pi-dashboard-2`, `pi-dashboard-3`; each appended to `created.clients` |
| E8 | GAS Checkpoints (audience) | decision table | L1 | automated | (parent org?, branding done?) ∈ {(y,n), (n,n), (y,y), (n,y)} | reach `branding` | decision `internal` offering both / `external` offering External only / skipped reporting existing type ×2 |
| E9 | GAS Checkpoints (links) | EP | L1 | automated | `continue` with links ∈ {defaults + `confirmLinks:true`, defaults without confirm, privacy `http://example.com/p`, home `https://evil.test` with domain `github.com`} | continue | first proceeds; others 400, state stays `waiting_decision` |
| E10 | GPL Multi-account (login_hint) | EP | L1 | automated | `POST /accounts` with `email` ∈ {`robson@semmi.se`, absent, `not-an-email`, 255-char address} | start sign-in | URL has `login_hint=robson%40semmi.se`; no `login_hint`; 400; 400 |
| E11 | GPL Multi-account (unverified notice) | decision table | L1 | automated | audience ∈ {external, unknown, internal} | sign-in waiting | notice includes the unverified-app sentence for external and unknown only |
| E12 | DAB service (refusals) | decision table | L1 | automated | (loaded, kill switch, profile free) ∈ {(y,on,free), (y,on,busy), (y,off,·), (stopped,·,·)} | `connect({client:"gmail-setup"})` | `{cdpUrl, instanceId}` + holder `gmail-setup` / `{409,"busy",holder,instanceId}` / `{403,"disabled"}` nothing launched / `{503,"unloaded"}` |
| E13 | DAB service (focus/origin) | EP | L1 | automated | server-owned tab on `https://accounts.google.com/x?y` | `tabOrigin`, then tab closed | `https://accounts.google.com`; then `null` |
| E14 | GAS Secret capture (masking helper) | EP | L1 | automated | text with `GOCSPX-abc_DEF-123`, two secrets, none | `maskSecrets` | each secret → `GOCSPX-***`; other text unchanged |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | GAS Entry point (UI) | decision table | L1 | automated | `autoSetup` ∈ {available, available+replace, unavailable, remote} | render settings | secondary "Set up automatically" / with replace notice / absent / remote note; exactly one primary button ("Add account") in every case |
| F2 | GAS run progress | state | L1 | automated | run view sequence running→waiting_user(policy)→waiting_decision(audience)→busy→done | poll every 1 s | step chips track `step`; checkpoint prompt text per kind; audience choice buttons; busy shows holder + Take over; done shows Add account prefilled with owner email |
| F3 | GAS Busy takeover (UI) | state | L1 | automated | run `busy` | click Take over, then Cancel in the confirm; then confirm | no request after Cancel; one `POST takeover` after confirm |
| F4 | GAS Hand-off (UI) / GPL Guided setup | state | L1 | automated | run ends `handoff {step:"capture", wizardStep:4, reason:"secret_capture_failed"}`, `created.clients:["pi-dashboard-2"]` | render | wizard expanded, step 4 `aria-current="step"`, project id filled, reason sentence, `pi-dashboard-2` named with add-secret guidance |
| F5 | GPL Wizard probes | convergence | L3 | automated | each new state (entry, remote note, start form, running, waiting_user sign_in/policy, audience and links decisions, busy, hand-off) | probe in `{base,dark}`, `{base,light}`, `{nord,dark}` at 375/768/1440 | contrast, size and focus probes pass; existing `gmail-*` test ids still render |
| F6 | GPL i18n | EP | L1 | automated | zh-CN and hu catalogs | parity check | identical key sets incl. all new keys; every handoff reason has an `ERROR_EN` fallback |

### Error-handling

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| R1 | GAS Steps (resume) | state | L1 | automated | FakeConsole with project existing and Gmail API enabled | start existing-mode run | `project`,`api` `skipped`; run continues at `branding` |
| R2 | GAS Steps (handoff reasons) | fault injection | L1 | automated | FakeConsole injects: unknown page at `api`; `lang="hu"` at `branding`; navigate denied by deny set at `project`; step hangs 61 s at `client` | run | handoff `unexpected_page`@api/1; `locale`@branding/2; `domain_blocked`@project/1 naming both domains; `timeout`@client/4 |
| R3 | GAS Checkpoints (policy) | state | L1 | automated | branding form with unchecked policy box | run reaches it; FakeConsole checks the box after 30 s | state `waiting_user` `policy`; run never sends a click on the box; continues within 2 s of the check |
| R4 | GAS Checkpoints (sign-in redirect guard) | fault injection | L1 | automated | during `client`, FakeConsole redirects the run tab to `https://accounts.google.com/signin` | redirect | `Fetch.failRequest` issued before any `Page.frameNavigated` to accounts.google.com; run tab → `about:blank`; `open` called with `login_hint` and the run's instanceId; `focus` called; console reloaded only after `tabOrigin` leaves accounts.google.com |
| R5 | GAS Checkpoints (timeouts/cancel publish) | fault injection | L1 | automated | (a) `console_terms` never cleared for 15 min; (b) publish dialog cancelled | wait | (a) handoff `timeout`; (b) handoff `publish_cancelled`@publish/3 |
| R6 | GAS Lifecycle (keep-alive) | state | L1 | automated | run in `waiting_decision` for 20 min (fake timers) | time passes | a client command sent every 30 s; socket still open |
| R7 | GAS Lifecycle (browser closed / cancel) | fault injection | L1 | automated | (a) fake socket closed by the browser side mid-`api`; (b) user `DELETE` | event | (a) handoff `browser_closed`; (b) state `cancelled`, `disconnect(instanceId)` called |
| R8 | GAS Secret capture (dialog path) | EP | L1 | automated | creation dialog DOM with id + `GOCSPX-…` secret | `capture` | client stored with id, secret and project id; captured logs, run views and route responses contain no `GOCSPX-` value |
| R9 | GAS Secret capture (JSON fallback) | fault injection | L1 | automated | dialog read throws; download writes `client_secret_X.json` to the fake downloads dir; (b) store throws after read | `capture` | (a) stored from JSON, file deleted; (b) file still deleted, handoff reason masked |
| R10 | GAS Secret capture (both fail) | fault injection | L1 | automated | dialog read and download both fail | `capture` | dialog closed; handoff `secret_capture_failed`@capture/4; `created.clients` names the client |
| R11 | GAS Steps (client_in_use) | fault injection | L1 | automated | an account added before `capture` stores | store refuses | handoff `client_in_use`@capture/4 |
| R12 | GAS Busy | state | L1 | automated | service returns busy with holder session `S` and instanceId I | start; then takeover | state `busy {holder:S}` without instanceId in the view; takeover calls `connect({client:"gmail-setup", takeover:true, private:true, ephemeral:true})`; run continues |
| R13 | GAS Busy (other refusals) | decision table | L1 | automated | service refusal reason ∈ {`disabled`, `unloaded`, `no-chrome`, `no-display`, `owned-by-other-server`, `profile-in-use`, `launch-failed`} | start | handoff at `project`/1 with that reason |
| R14 | DAB service (atomic takeover) | fault injection | L1 | automated | agent holds the profile; agent's reconnect fires between the holder close and the new registration | `connect({takeover:true})` | consumer holds the profile; agent receives `busy` |
| R15 | DAB service (private) | EP | L1 | automated | private instance with one tab | status broadcast + viewer subscribe | tab absent from `browser_relay_status`; subscribe refused and audited `viewer-subscribe-refused` |
| R16 | DAB service (ephemeral) | state | L1 | automated | ephemeral instance | client `Target.createTarget`, `Target.getTargets`, `Target.createBrowserContext` | createTarget carries the instance's `browserContextId`; getTargets lists only that context; client `createBrowserContext` refused; context disposed on close |
| R17 | GPL Secrets never logged (setup) | EP | L1 | automated | full FakeConsole run plus a failing run with a secret in the dialog | capture logs | no line matches `GOCSPX-[A-Za-z0-9_-]{4,}` except `GOCSPX-***`; one log line per step with id, outcome and ms |
| R18 | GAS Lifecycle (gmail loads without browser) | EP | L1 | automated | `consume("browser.dedicated")` undefined at load, defined later | `GET state` twice | plugin loads; `autoSetup.available` false then true |

### Integration (real Chrome)

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| I1 | DAB service (ephemeral discard) | contract | L1 | automated | real dedicated Chrome (skip with reason when absent) | set a cookie in an ephemeral instance, disconnect, connect normally and ephemerally | cookie absent in the normal context and in the new ephemeral context |

### Manual-only

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| M1 | GAS end to end on the real console | exploratory | — | manual-only | personal and Workspace accounts, throwaway projects | "Set up automatically" | both `done`; an account signs in; no `GOCSPX-` in `server.log` or under `~/.pi/dashboard/agent-chrome`; downloads dir empty; a later agent `browser_connect` is not signed in as the owner; projects deleted afterwards |
| M2 | Security review | review | — | manual-only | secret paths, private/ephemeral instance, downloads cleanup, genuine-local start | `security-hardening` review | notes committed, no open high finding |
