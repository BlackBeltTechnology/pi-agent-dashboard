## Why

The OBS Studio knowledge we already earned lives outside the dashboard, in the private `OBS-Transcribe` repo: obs-websocket v5 control, scene and device recipes, AI background removal, the virtual camera, and a list of crash and permission gotchas. Agents and remote operators therefore cannot set up or drive OBS from the dashboard. The managed-services layer (`add-service-registry-core`) was spiked with OBS as its reference `attached` service but has no OBS consumer. This change makes OBS a first-class, remotely controllable dashboard capability. It is also the foundation for later capture and speech-to-text work (`stt-engine`, voice-assistant source).

## What Changes

- **New package `packages/obs-studio-plugin`** (`@blackbelt-technology/pi-dashboard-obs-studio-plugin`, plugin id `obs-studio`): a dashboard plugin that ships a pi skill (`obs-studio`), a CLI bin (`pi-obs`), server routes, and a client panel. It depends on `obs-websocket-js`.
- **Adopt or install.**
  - `pi-obs doctor` detects an installed OBS (path, version ≥ 28, CPU arch, obs-websocket config state) on darwin, win32 and linux, and **adopts** it when present.
  - When absent, the skill **offers** an install that the user must confirm. Nothing is downloaded silently.
    - macOS: Homebrew cask into `/Applications`. Required because the virtual-camera system extension activates only from there.
    - Windows: `winget`, or a portable copy under `~/.pi/dashboard/plugins/obs-studio/apps/obs/`.
    - Linux: flatpak.
- **Remote-control provisioning.**
  - Enable obs-websocket on loopback with a generated password stored as the service secret `store:<serviceId>/password`. The secret is never printed or passed on argv.
  - If OBS is not running, `config.json` is pre-written. If OBS is running, the user is told to toggle the setting in the UI, because OBS rewrites `config.json` on exit.
  - Register OBS as a user-origin `attached` managed service (`ws-first-message` health, `process.name` adoption, `idleStopMinutes: null`).
  - **Start goes through a `pi-obs launch` wrapper.** OBS 32 removed `--disable-shutdown-check`, so any leftover `.sentinel/run_*` file makes the next launch block on the safe-mode dialog (`blocked`). The wrapper clears stale sentinels only when no OBS process exists. Crashes during shutdown (stops, quits) never count, judged from the OBS log; repeated early mid-run crashes stop the clearing, so a crash loop still reaches safe mode (spike F3).
  - **Stop is explicit-only and warned.** Every external stop crashed OBS 32.2.2 during teardown in the spike (3/3; CoreAudio and freetype races, F2). The service never idle-stops OBS.
  - One **local** OBS per host. OBS on **other machines** registers as `external` services (endpoint plus user-entered password, no lifecycle), unlimited in number.
  - Registration goes through `pi-dashboard service add --file` (review + confirm). Passwords shorter than 8 characters are accepted with a warning and a rotation offer.
- **Control surface (`pi-obs` + skill).**
  - Offline verbs (`doctor`, `install`, `provision`, `launch`, `stop`) run without a secret; live verbs run through `service exec`.
  - Status (reporting `auth-failed` separately from unreachable), scenes, devices and input binding, virtual camera, recording on/off, streaming target (key from stdin), text sources, filters (incl. AI background removal), source screenshots, and a `call <Request>` escape hatch fed only from stdin or a file.
  - A **request policy** blocks requests known to hang or crash OBS (property enumeration on `screen_capture`, fail-closed when the target is unresolved), denies destructive requests (`Remove*`, collection/profile changes) through `call`, and refuses secret-bearing requests over non-loopback `ws://` without an override.
  - `--service <id>` addresses multiple OBS instances.
  - Secrets reach the CLI only through `pi-dashboard service exec`.
- **Presets ported from OBS-Transcribe:** Webcam, Desktop, Desktop + Webcam PIP, AI-background PIP, and the subtitle text source. Presets write into the **current scene collection**, are **idempotent by source name**, and never change existing inputs.
- **Diagnostics from the OBS log.** `pi-obs doctor` reads the latest OBS log: macOS permission lines, `Invalid target display ID` (stale display binding, rebind needed), unclean-shutdown and plugin-load lines. A blank frame alone is not a permission signal; the spike's blank desktop was a stale display id (F4). Displays are listed by their CoreGraphics UUID, which OBS 32.2.2 accepts as `display_uuid`. After the virtual camera activates, the user is told to fully restart other apps, which cache their camera list at launch.
- **Dashboard panel:** a global app via `add-plugin-app-host` with a scene switcher, virtual-camera and record toggles, and a periodic screenshot preview. Plugin server routes relay a fixed set of operations (no raw request passthrough) through a `pi-obs serve` child started via `service exec`. The password never reaches the dashboard server process or the browser. Routes are rate-limited (loopback included) and kept out of the MCP tool manifest. Status reads are observe-tier and never start OBS. Screenshots and mutations need operate authority, the same rule as `/api/services` mutations (trusted-network callers without credentials are refused).
- **Plugin API: `ctx.identity.hasOperateAuthority(request)`**, a read-only predicate that gives plugin routes the host's managed-service mutation rule.
- **Docs:** port `OBS_INSTALLATION.md` knowledge into the skill's references; keep the gotchas list there.

Out of scope (follow-up changes):
- `stt-engine`: multi-track recording setup, realtime + batch STT with Soniox first, Parakeet / MOSS / obs-localvocal later, and STT context. The OBS-Transcribe subtitle pipeline moves there, and OBS-Transcribe is retired after that.
- Live media tap (stream/record → STT), live speaker detection from frames, and the voice-assistant `captureFactory` "obs" source.
- Bundled standalone OBS packaging (OBS-Transcribe's `package-standalone-bundled-obs`).

## Capabilities

### New Capabilities
- `obs-studio-provisioning`: detect / adopt / offer-install OBS per OS; enable obs-websocket with a stored secret; register the local `attached` or remote `external` service; permission and safe-mode diagnostics.
- `obs-studio-control`: the `pi-obs` CLI and `obs-studio` skill. Covers control verbs, idempotent presets in the current scene collection, the request deny-list, multi-instance addressing, and secret delivery through `service exec`.
- `obs-studio-panel`: the dashboard global app and its server proxy routes: scene switcher, virtual-camera and record toggles, screenshot preview, authority rules, and no secret exposure to the browser.
- `plugin-operate-authority`: the operate-authority predicate on the plugin identity seam, with parity to the `/api/services` mutation check.

### Modified Capabilities
None. Windows portable OBS needs working directory `bin/64bit` (documented in spike F8, not measured). The `pi-obs launch` wrapper sets it, so the `managed-services` `lifecycle` schema stays unchanged.

## Impact

- **New code:** `packages/obs-studio-plugin/` (skill, `pi-obs` bin, plugin server routes, client app). Follow the `add-new-plugin-package-checklist`.
- **Touched code:** `packages/dashboard-plugin-runtime/src/server/server-context.ts` (`PluginIdentitySeam.hasOperateAuthority`), `packages/server/src/identity/plugin-identity.ts` + `packages/server/src/server.ts` wiring (delegates to `hasOperateAuthority` with `localTrust`; merges with `add-plugin-isolation-and-public-routes`, which widens the same deps), `packages/shared/src/route-tiers.ts`, `packages/mcp-server-plugin/src/server/tools.denylist.ts`. Managed-services drivers unchanged.
- **Dependencies:** `obs-websocket-js` (already used by OBS-Transcribe). No native addons.
- **Secrets:** uses `store:<serviceId>/password`. It stays compatible with `absorb-service-secrets-into-vault`, which resolves `store:` refs from the vault after migration.
- **Host side effects (all user-confirmed):** a package-manager install, writes to OBS's `plugin_config/obs-websocket/config.json`, and new sources and scenes in the user's current scene collection.
- **Security:** obs-websocket always listens on all interfaces (`*:4455`, no bind-address setting, spike F1), which the managed-services health check already flags as exposure. Remote OBS uses plain `ws://` and is LAN/tunnel only. An `attached` entry carries argv, so adding it needs `operate` authority.
- **No BREAKING changes.**

## Discipline Skills

- `security-hardening`: the new operate-authority plugin seam, secret provisioning and delivery, proxy routes that relay obs-websocket for remote callers, remote `external` endpoints over plain `ws://`, and argv-carrying `attached` definitions.
- `doubt-driven-review`: before installing software on the host or rewriting OBS config, and before the bounded sentinel-clear in `pi-obs launch` stands, because it bypasses OBS's own crash-recovery prompt.
- `observability-instrumentation`: new plugin REST routes and the outbound obs-websocket connection (connect/auth failures, request latency, deny-list hits).
