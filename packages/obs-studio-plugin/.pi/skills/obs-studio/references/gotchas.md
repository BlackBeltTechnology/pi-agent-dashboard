# Known OBS gotchas

Measured on OBS 32.2.2 / obs-websocket 5.7.4 unless marked *documented*.

- **No managed stop.** Quitting OBS from outside crashed it during teardown 3/3 (CoreAudio / freetype
  races). The service declares no stop and never idle-stops. `pi-obs stop` warns and asks (F2).
- **Active output blocks quit** (observed OBS 31.1.2, macOS). With streaming, recording or the virtual
  camera on, OBS shows an exit-confirm modal; `osascript quit app "OBS"` returns `User cancelled (-128)`
  and OBS keeps running. The modal attaches to the main window, possibly on another display
  or Space where nobody sees it — after that, tray-menu clicks are ignored. `pi-obs stop` stops outputs over
  obs-websocket first (`output-active` if one stays on); without websocket, stop them in OBS by hand.
- **`--startvirtualcam` is not proof** (observed OBS 31.1.2, macOS). The log said `Starting Virtual Camera
  output to Program` while the tray still offered `Start Virtual Camera`. Check `pi-obs status`.
- **Full-canvas `screenshot` may crash OBS** (observed twice, OBS 31.1.2 macOS, 5120×2880 canvas): SIGSEGV in
  `vHorizontal_Shear_ARGB_8888` (vImage) 2 s after a full-resolution scene screenshot; the service relaunched
  OBS with the virtual camera OFF and the default scene. Prefer a small `--width`; re-check `status` after.
  2nd case: scene screenshot right after adding `mac_vision_filter` → `GetSourceScreenshot` timeout → same
  vImage crash. Re-adding the filter WITHOUT a screenshot ran stable with vcam on. Don't blame the filter;
  skip screenshots of filtered camera sources, verify with the user's eyes / `GetSourceFilterList` instead.
  Crash report: `~/Library/Logs/DiagnosticReports/OBS-<date>-<time>.ips` (triggered thread → vImage frames).
- **A crash loses unsaved websocket edits** (observed OBS 31.1.2): after the relaunch the preset's scene and
  inputs existed, but `Webcam Box` had empty settings ("No device selected") and a default transform (top-left,
  native size). After any crash, re-check bindings and transforms (`call GetInputSettings`, a small screenshot);
  re-run `input bind` and restore the transform.
- **`devices list --kind display` can repeat one UUID** (observed with two monitors) — a second display is
  then not bindable by id; verify before `input bind --display`.
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
- **"No greenbox / background still visible" in vcam** (observed OBS 31.1.2 macOS): the preset `Webcam Box`
  had NO filter (preset never touches an existing input). Inspect `call GetSourceFilterList {"sourceName":…}`
  per camera input; other inputs may already carry `macOS Background Removal` (`mac_vision_filter`).
  Fix (ask first): `echo '{"sourceName":"Webcam Box","filterName":"macOS Background Removal",
  "filterKind":"mac_vision_filter","filterSettings":{}}' | … pi-obs call CreateSourceFilter --service obs`.
  `filter add bgremoval` does not work here — it only knows `background_removal` (see install.md).
- **Service `failed: process exited during start` while a safe-mode prompt is pending** (observed OBS 31.1.2):
  after an unclean shutdown the launch waits on the safe-mode dialog. Once the user picks *Launch normally*
  (log: `[Safe Mode] User elected to launch normally.`), `service ensure obs` again → `healthy`.
  `doctor` may still report `safeMode: true` / issue `safe-mode` from the `Unclean shutdown detected` line —
  trust the `User elected…` line and `websocketLoaded`.
- **`pi-obs` not on PATH in a repo checkout** — run `node packages/obs-studio-plugin/bin/pi-obs.mjs <verb>`
  (also inside `pi-dashboard service exec obs -- …`).
- **Multi-track recording** (later `stt-engine` work): audio inputs default to tracks 1–6; a meeting preset must
  set per-input tracks *and* switch the profile to Advanced output (F7, not yet tested).
- **Screen captures freeze after sleep** (observed OBS 31.1.2 macOS, two displays): on sleep every
  `screen_capture` logs `[ mac-screencapture ]: Stream stopped with error 0 ("(null)")` and never restarts; the
  virtual camera keeps sending the last frame. Toggling scene-item visibility or `SetInputSettings` with the
  same/empty settings does NOT restart it. Switching `display_uuid` to another display and back does:
  `pi-obs capture refresh` (restores the original settings exactly, `overlay:false`). `wake-hook install`
  runs it after every wake.
- **`devices list --kind display` reported every display as the main one** (before add-obs-capture-refresh):
  a JXA `Ref()` passed to `CGGetActiveDisplayList` exposes only element 0. Ids now come from `NSScreen`; rows
  carry `x`/`y` (left monitor x = 0) — input names like "Screen Right" may not match the physical side.
