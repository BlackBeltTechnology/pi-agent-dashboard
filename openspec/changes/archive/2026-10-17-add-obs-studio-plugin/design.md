## Context

Motivation: see proposal.md. Measured facts: see `spike-findings.md` (F1–F9); this design cites them as `F<n>`. Claims not measured here are marked **unverified**, with the task that verifies them.

Existing machinery this change consumes, unchanged:
- **Managed services.** `attached` mode spawns user argv with `shell: false`, `detached`, and secrets in the child env. The spawn `error` is swallowed (`packages/server/src/services/attached-driver.ts:90-104`). When `process.name` matches a running process, `start` returns an `external`-owned instance without spawning (`attached-driver.ts:91`). `ws-first-message` health passes on the hello frame without a secret (`packages/shared/src/services/schema.ts:91`; `openspec/specs/managed-services/spec.md` "OBS-style websocket health"), so it proves **reachability, not authentication**. `idleStopMinutes` defaults to `null` for `attached` (`schema.ts:176-181`). A definition without `lifecycle.stop` makes stop unsupported (`openspec/specs/managed-services/spec.md` ~L290-296).
- **`service exec`.** First calls `ensure`, which **starts** a stopped service (`service start` is `ensure` without a lease, `packages/server/src/services/service-manager.ts:616-618`), then refuses unless the result is `healthy` (`packages/server/src/services/cli-service.ts:352-354`). It takes a lease, resolves secrets locally, runs the child with `stdio: "inherit"`, heartbeats every 30 s and releases on child exit (`cli-service.ts:351-393`). Without `--json` it writes only to stderr on the success path, so a piped stdout carries only the child's output (`cli-service.ts:355-357,362`). The child receives `SVC_<ID>_<NAME>` (`packages/server/src/services/secret-delivery.ts:54`).
- **`service add --file <def.json> [--yes]`** exists (`cli-service.ts:114`). A directly submitted definition is forced to `origin: "user"` (`packages/server/src/services/service-manager.ts.AGENTS.md`). Mutations need operate authority or local trust; trusted-network callers are refused (`packages/server/src/services/routes.ts:16-19`).
- **Route tiers.** One central table; an unlisted route resolves to `operate` and an untriaged route fails the build (`packages/shared/src/route-tiers.ts:10-12`). Plugin routes are listed by path (`route-tiers.ts:63-68,166-174`). The tier gate exempts genuinely-local and trusted-network callers (`packages/server/src/auth/route-tier-gate.ts:18-19`). `/api/services` mutations additionally require `hasOperateAuthority` (`packages/server/src/auth/operate-required.ts:48`), which refuses trusted-network callers.
- **Plugin identity seam.** `ctx.identity` (`PluginIdentitySeam`, `packages/dashboard-plugin-runtime/src/server/server-context.ts:1277`) offers `isEnforced`, `principalOf`, `principalOfUpgrade`, `authorize`, `userDataDir`; it has no operate check. Its requirements live only in `docs/identity-plane.md` (D24); no capability spec owns it.
- **Strict local proof.** With `requireLocalProof`, a genuinely-local request without proof is refused by the network guard (`packages/server/src/auth/localhost-guard.ts:350-360`). That includes a plugin's `fastify.inject`, so plugins cannot read `/api/services` through `inject` in strict mode. The `pi-dashboard` CLI carries the local credential itself.
- **MCP exposure.** `/api/services` is denylisted from MCP ("lifecycle + secrets; CLI/REST only in core", `packages/mcp-server-plugin/src/server/tools.denylist.ts:71-72`).
- **i18n.** Plugin clients use `useT()` from `@blackbelt-technology/dashboard-plugin-runtime` (e.g. `packages/automation-plugin/src/client/AutomationSettings.tsx:15,39`).
- **Plugin apps.** A global app is a `shell-overlay-route` claim, `presentation: "content"`, `depth: 1`, path `/<app>/*?` (`docs/plugin-apps.md` § Slots recipe). No global-nav slot exists (`packages/shared/src/dashboard-plugin/slot-types.ts`).
- **Package naming.** A package with a plugin manifest is named `@blackbelt-technology/pi-dashboard-<name>-plugin` (`openspec/specs/package-naming-convention/spec.md` rule 1).
- **Generic service UI** is planned by `add-services-settings-ui` (active). The OBS panel does not duplicate it.

## Goals / Non-Goals

**Goals:**
- One `pi-obs` implementation shared by the skill (CLI), the plugin server (panel bridge) and the service start command.
- The OBS password lives only in the managed-services secret store, OBS's own config, and `pi-obs` child envs. It is never in the dashboard server process, plugin config, REST bodies, logs, argv or browser state.
- OBS starts unattended after an unclean exit, while a genuine crash loop still reaches OBS's safe-mode prompt.

**Non-Goals:**
- STT, live media tap, multi-track recording setup, speaker detection, voice-assistant source (follow-up `stt-engine`).
- A generic services UI (`add-services-settings-ui`).
- More than one **local** OBS per host; remote instances are unlimited.
- Per-session `editor-pane-tab` preview, OBS plugin installation, profile switching, Linux `v4l2loopback` setup.
- Windows/Linux hardware verification in CI (manual tasks only).

## Decisions

### D1. Package shape: one plugin package, four entry points
`packages/obs-studio-plugin` (`@blackbelt-technology/pi-dashboard-obs-studio-plugin`, plugin id `obs-studio`):
- `src/core/`: obs-websocket client wrapper, request policy (deny-list), presets, device/display discovery, OBS log reader, install planner, launch state. Pure modules over injected deps (spawn via `@blackbelt-technology/pi-dashboard-shared/platform/exec.js`, fs, clock, ws), unit-testable without OBS.
- `src/bin/pi-obs.ts`: CLI over `src/core`.
- `src/server/`: plugin server entry, i.e. routes plus the bridge manager (D4).
- `src/client/`: settings-section card and global panel app (D6).
- `.pi/skills/obs-studio/`: `SKILL.md` + `references/`.

Rejected: separate skill and plugin packages. They would duplicate `src/core` or need a library package with one consumer.

### D2. Two kinds of verbs: offline and live
- **Offline verbs** need no OBS connection and no secret: `doctor` (without `--live`), `install`, `provision`, `launch`, `stop`. They run directly (`pi-obs <verb>`). `service exec` would refuse them in the very states they diagnose (`cli-service.ts:354`).
- **Live verbs** talk to obs-websocket. The skill runs them as `pi-dashboard service exec <id> -- pi-obs <verb> --service <id>`. The id is always passed explicitly, because the env-name mapping folds `-` and `_` together (`packages/shared/src/services/schema.ts:626-627`), so an id cannot be recovered from `SVC_<ID>_PASSWORD`. Connection resolution: `--service`/`--url` → `SVC_<ID>_PASSWORD` → standalone fallback `OBS_URL`/`OBS_PASSWORD`, which keeps OBS-Transcribe's scripts working. With several `SVC_*_PASSWORD` variables and no `--service`, the verb exits with a usage error.
- A `--password` argument is rejected.
- **Live results distinguish `auth-failed`** (hello received, Identify rejected) from `unreachable`. Managed-services `healthy` means reachable only.
- Rejected: password in `pluginCredentials` (`packages/server/src/server.ts:3774`), because it duplicates the secret and splits rotation. Rejected: `vaultBindings` (`server.ts:3777`), because service secrets reach plugins only after `absorb-service-secrets-into-vault` and with a user grant.

### D3. Provisioning via the existing add flow
- `pi-obs provision [--remote ws://host:port] [--service <id>]` writes a definition JSON to a 0600 temp file and runs `pi-dashboard service add --file <f>`. The CLI handles the dry-run review, confirmation and local credential proof, so `pi-obs` never holds a dashboard bearer. The temp file is deleted afterwards. `--update` passes through.
- **Local definition** (`attached`, id `obs`, exactly one per host):
  - `origin: "user"`;
  - `endpoints.ws`: `ws://127.0.0.1:<server_port>`;
  - `health`: `{kind:"ws-first-message", endpoint:"ws"}`;
  - `process.name`: `OBS` darwin, `obs64` win32 (`.exe` ignored per managed-services matcher rule), `obs` linux (flatpak matching **unverified**, task 9.3);
  - `lifecycle.start[<os>]`: `[<absolute node>, <absolute pi-obs entry>, "launch"]`. Node plus script path, never a shim, because win32 `.cmd` cannot spawn with `shell: false`;
  - no `lifecycle.stop`; `idleStopMinutes: null`;
  - `secrets.password` slot `store:<id>/password` with **no `env` field**, so the secret is never injected into the OBS process.
- **Remote definition** (`external`, id `obs-<slug>`): endpoint + health + password slot `store:<id>/password`.
- **Passwords:** generated ones are 24 characters. Any length is accepted into the store; the managed-services contract sets no minimum, and the vault's `too-short` rule guards only delivery into pi sessions, not `service exec` children. Below 8 characters, `provision` and `doctor` **warn** and offer rotation (OBS-specific policy, not a contract rule; `too-short` scope per `openspec/changes/absorb-service-secrets-into-vault/proposal.md:10`).
- **Ids:** `provision` refuses an id whose `SVC_<ID>_` env name equals that of an existing service (e.g. `obs-a` vs `obs_a`).
- **Order on first provisioning:** `service add --file` (creates the secret slot) → websocket config write (D10) → `service secret set` → verify by connecting.
- **Non-loopback endpoints:** `provision --remote` warns about plain `ws://` for **every** non-loopback host (LAN included) before the review.
- **Instance registry:** `provision` records the id in `<state>/instances.json` (D8). The panel gates on membership (D7). Entries whose service definition no longer exists are pruned on every read.
- `doctor` preflights the start argv (node and entry exist). Background: the driver swallows spawn errors (`attached-driver.ts:101`), so a stale path otherwise shows only as a 120 s start timeout.

### D4. Plugin server ↔ OBS through a piped `service exec` bridge
- The plugin server lazily spawns, via `platform/exec.js` with `stdio: ["pipe","pipe","pipe"]`:
  `pi-dashboard service exec <id> -- <node> <pi-obs entry> serve --stdio --service <id>`.
  `exec` inherits these pipes into `pi-obs` (`cli-service.ts:367`), so the NDJSON channel is the plugin's own pipe. `exec` runs without `--json`, so its success path writes nothing to stdout.
- **Protocol:** NDJSON `{id, op, args}` → `{id, ok, result|error}`; responses are matched by `id`.
- **Timeouts:** connect 3 s, request 5 s (screenshot included), in `src/core` for CLI and `serve` alike. On a panel request timeout the route returns 504 `obs-timeout` and the bridge is terminated (stdin EOF, then kill), so a wedged obs-websocket connection is never reused. Only the panel operations exist (`status`, `screenshot`, `scene.list`, `scene.switch`, `vcam.set`, `record.set`), with the request policy applied. On start, `serve` sweeps leftover `pi-obs-probe*` inputs and scenes (D11).
- **Lifetime:** `serve` exits on stdin EOF, so a dead plugin server or dashboard closes the pipe → `serve` exits → `exec` releases the lease. The bridge also exits after 60 s with no request. On plugin dispose the server closes the bridge's stdin first (EOF makes `serve` exit and `exec` release the lease) and kills `exec` only if it is still alive after 5 s, because `exec` does not forward signals to its child (`cli-service.ts:385-394`). A non-zero exit surfaces the `exec` stderr line as the instance's `lastError`.
- **Who may open a bridge.** Opening a bridge resolves the password into a child and, through `ensure`, could start OBS. So:
  1. The plugin server reads the service state with `pi-dashboard service status <id> --json` (a read; the route behind it, `packages/server/src/services/routes.ts:78`, never ensures). The CLI carries the local credential, so this also works under strict local proof, where `fastify.inject` would be refused. Results are cached for 5 s per instance. An L1 test asserts the read path performs no ensure, start or secret resolution.
  2. A bridge is opened **only** by an operate-authorized request (screenshot or mutation, D7), and **only** when that state is `healthy`. Otherwise the route returns the state without spawning.
  3. `status` (observe tier) never opens a bridge. It returns the service-manager state plus live OBS data (current scene, scene list, virtual-camera and record state, auth state) only if a bridge is already open. **Consequence:** an observe-only viewer sees managed-service state; live OBS state appears once an operator has the panel open. Accepted: opening a connection resolves the password, which stays operate-only.
- **Stdout purity.** An L1 test asserts that `exec` stdout carries only child bytes on success, `lease-unknown` re-ensure and release paths, because `exec`'s own messages go to stderr when `--json` is absent (`cli-service.ts:355-357,362`).
- Rejected: one `exec` per request, because the ensure and spawn cost recurs on every preview poll. Rejected: an in-process client, because it needs the secret in the server process.

### D5. Launch and stop
- **One local instance** owns the OS user's OBS config dir:
  - darwin `~/Library/Application Support/obs-studio`;
  - win32 `%APPDATA%\obs-studio`, or `<root>\config\obs-studio` when portable;
  - linux `~/.config/obs-studio`, or flatpak `~/.var/app/com.obsproject.Studio/config/obs-studio`.
- **`pi-obs launch`:**
  1. If an OBS process exists, exit 0 and touch nothing.
  2. Read `<state>/launch-state.json` `{lastLaunchAt, strikes, suspended}`. A missing file means `{strikes: 0, suspended: false}`. A **corrupt** file fails safe: it is rewritten as `suspended: true` and reported. `suspended` is cleared **only** by `pi-obs launch --reset-recovery` (offered by `doctor`); no other step clears it.
  3. Leftover sentinels are `.sentinel/run_*` files older than 60 s. Younger sentinels are ignored and leave the strike state unchanged. The previous run is judged from the **newest OBS log file** before the new launch (F2):
     - it contains unload-phase lines (`plugin unloaded`, `obs_module_unload`) → **teardown crash** (stop or quit) → not a strike; strikes reset to 0;
     - no unload-phase lines, and log mtime − `lastLaunchAt` < 10 min → **early mid-run crash** → strike + 1;
     - otherwise (late mid-run crash, or no leftover) → strikes reset to 0.
     This judges how the run ended, not when it was relaunched, so stops and UI quits never count, while early crashes do however far apart the relaunches are. On a host without the background-removal plugin, the earliest unload line is unverified (task 9.1).
  4. If `strikes ≥ 2`, set `suspended: true`. Write the state atomically (temp file + rename) **before** spawning. If `suspended`: clear nothing, report `recovery-suspended`, launch. OBS shows its safe-mode prompt, and the service reaches `blocked`.
  5. Otherwise move the leftovers to `<state>/sentinel-quarantine/<ts>/`. Then **re-check the process**: if OBS appeared in the meantime, exit 0 without launching. The quarantined files stay quarantined; the live run's own sentinel is younger than 60 s and was never moved.
  6. Spawn:
     - darwin `open -a <OBS.app path> --args --minimize-to-tray --disable-updater`. `open -a` is the measured path (F1), and launching through LaunchServices keeps OBS the responsible process for macOS permissions (**unverified** for direct spawn, so not used). `--disable-updater` appears in the 32.2.2 `--help` output (F1).
     - win32 `obs64.exe --minimize-to-tray --disable-updater [--portable]`, cwd `bin\64bit` (F8, **unverified**, task 9.2).
     - linux `obs` or `flatpak run com.obsproject.Studio --minimize-to-tray` (**unverified**, task 9.3).
  7. Write `lastLaunchAt`. Keep the 10 newest quarantine batches.
- **Stop:** no `lifecycle.stop` (stop stays unsupported in managed services). `pi-obs stop` refuses any `--service` other than the local `attached` id, then:
  1. warns ("OBS 32 may crash on external quit; the next launch recovers automatically") and asks for confirmation;
  2. resolves the OBS pid with the same exact-basename rule as the service matcher;
  3. sends the per-OS quit (darwin `osascript quit app`, win32 `taskkill /PID <pid>`, linux `SIGTERM` to that pid) through `platform/exec.js` / `platform/process.js`;
  4. judges success only by that pid's exit within 15 s; no force-kill without `--force`;
  5. runs `pi-dashboard service status <id>`, whose route re-probes, so the state refreshes.
- Rejected: a `lifecycle.stop` command, which makes "Stop" look routine although it crashes 3/3 (F2). Rejected: unconditional sentinel clearing, which removes OBS's crash-loop guard.

### D6. Panel: global app + settings entry
- Claims:
  - `shell-overlay-route` `{path:"/obs/*?", depth:2, parentPath:"/settings/plugins/obs-studio", presentation:"content"}` (depth 2 + `parentPath` like the skill-atlas global claim: a depth-1 root claim degrades the cold-load underlay to the card list; Back returns to the settings card) → `<EmbeddedApp>`, standalone `/apps/obs/`;
  - `settings-section` → status card (state, auth state, OBS version, exposure warning, `recovery-suspended`, "Open OBS panel", provision hint).
- Panel: instance picker, scene list + switch, virtual-camera and record toggles, program-scene preview. Opening the panel as an operator issues a screenshot request, which opens the bridge (D4).
- **Preview:** jpg 640 px of the program scene, polled at 1 fps only while `document.visibilityState === "visible"`. After 3 consecutive errors it backs off to 0.2 fps and returns to 1 fps on the first success. Server-side cost 6–12 ms (F5).
- **States:**
  - not healthy, not `blocked` → show state + reason, offer Start/Retry via `POST /api/services/:id/{start,retry}`. These routes apply `hasOperateAuthority` themselves, so the panel's authority rule (D7) is the same for every action;
  - `blocked` → message "OBS is waiting for input on the host", no actions;
  - `auth-failed` → re-provision hint.
- Stop is never offered.
- All strings use `useT()` (`dashboard-plugin-runtime`) with en/zh-CN/hu catalogs.

### D7. Plugin REST routes, tiers and limits
Under `/api/plugins/obs-studio/`; every route gets a row in `route-tiers.ts` and an MCP-manifest classification:

| Method | Path | Tier | Operate authority | Limit |
|---|---|---|---|---|
| GET | `/instances` | observe | — | 30/min |
| GET | `/:service/status` | observe | — | 60/min |
| GET | `/:service/screenshot` | operate | **required** (pixels of desktop/webcam) | 300/min (two 1 fps viewers fit) |
| POST | `/:service/scene` | operate | **required** | 30/min |
| POST | `/:service/virtualcam` | operate | **required** | 10/min |
| POST | `/:service/record` | operate | **required** | 10/min |

- **Operate authority** = `ctx.identity.hasOperateAuthority(request)` (D14), the same predicate as `/api/services` mutations, so trusted-network callers without credentials are refused. If the seam is absent, the route refuses (fail closed).
- **Refusal shapes:** a device or session bearer below `operate` is stopped first by the tier gate (`insufficient_scope`, `route-tier-gate.ts`); a trusted-network caller passes the tier gate and is refused by the predicate with the host's operate-required response. Both are kept (defence in depth); tests assert each shape for its caller type.
- Limits use `@fastify/rate-limit` registered in an encapsulated scope (`global: false`) **without** a loopback allowList, with each route's limit in its route-level `config.rateLimit`. The `gmail-plugin`/`mcp-server-plugin` scopes exempt loopback (`packages/mcp-server-plugin/src/server/routes.ts:113-117`); here, loopback callers are limited too.
- **MCP:** `/api/plugins/obs-studio/` is denylisted in `tools.denylist.ts` ("desktop/webcam pixels and live-production toggles; UI and CLI only"), mirroring `/api/services`.
- `:service` must be in `instances.json` **and** have a current definition; else 404.
- Bodies are schema-validated (400). No raw obs-websocket passthrough.

### D8. Plugin state location
- `~/.pi/dashboard/plugins/obs-studio/` (0700) holds:
  - `launch-state.json`, `instances.json`;
  - `sentinel-quarantine/` (10 newest batches);
  - `config-backups/` (0600, 3 newest);
  - win32 portable install `apps/obs/`.
- `pi-obs` derives it from `os.homedir()` by default and accepts `--state-dir <dir>`. The plugin server passes `ctx.dataDir` via `--state-dir` once `add-plugin-isolation-and-public-routes` ships it (unshipped today; its planned path is the same directory). No cross-change test pins the unshipped API.

### D9. Install planner: detect first, confirm, no silent download
- `doctor` detects:
  - darwin `/Applications/OBS.app`, plus `~/Applications` with "virtual camera unavailable" (F8);
  - win32 registry `HKLM\SOFTWARE\OBS Studio`, then the portable path;
  - linux `which obs`, `flatpak info com.obsproject.Studio`.
  It reports version (≥ 28), arch and websocket config.
- `install` prints the exact command and needs confirmation:
  - darwin `brew install --cask obs`; without `brew` it prints a manual instruction.
  - win32 `winget install --id OBSProject.OBSStudio -e`, or `--portable`: GitHub release zip verified against the asset's published SHA-256 digest (**unverified** that the digest field exists, task 9.2; refuse when absent). Extraction rejects absolute paths, `..` and symlinks. Then `portable_mode.txt` is created.
  - linux `flatpak install --user flathub com.obsproject.Studio`.
- `--yes` skips only the CLI prompt. **Trade-off:** an agent can pass it, so the skill MUST obtain the user's confirmation via `ask_user` first. This is the same posture as `service add --yes`.
- After a darwin install: Allow the camera system extension (F8), and restart apps that cache camera lists.

### D10. Websocket enablement
| OBS state | Action |
|---|---|
| ws enabled + password | import into `store:<id>/password` after explicit consent; value never printed. The value is plain text in `config.json` (spike S3.4 and F1 authenticated with it). Below 8 characters: warn and offer rotation |
| not running (exit observed, then 2 s settle, then **process absence re-checked immediately before the write**), ws disabled or rotation | back up `config.json` to `config-backups/` (0600) → write `server_enabled`, `auth_required`, 24-char password → re-read and verify → `service secret set <id> password` (stdin). On secret-write failure, restore the backup. After the next start, `doctor --live` verifies authentication |
| running, ws disabled | instruct: Tools → WebSocket Server Settings → Enable + Apply; `doctor` re-reads; no file write while running (OBS rewrites the file on exit, per OBS-Transcribe `OBS_INSTALLATION.md` §1, **unverified** here) |

### D11. Live verbs, request policy, presets, devices
- **Verbs:** `status`, `scene list|switch|create`, `devices list [--kind camera|audio|display]`, `input bind <input> --device <id>|--display <uuid>`, `vcam on|off`, `record on|off`, `stream target <url> --key-stdin`, `text set <input> <text>`, `filter add <input> bgremoval`, `screenshot <source> --out <f>`, `preset list|apply <name>`, `call <Request> (--json-file f | stdin)`, `serve --stdio`, `doctor --live`.
- **Capability gating:** each verb checks `GetVersion.availableRequests` and returns `unsupported-request` instead of sending.
- **Request policy** (in `src/core`, shared by verbs, `call` and `serve`):
  1. **Crash deny:** `GetInputPropertiesListPropertyItems` when the target input's kind is `screen_capture`. The kind is resolved by name or UUID via `GetInputList`; an **unresolvable target is denied** (fail closed). The crash itself is from OBS-Transcribe on 32.1.2 (**unverified** on 32.2.2; not re-tested deliberately).
  2. **`call` restrictions:**
     - `Remove*`, `CreateSceneCollection`, `SetCurrentSceneCollection`, `CreateProfile`, `RemoveProfile`, `SetCurrentProfile`, `SetProfileParameter`, `SetStreamServiceSettings` are denied via `call`; dedicated verbs or the OBS UI cover them.
     - Request JSON is accepted only from stdin or `--json-file`, never argv.
  3. **Secret-bearing requests over non-loopback `ws://`** (`stream target`) are refused unless `--allow-insecure-remote`.
- **Displays:** darwin via JXA ObjC bridge (F4). win32/linux report `unsupported`. A warning is shown when displays are mirrored (behaviour **unverified**, F4).
- **Cameras/audio:** property items of an existing input of the kind. Else a temporary input `pi-obs-probe-<kind>` is created in a dedicated scene `pi-obs-probe`, which is never made the program scene, and both are removed in a `finally` step. Probing is refused while streaming or recording (`GetStreamStatus`/`GetRecordStatus`), because a temporary audio input could reach the output (**unverified** whether inactive-scene audio is mixed). Leftover `pi-obs-probe*` inputs and scenes are removed at the start of every live verb, at every `serve` start, and by `doctor --live`. Residue can therefore persist only until the next authenticated connection. `OBS Virtual Camera` is filtered out, and `input bind` refuses it (F9).
- **Presets** `webcam`, `desktop`, `desktop-webcam-pip`, `pip-bgremoval`, `subtitles`:
  - write into the current collection, create missing scenes and inputs by name, and never change existing settings. Scenes are checked with `GetSceneList` before `CreateScene` (601 is measured for inputs only, F6); inputs rely on error 601 = `existing`;
  - for an existing scene, report expected-but-missing items as `incomplete`, without fixing them;
  - bind devices only for inputs the preset created: first non-virtual camera, main display;
  - `pip-bgremoval` reports `plugin-missing` when `background_removal` is absent.
  Layout values come from OBS-Transcribe `scripts/setup-scenes.ts` and `create-subtitles.ts`.

### D12. Diagnostics from the OBS log
- `doctor` scans the newest file in `<config>/logs/`: the whole file, or its **last** 4 MiB when larger (startup lines are kept by also reading the first 64 KiB). The output says when it truncated. It reports:
  - permission lines (`[macOS] Permission for … granted|denied`);
  - `Invalid target display ID` → `stale-display-binding`, plus the affected inputs with `--live`;
  - `Crash or unclean shutdown detected`, `[Safe Mode]` lines;
  - obs-websocket and `obs-backgroundremoval` load lines.
- It also reports exposure (`*:<port>` listener, F1), start-argv preflight (D3) and `recovery-suspended` (D5).
- Black frames are not a permission signal (F4).
- Output: JSON (`--json`) + human summary; the status card renders the JSON.

### D13. Observability
- `pi-obs` logs to stderr: connect/identify outcome (`unreachable|auth-failed|ok`), request type, latency, policy denials. It never logs request bodies of `SetInputSettings` or stream settings.
- The plugin server keeps per-instance bridge restarts and `lastError`, returned by `status`.

### D14. Plugin seam: `ctx.identity.hasOperateAuthority(request)`
- New read-only predicate on `PluginIdentitySeam`. The host implements it by delegating to the server's `hasOperateAuthority(request, localTrust)` (`operate-required.ts:48`). This needs a new `localTrust` field on `PluginIdentityDeps` (`packages/server/src/identity/plugin-identity.ts:43-53`), wired at `packages/server/src/server.ts:3911`. `add-plugin-isolation-and-public-routes` also widens these deps (`hasHostPolicy`); whichever lands second merges both fields. so a plugin route gets exactly the `/api/services` mutation rule: operate-tier bearer, authenticated operator session/principal, or locally trusted caller (strict-mode aware); trusted-network and observe/control callers are refused.
- Available to every plugin. Not trust-gated: it only answers a question about the current request and grants nothing.
- **Disclosure (accepted):** the predicate tells a plugin whether the current request would pass the `/api/services` mutation check. That is a property of a request the plugin already handles, and anyone can learn it by calling `/api/services`. It grants nothing.
- Optional on the type (as `identity` itself is, `server-context.ts:1239`). Consumers must treat absence as refusal.
- Rejected: reading the host's private request markers (`authVia`, `principalTier`) from plugin code, which couples plugins to server internals. Rejected: keeping the route-tier gate, because the user chose the stricter rule for desktop pixels and live-production toggles.

## Risks / Trade-offs

- **[Strike heuristic misjudges]** → log mtime can lag a crash if OBS stops logging first, or a crash 11 min after launch counts as long-lived → at worst extra unattended restarts for late crashes; early crashes reach safe mode after 2 strikes; a corrupt state file fails safe (suspended).
- **[No managed stop]** → status card explains; `pi-obs stop` warns. Re-measure on new OBS releases (manual task).
- **[Pinned absolute paths]** (node via nvm, package moves) → `doctor` preflight + `provision --update`.
- **[Bridge spawns the dashboard CLI from the plugin server]** → CLI resolved as the server's own `process.execPath` + CLI entry. L1 test with injected spawn; EOF and idle exits tested.
- **[`*:4455` exposure (F1)]** → warn + firewall advice; remote is plain `ws://` → warn for every remote, refuse secret-bearing requests remotely without an override.
- **[Agent passes `--yes`]** → skill rule + same posture as `service add --yes`.
- **[New plugin-API surface (D14)]** → read-only predicate, delegated to the existing host check, unit-tested against the same request matrix as `/api/services` mutations.
- **[Presets in the user's collection]** → name-idempotent, never overwrite, report every item.
- **[Windows/Linux unverified]** → manual tasks 9.x; displays unsupported there.

## Migration Plan

- Additive: new package, new plugin routes, new route-tier rows, one new optional method on `PluginIdentitySeam`; no existing definitions touched; provisioning is opt-in.
- Rollback: disable or remove the plugin; optionally `pi-dashboard service remove obs`. OBS keeps the websocket settings; a pre-change config is in `config-backups/`. Restoring it puts back the old password, so also run `service secret set` or remove the service.
- OBS-Transcribe keeps working (env fallback). Its retirement belongs to `stt-engine`.

## Open Questions

- Does OBS ⌘Q (UI quit) exit cleanly on 32.2.2? Affects only the stop warning's wording; manual task 9.1.
