# Spike findings — add-obs-studio-plugin (2026-10-15)

Host: macOS, Apple M5 Pro, OBS Studio **32.2.2** (arm64, `/Applications`), obs-websocket **5.7.4** (RPC 1), `obs-websocket-js` 5.0.8.
Harness: `/tmp/obs-spike/` (throwaway). User consented to launch/quit OBS and to a throwaway `pi-spike` scene collection.
Tags: **MEASURED** = observed here; **DOCUMENTED** = upstream docs/issues, not run here.

## F1 — Launch and websocket readiness — MEASURED
- `open -a OBS --args --minimize-to-tray` → `:4455` listening in **1.35–1.72 s** (3 launches).
- obs-websocket binds `*:4455` (IPv6 dual-stack). Log: `Not locked to IPv4 bindings`. `config.json` has no bind-address key → the managed-services check reports `exposure: "all-interfaces"` for every local OBS. The skill can only warn (firewall), not fix.
- `GetVersion` 38 ms; 151 requests available; `availableRequests` used for capability gating.
- `OBS --help` (32.2.2) lists `--minimize-to-tray`, `--disable-updater`, `--multi`, `--collection`, `--profile`, `--scene`, `--startvirtualcam`, `--safe-mode`, `--only-bundled-plugins`, `--disable-missing-files-check`; no shutdown-check flag.

## F2 — External stop crashes OBS 32.2.2 on this host — MEASURED (3/3)
| Stop | rc | exit | next launch |
|---|---|---|---|
| `osascript -e 'quit app "OBS"'` (uptime 74 s) | 1 (`-128`) | 0.35 s | `Crash or unclean shutdown detected` → safe-mode dialog, ws down |
| `kill -TERM` | 0 | 0.26 s | same |
| `kill -TERM` after removing all audio inputs (throwaway collection) | 0 | 0.26 s | same |

- Crash reports (`~/Library/Logs/DiagnosticReports/OBS-*.ips`), SIGSEGV:
  - runs 1–2: `libobs copy_audio_data ← obs_source_output_audio ← mac-capture ← CoreAudio HALC_IOThread` (CoreAudio thread pushing into a source being destroyed);
  - run 3: `libfreetype FT_Done_Face ← text-freetype2 ← obs_source_destroy_defer`.
- Shutdown log ends with `N output(s)/encoder(s)/source(s) were remaining`. Teardown is not orderly.
- **Teardown vs mid-run crash is visible in the log.** All three crashed runs (and an older one, `2026-10-08 06-23-28.txt`) contain unload-phase lines (`[obs-backgroundremoval] plugin unloaded`, `[obs-websocket] [obs_module_unload] Shutting down...`). Clean exits end with `Number of memory leaks: 0` (`2026-10-08/09/13` logs). A crash during a run would show neither. Measured with the background-removal plugin installed; on a host without it, the earliest unload line differs (unverified).
- Not tested: quitting from OBS's own UI (⌘Q).
- **Implication:** the dashboard cannot promise a clean stop. `lifecycle.stop` must be explicit-only (never idle-stop, `idleStopMinutes: null`) and must warn that the next launch may need recovery.

## F3 — Unclean-shutdown detection is a sentinel file — MEASURED
- `~/Library/Application Support/obs-studio/.sentinel/run_<uuid>`: one file per run, deleted on clean exit. Leftover files trigger the safe-mode prompt on next launch.
- With **no OBS process running**, moving stale `run_*` files aside → next launch: ws in 1.35 s, no dialog, no unclean line in log.
- DOCUMENTED: `--disable-shutdown-check` was **removed in OBS 32.0** (obsproject/obs-studio#12650; forum thread 190590). `--safe-mode` disables websockets. No supported flag remains.
- While the dialog is shown: process alive, ws down → managed-services `blocked`. Answering "Run in Normal Mode" → same pid becomes healthy (re-confirms spike S3.2).
- **Implication:** a `pi-obs launch` start wrapper clears stale sentinels (only when no OBS process exists), then launches. This is a deliberate safety bypass: it must be bounded (e.g. stop clearing after N consecutive failed starts so a crash-looping plugin still reaches safe mode) and visible in the service status.

## F4 — Blank desktop was a stale display id, not permissions — MEASURED
- Existing `Desktop Full` / `Desktop Combined` / `macOS Screen Capture` render nothing; log: `mac-screencapture: init_screen_stream: Invalid target display ID: 0`. Displays changed (new machine), `display_uuid` stale.
- Same log, at startup: `[macOS] Permission for screen capture granted` (also audio, video, input monitoring). **The latest OBS log is the authoritative permission source**; a black-frame heuristic would have misdiagnosed this.
- **CoreGraphics `CGDisplayCreateUUIDFromDisplayID` value works as `display_uuid` on 32.2.2** (new `screen_capture` input rendered the desktop). This **contradicts** OBS-Transcribe's gotcha ("not the CG value"), which was observed on 32.1.2 with mirrored displays. Displays can therefore be enumerated natively, without `GetInputPropertiesListPropertyItems` (crash, not re-tested).
- `screen_capture` with empty settings: `display_uuid: ""` → renders nothing (702 on screenshot). Always set it explicitly.
- **No toolchain needed:** `osascript -l JavaScript` with `ObjC.import("CoreGraphics"); ObjC.import("ColorSync")` → `CGGetActiveDisplayList` + `CGDisplayCreateUUIDFromDisplayID` + `CFUUIDCreateString` (read via `ObjC.castRefToObject(s).js`) returned `37D8832A-…` main 1728×1117 pts, matching the Swift result. Mirrored-display behaviour not re-tested.

## F5 — Screenshots (panel preview) — MEASURED
| Source | 320 px jpg | 1280 px jpg |
|---|---|---|
| Program scene `Desktop + Webcam` | 6 ms, 2 KB | 12 ms, 17 KB |
| `Webcam Full` (not in program) | 2 ms, 8 KB | 13 ms, 53 KB |
| inactive `screen_capture` | error 702 `Failed to render screenshot` | same |
- Preview = program-scene screenshot at 1–2 fps: cheap. Inactive screen sources cannot be previewed (702 is not an error state to surface as failure).
- PNG keeps alpha; transparent regions look white in viewers. Use jpg for preview, or compute luma on RGB.

## F6 — Scene collections and idempotency — MEASURED
- `CreateSceneCollection` **creates and switches** (174 ms). The switch is visible in the user's OBS window. `SetCurrentSceneCollection` back: 473 ms.
- **`RemoveSceneCollection` does not exist** (also no `RemoveSceneCollection` in 151 requests). Collections created via API can only be deleted from the OBS UI or from disk while OBS is stopped. This supports the decision to write presets into the current collection.
- `CreateInput` with an existing name → error **601** `A source already exists by that input name` → idempotency-by-name is trivial.
- `CreateProfile` / `RemoveProfile` exist.

## F7 — Audio routing for later slices — MEASURED
- `InputVolumeMeters` (high-volume subscription): **~17 events/s**, per-input per-channel levels (`Desktop Audio`, `Mic/Aux`). Usable for a live "me vs them" level signal.
- All audio inputs default to tracks **1–6 all on**. Recording profile: `Output.Mode = Simple`, `AdvOut.RecTracks = 1`, format `mkv`. A multi-track meeting preset must set per-input tracks (`SetInputAudioTracks`) **and** switch the profile to Advanced output (`SetProfileParameter`, not yet tested).
- DOCUMENTED: plain RTMP stream = 1 audio track; OBS 30.2+ Enhanced RTMP multitrack and SRT via Custom FFmpeg output carry several tracks. Live per-track tap → later `stt-engine` spike.

## F8 — Install / platform — DOCUMENTED
- macOS: OBS refuses to install the virtual camera unless the app is in `/Applications` (OBS error text: "OBS cannot install the virtual camera if it's not in /Applications"). macOS 13+: user must Allow the system extension (macOS 15+: Login Items & Extensions → Camera Extensions). Confirms: macOS install target = `/Applications` (brew cask), never `~/.pi/dashboard`.
- Windows portable: unzip outside Program Files; `bin/64bit/obs64.exe --portable` or a `portable_mode(.txt)` file at root. Community launchers start it with `start /D <root>\bin\64bit` → working directory `bin/64bit`. **Not measured** (no Windows host) → the `managed-services` `lifecycle` cwd delta stays conditional; a Windows check is a task, not a design assumption.

## F9 — Camera / audio device enumeration — MEASURED
- `GetInputPropertiesListPropertyItems` on `av_capture_input_v2` (`device`) and `coreaudio_*` (`device_id`): 2–3 ms, no hang. Lists cameras (`MacBook Pro Camera`, `Desk View`, **`OBS Virtual Camera`**) and audio devices (`default`, `BlackHole 2ch`, built-in mic, `Microsoft Teams Audio` loopback, …).
- The crash rule is specific to `screen_capture` (OBS-Transcribe gotcha; not re-tested). Device enumeration needs one existing input of the kind (or a temporary one).
- **`OBS Virtual Camera` appears as a camera device** → binding it into a scene feeds the output back into itself. Presets and `input bind` must refuse it.

## Residue left on the host
- OBS running (pid at end of spike), collection `Untitled`, unchanged.
- Collection `pi-spike` remains: `basic/scenes/pispike.json{,.bak}`. Remove via OBS UI (Scene Collection → Remove) or delete the files while OBS is stopped.
- Sentinel backups in `/tmp/obs-spike/sentinel-backup/` (inert).
- 3 crash reports `OBS-2026-10-15-18{1810,1943,2330}.ips` (diagnostic only).
- Not changed: the stale `display_uuid` on the user's own `Desktop *` sources.

## Proposal / design consequences
1. Start = `pi-obs launch` wrapper (sentinel clear, bounded) + `process.name: "OBS"` adoption; health `ws-first-message`.
2. Stop = explicit-only, warned; no idle-stop; expect `blocked` → recovery path.
3. `pi-obs doctor` reads the latest OBS log: permission lines, `Invalid target display ID`, `Crash or unclean shutdown detected`, plugin load lines.
4. `devices list` displays via CoreGraphics UUID; deny-list keeps `GetInputPropertiesListPropertyItems` on `screen_capture`.
5. Presets idempotent via error 601; no collection create/remove in normal flows.
6. Panel preview: program scene jpg, ≤2 fps.
