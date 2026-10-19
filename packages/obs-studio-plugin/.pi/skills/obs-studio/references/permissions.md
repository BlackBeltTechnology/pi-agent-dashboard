# macOS permissions

OBS needs Screen & System Audio Recording (screen capture), Camera, Microphone, Input Monitoring.
The **latest OBS log** is the authoritative source: `[macOS] Permission for <x> granted|denied`.
`pi-obs doctor` reads it (whole file, or first 64 KiB + last 4 MiB for large logs).

- Denied → System Settings → Privacy & Security → the matching pane → enable OBS → **fully restart OBS**.
- Granted but the source is blank → stale display binding (see `gotchas.md`), not a permission problem.
- Launching through `open -a OBS` keeps OBS the responsible process for the permission prompts; `pi-obs launch`
  uses it on macOS.
- After the virtual camera first activates, fully quit and reopen apps that list cameras (Meet, Zoom, Teams).
