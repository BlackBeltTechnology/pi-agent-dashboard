# DOX — packages/obs-studio-plugin/src/core

Pure modules over injected deps (spawn, fs, clock, ws). One row per file. See change: add-obs-studio-plugin.

| File | Purpose |
|------|---------|
| `connection.ts` | `resolveTarget` (`--service`→`SVC_<ID>_PASSWORD`→`OBS_URL`/`OBS_PASSWORD`; many `SVC_*` w/o flag + `--password` = usage). `connectObs` → `ObsConn`; `unreachable`/`auth-failed`/`timeout` (connect 3 s, request 5 s). Logs outcome+type+latency, never password. |
| `dashboard-cli.ts` | `createDashboardCli(env, prefix?)` runs `pi-dashboard` (`service add --file`, `secret set` on stdin, `status`). `inherit` = user terminal. Spawns via `buildSafeArgv`. |
| `detect.ts` | `detectObs` per OS (plist/registry/portable/which/flatpak), version ≥ 28, arch. `launchArgv` (darwin `open -a … --args --minimize-to-tray --disable-updater`). |
| `devices.ts` | Camera/audio discovery (existing input, else temp `pi-obs-probe-<kind>` in scene `pi-obs-probe`; refused while streaming/recording; removed in `finally`). `sweepProbes`. macOS displays via JXA CoreGraphics. Virtual camera excluded + refused by `bindInput`. |
| `doctor.ts` | Offline diagnostics: install, ws config (no secret), exposure, start-argv preflight, recovery state, newest-log scan (permissions, `Invalid target display ID`, unclean/safe mode; >4 MiB = head 64 KiB + tail 4 MiB). |
| `errors.ts` | `ObsError` + `ObsErrorCode`; `exitCodeOf` (usage 2, else 1). |
| `install.ts` | `planInstall`/`describePlan`; `installPortable` (published SHA-256 digest required, safe extract, `portable_mode.txt`). |
| `instances.ts` | `<state>/instances.json` registry (prune-on-read), `writeJsonAtomic`. |
| `launch.ts` | `launch`: stale-sentinel quarantine only when no OBS; strike rule (teardown crash/early crash/late), 60 s young-sentinel ignore, 10 min early window, 2 strikes → `suspended` (only `--reset-recovery` clears; corrupt = suspended), state written before spawn, post-move re-check, keep 10 batches. |
| `paths.ts` | State dir (`~/.pi/dashboard/plugins/obs-studio`), OBS config/log/sentinel dirs per OS, process name. |
| `policy.ts` | Request policy: capability gating, `call` deny-list, secret over non-loopback `ws://`, crash deny (`screen_capture` property enumeration, fail closed). `guard(conn,{via})`. |
| `presets.ts` | `webcam`/`desktop`/`desktop-webcam-pip`/`pip-bgremoval`/`subtitles`. Name-idempotent, per-item status, binds only created inputs. Geometry + subtitle size designed on 1920x1080, scaled by `readCanvas` (`GetVideoSettings` base, k = w/1920; fallback 1920x1080), read lazily only when placing an input. |
| `provision.ts` | `localDefinition`/`remoteDefinition`, `submitDefinition` (refusals, 0600 temp file → `service add --file`, `--update` = remove+add). |
| `serve.ts` | `serve --stdio` NDJSON bridge child. Fixed ops only; id-correlated concurrent; sweep on connect; EOF/60 s idle exit. |
| `service-defs.ts` | Read-only `services.json` view; `envPrefix`, `envNameCollision`. |
| `stop.ts` | `pi-obs stop`: local `attached` only, warn+confirm, stops active outputs first (`stopOutputs` dep; still active → `output-active`, no quit; unreachable ws → warn, still quits; result `outputsStopped`), success = pid exit within 15 s, no force-kill without `--force`. |
| `verbs.ts` | `status`, scenes, `vcam`/`record`, `stopOutputs` (stream/record/vcam stop + poll until inactive), `streamTarget`, `textSet`, bgremoval filter, screenshots. |
| `ws-config.ts` | obs-websocket enablement: consent import, stopped-only write (settle + re-check), 0600 backup (3 kept), verify, `secret set` on stdin, restore on failure. |
| `zip.ts` | Minimal ZIP reader; whole-archive refusal for absolute/`..`/symlink entries. |
