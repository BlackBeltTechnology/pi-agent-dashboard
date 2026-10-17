# Test Plan — add-obs-studio-plugin

Stage: design   Generated: 2026-10-15

Hard gate passed. One gap (request timeout) was resolved by the user (connect 3 s, request 5 s, 504 `obs-timeout`, bridge restart) and folded into the specs before this plan was written.

Unit tests never talk to a real OBS. They use a fake obs-websocket v5 server (`ws` `WebSocketServer` that answers Hello/Identify and scripted requests), as in `packages/server/src/services/__tests__/health.test.ts`, plus injected spawn/fs/clock. Real-OBS behaviour is manual-only.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | control: Connection resolution | decision-table | L1 | automated | env combos: `--service obs` + `SVC_OBS_PASSWORD`; `SVC_OBS_PASSWORD`+`SVC_OBS_STUDIO2_PASSWORD` no flag; only `OBS_URL`/`OBS_PASSWORD`; `--password x` | `pi-obs status` | resolves to service secret; exit 2 naming both services; uses fallback env; exit 2 naming `service exec` and `OBS_PASSWORD` channels |
| E2 | control: Request deny-list (`call`) | decision-table | L1 | automated | `call` with `RemoveScene`, `SetCurrentSceneCollection`, `CreateProfile`, `SetProfileParameter`, `SetStreamServiceSettings` (JSON on stdin); `GetSceneList`; `GetInputSettings` with JSON as argv | run each | the five denied requests: fake server receives 0 frames, stderr names the OBS UI/verb alternative; `GetSceneList` sent; argv JSON → exit 2 naming stdin and `--json-file` |
| E3 | control: Request deny-list (crash) | EP | L1 | automated | `GetInputPropertiesListPropertyItems` targeting (a) `Desktop Full` kind `screen_capture` by name, (b) unknown `inputUuid`, (c) `Webcam Full` kind `av_capture_input_v2` | `pi-obs call` and `serve` op | (a) 0 frames, refusal recommends `pi-obs devices list --kind display`; (b) 0 frames, `unresolved-target`; (c) frame sent, items returned |
| E4 | control: Control verbs (gating + stream key) | decision-table | L1 | automated | fake OBS whose `availableRequests` lacks `CreateScene`; `stream target rtmp://h/app --key-stdin` key `sk-123` against `ws://127.0.0.1` and `ws://10.0.0.5` | `scene create X`; stream target | `unsupported-request`, 0 `CreateScene` frames; loopback → `SetStreamServiceSettings` sent and `sk-123` absent from stdout, stderr and child argv; `10.0.0.5` without `--allow-insecure-remote` → refused before connect |
| E5 | control: Idempotent presets (repeat + preserve) | state-transition | L1 | automated | empty collection; then the same collection with `Webcam Box` carrying user settings `{device:"X"}` | `preset apply desktop-webcam-pip` twice | first run reports `created` items; second reports all `existing` and sends 0 `Create*`/`Set*` frames; `Webcam Box` receives no `SetInputSettings`; `GetSceneList` precedes every `CreateScene` |
| E6 | control: Idempotent presets (partial) | EP | L1 | automated | existing scene `Desktop + Webcam` lacking `Webcam Box`; `GetSourceFilterKindList` without `background_removal` | `preset apply desktop-webcam-pip`; `preset apply pip-bgremoval` | first reports `incomplete` and adds nothing to that scene; second reports filter `plugin-missing`, other items applied, exit 0 |
| E7 | control: Device discovery | decision-table | L1 | automated | (a) camera items incl. `OBS Virtual Camera`; (b) no audio input + `GetRecordStatus.outputActive=true`; (c) no audio input, outputs idle, listing request throws; (d) leftover `pi-obs-probe-audio` input | `devices list`; `input bind Webcam Full --device <vcam id>`; any live verb for (d) | (a) list excludes the virtual camera, bind refused with feedback-loop message; (b) `output-active`, 0 `CreateInput`; (c) probe created in scene `pi-obs-probe`, then input and scene removed despite the throw; (d) leftover removed before the verb runs |
| E8 | provisioning: Unattended start (strike rule) | decision-table + BVA | L1 | automated | `launch-state.json` + fixture logs: no leftover; leftover + log with `plugin unloaded`; leftover, no unload lines, log mtime − launch = 9 m 59 s / 10 m 01 s; sentinel age 59 s / 61 s; strikes 1 + early crash; `suspended:true` + no leftover; corrupt JSON | `pi-obs launch` with injected clock/fs/spawn | reset / reset / strike+1 / reset / ignored-unchanged / considered / `suspended:true` written before spawn and 0 files moved / stays suspended / rewritten `suspended:true`, 0 files moved; `--reset-recovery` clears `suspended` |
| E9 | provisioning: Unattended start (process races + retention) | state-transition | L1 | automated | OBS process present at start; OBS process appears after the move; 11 existing quarantine batches | `pi-obs launch` | 0 moves, 0 spawns; 0 spawns and files stay in quarantine; oldest batch deleted, 10 remain. darwin spawn argv = `open -a <app> --args --minimize-to-tray --disable-updater` |
| E10 | provisioning: Service registration | EP + decision-table | L1 | automated | local provision; second local provision; ids `obs-a` existing + new `obs_a`; `--remote ws://10.0.0.5:4455`; `--remote ws://127.0.0.1:4456` | `pi-obs provision` (injected `pi-dashboard` spawn) | definition JSON: `origin:"user"`, `mode:"attached"`, no `lifecycle.stop`, `idleStopMinutes:null`, secret slot `store:obs/password` without `env`, start argv = absolute node + entry + `launch`; temp file 0600 passed to `service add --file` and deleted after; second local refused naming `obs`; `obs_a` refused (env-name collision); unencrypted warning printed for `10.0.0.5` before the review, none for loopback; id appended to `instances.json` |
| E11 | provisioning: obs-websocket enablement | decision-table | L1 | automated | config states: running+disabled; stopped+disabled; stopped + secret-set fails; stopped but OBS reappears before write; enabled with 6-char password + consent | enablement step | no write + UI instruction; backup (0600, ≤3 kept) → write → re-read verify → `service secret set obs password` on stdin; backup restored + failure exit; no write; stored + short-password warning + rotation offer. In every case the password never appears in stdout, stderr or any spawned argv |
| E12 | provisioning: Confirmed install | decision-table | L1 | automated | no TTY, no `--yes`; darwin without `brew`; win32 portable release asset without digest; verified zip containing `../../evil.dll` and a symlink entry | `pi-obs install` | plan printed, exit ≠ 0, 0 installer spawns; manual obsproject.com instruction, 0 spawns; refused, 0 bytes extracted; refused, nothing written outside `apps/obs/` |
| E13 | provisioning: Diagnostics from the OBS log | EP | L1 | automated | fixture logs: permission granted + `Invalid target display ID: 0`; screen capture denied; `Crash or unclean shutdown detected`; 6 MiB log with permission lines at start and crash line at end; definition whose node path is missing; service `blocked`, no secret | `pi-obs doctor --json` | `stale-display-binding` and no permission issue; permission advice + restart note; unclean shutdown reported; both found, `truncated:true`; `start-argv-missing` + re-provision hint; runs and reports without a secret |
| E14 | provisioning: Stop is explicit and warned | state-transition | L1 | automated | local OBS pid 4242; quit command rc 1 while pid exits in 2 s; pid alive after 15 s; `--service obs-studio2` (external) | `pi-obs stop --yes` | success; failure, 0 SIGKILL; refused, 0 signals; only pid 4242 targeted; `service status obs` invoked after |
| E15 | plugin-operate-authority | decision-table | L1 | automated | request matrix: operate bearer, observe bearer, control bearer, operator session, trusted-network no credential, loopback non-strict, loopback strict without proof | `ctx.identity.hasOperateAuthority(req)` vs `hasOperateAuthority(req, localTrust)` | identical boolean for every row (true, false, false, true, false, true, false) |
| E16 | panel: Fixed relay operations / status | decision-table | L1 | automated | `:service` = id not in `instances.json`; another service with `endpoints.ws`; registered id whose definition was removed; scene POST without `sceneName`; observe status poll on `stopped`; observe status on `healthy` with no bridge | inject requests into the plugin routes (stub CLI + spawn) | 404, 0 spawns; 404; 404 and entry pruned; 400, 0 bridge calls; body `state:"stopped"`, 0 bridge spawns, 0 secret resolutions; managed state only, 0 bridge spawns |
| E17 | panel: Authority and secret isolation | decision-table | L1 | automated | observe bearer POST scene; trusted-network no credential GET screenshot; seam absent + operate bearer POST record | inject | 403 `insufficient_scope` (tier gate); 403 operate-required body; refused; 0 bridge spawns in all three; no response or log line contains the fake password |
| E18 | panel: Rate limit | BVA | L1 | automated | 30 and 31 scene POSTs in 60 s from `127.0.0.1` | inject | 30th → 200; 31st → 429, 0 bridge calls |
| E19 | panel: tiers + MCP | completeness | L1 | automated | the six `/api/plugins/obs-studio/*` routes | `route-tier` completeness + `mcp-manifest-completeness` tests | every route has a `ROUTE_TIERS` row (instances/status observe, others operate); none appears as an MCP tool; denylist entry present |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | panel: Preview cost bound | threshold (fake timers) | L1 | automated | preview hook visible for 10 s; hidden for 10 s; 3 consecutive errors then success | request count | 10 ± 1 requests visible; 0 hidden; 0.2 fps after the 3rd error; back to 1 fps after the first success |
| P2 | panel: bridge idle + state cache | threshold (fake clock) | L1 | automated | 10 status polls within 5 s; no request for 60 s on an open bridge | CLI status reads; bridge exit | 1 `service status` read; bridge stdin closed at 60 s, exits, lease released |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | panel: Panel and entry point (settings card) | state-transition | L3 | automated | `page.route` stubs: `/instances` empty; then one healthy instance with `exposure:"all-interfaces"`, version `32.2.2` | open Settings → OBS section | empty → provision hint, no control buttons; healthy → version `32.2.2`, exposure warning, "Open OBS panel" link navigates to `/obs/` with sidebar still visible |
| F2 | panel: Lifecycle actions delegate | state-transition | L3 | automated | stubbed status `blocked`; `stopped`; `auth-failed`; `healthy` | open `/obs/` per state | blocked → host-input message, no Start/Retry/scene/toggle buttons; stopped → Start present and clicking it issues `POST /api/services/obs/start`; auth-failed → re-provision hint; no Stop control in any state |
| F3 | panel: standalone host | convergence | L3 | automated | healthy stub with scenes `["Webcam","Desktop"]` | open `/apps/obs/` | scene list renders both names and the program preview `<img>` gets a `data:`/blob source; no dashboard sidebar |
| F4 | panel: localization | completeness | L1 | automated | `en`, `zh-CN`, `hu` catalogs of the plugin | catalog parity test | identical key sets; no empty values |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | control: Connection + timeouts | fault-injection (abort + delay) | L1 | automated | fake server: port closed; Hello sent then Identify rejected; Hello withheld; request unanswered | `pi-obs status` | `unreachable`; `auth-failed`; `timeout` at 3 s; `timeout` at 5 s; all exit ≠ 0 |
| X2 | panel: OBS hangs / bridge dies | fault-injection (delay + abort) | L1 | automated | `serve` stub never answers `scene.switch`; `exec` stub exits 1 with stderr `obs: failed — retryAt …` | POST scene; then GET status; then POST scene | 504 `obs-timeout` at 5 s and bridge terminated; status `lastError` equals the stderr line, restart counter 1; next request spawns a new bridge |
| X3 | panel: bridge lifetime | fault-injection (abort) | L1 | automated | real `pi-obs serve --stdio` child (spawned via `process.execPath`) with a stub `exec` parent | close stdin; plugin dispose with a child ignoring EOF | `serve` exits within 1 s of EOF; on dispose stdin closed first and `exec` killed only after 5 s |
| X4 | panel: concurrent requests | state-convergence | L1 | automated | `serve` stub answers request ids out of order (screenshot slow, scene fast) | screenshot + scene switch in flight together | each HTTP caller receives its own response body |
| X5 | managed-services: exec stdout purity | fault-injection | L1 | automated | `service exec` success path; heartbeat 404 → re-ensure path; release path; no `--json` | run `exec` with a child echoing a fixed NDJSON line | parent stdout equals exactly the child's bytes; all exec messages on stderr |
| X6 | panel: state read path | fault-injection | L1 | automated | strict local proof on; stubbed CLI `service status obs --json` returns `stopped` | operate screenshot request | state read via the CLI (no `fastify.inject`), 0 ensure/start calls, 0 secret resolutions, route returns state without a bridge |

### Manual-only

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| M1 | end-to-end on macOS | visual/hardware | — | manual-only | developer Mac, installed OBS 32.2.2 | provision → panel scene switch → `vcam on` → Google Meet after app restart | [judgment: OBS UI follows the panel; "OBS Virtual Camera" selectable and correct in Meet] |
| M2 | real crash recovery | hardware | — | manual-only | running local OBS | `pi-obs stop` (crashes per F2) → `service start obs` | [judgment: OBS returns without the safe-mode dialog; status healthy] |
| M3 | ⌘Q + teardown markers (task 9.1) | hardware | — | manual-only | OBS with and without background-removal plugin | quit via ⌘Q, inspect `.sentinel` and log | [judgment: record whether a sentinel remains and which unload lines appear] |
| M4 | Windows portable (task 9.2) | hardware | — | manual-only | Windows host | portable install + launch + registry detection | [judgment: launches with cwd `bin\64bit`, `obs64` matched, digest field present] |
| M5 | Linux flatpak (task 9.3) | hardware | — | manual-only | Linux host | flatpak launch + doctor | [judgment: process matched, sentinel path correct] |
| M6 | spike residue cleanup (task 8.1) | hardware | — | manual-only | developer Mac | remove `pi-spike`, rebind Desktop display | [judgment: only `Untitled` collection; Desktop screenshot non-blank] |

---

## Coverage summary

- Requirements covered: 19/19 (provisioning 7, control 6, panel 5, plugin-operate-authority 1).
- Scenarios by class: edge 19 · perf 2 · frontend 4 · error 6 · manual 6.
- Scenarios by level: L1 28 · L2 0 · L3 3 · — 6.
- Scenarios by disposition: automated 31 · manual-only 6.

## New infra needed

- A fake obs-websocket v5 server test helper inside `packages/obs-studio-plugin/src/core/__tests__/` (Hello/Identify with auth challenge, scripted request responses, delay/withhold). Built on `ws` like `health.test.ts`; package-local, not shared.
