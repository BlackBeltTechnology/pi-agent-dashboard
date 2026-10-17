# Known OBS gotchas

Measured on OBS 32.2.2 / obs-websocket 5.7.4 unless marked *documented*.

- **No managed stop.** Quitting OBS from outside crashed it during teardown 3/3 (CoreAudio / freetype
  races). The service declares no stop and never idle-stops. `pi-obs stop` warns and asks (F2).
- **Sentinel / safe-mode prompt.** A crash leaves `.sentinel/run_*`; the next launch blocks on a safe-mode
  dialog (service `blocked`). `--disable-shutdown-check` was removed in OBS 32. `pi-obs launch` moves stale
  sentinels aside only when no OBS process exists; crashes while quitting never count, two early mid-run
  crashes in a row suspend recovery so a real crash loop still reaches safe mode (F3).
- **obs-websocket binds all interfaces** (`*:4455`, no bind-address setting). `doctor` reports
  `exposure: all-interfaces`; advise a firewall rule (F1).
- **Never enumerate `screen_capture` properties** over websocket — `GetInputPropertiesListPropertyItems` on a
  screen-capture input hangs/crashes OBS (observed on 32.1.2). `pi-obs` refuses it (also when the target
  cannot be resolved). Use `devices list --kind display` (CoreGraphics UUID, accepted as `display_uuid` on
  32.2.2) (F4).
- **Blank capture ≠ missing permission.** The log line `Invalid target display ID` means a stale
  `display_uuid` (new machine / changed displays); the same log says `Permission for screen capture granted`.
  Rebind with `input bind <input> --display <uuid>` (F4).
- **`screen_capture` with empty settings renders nothing** (error 702 on screenshot). Always set the display.
- **New capture inputs have no device** — presets bind the first non-virtual camera and the main display.
- **`OBS Virtual Camera` shows up as a camera device.** Binding it into a scene feeds the output back into
  itself; refused (F9).
- **`CreateSceneCollection` creates and switches**, and there is no `RemoveSceneCollection` — presets write
  into the current collection and never create collections (F6). Name collisions: `CreateInput` → error 601.
- **Screenshots are cheap** (program scene jpg 640 px ≈ 6–12 ms); an inactive `screen_capture` returns 702 —
  not a failure to surface (F5).
- **Plugins load only at startup.** Restart OBS after installing one.
- **Chroma key ≠ background removal.** Chroma key removes one colour; the AI filter removes arbitrary backgrounds.
- **Multi-track recording** (later `stt-engine` work): audio inputs default to tracks 1–6; a meeting preset must
  set per-input tracks *and* switch the profile to Advanced output (F7, not yet tested).
