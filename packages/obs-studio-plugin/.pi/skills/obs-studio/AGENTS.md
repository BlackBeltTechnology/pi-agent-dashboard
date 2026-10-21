# DOX — packages/obs-studio-plugin/.pi/skills/obs-studio

| File | Purpose |
|------|---------|
| `SKILL.md` | Agent rules: `ask_user` before install/provision/rotation/stop/`--yes`; offline verbs direct; live verbs via `service exec`; doctor-first for blank sources; vcam restart notice; stop outputs before OBS exits (live `stop`); verify output state live, not from log. Screen capture frozen after sleep → `capture refresh` / `wake-hook install`. Diagnose rows: frozen capture, bg not removed (`mac_vision_filter` via `call CreateSourceFilter`), `failed` after crash = safe-mode prompt. |
| `references/gotchas.md` | Spike F1–F9 gotchas (no managed stop, active output blocks quit, `--startvirtualcam` not proof, sentinel, exposure, screen_capture crash, stale display, vcam feedback); screenshot vImage crash (2×), missing bg-removal filter fix, safe-mode `failed` + doctor `safeMode` false positive, `pi-obs` not on PATH, sleep freeze (flip+restore fix), JXA display-list bug. |
| `references/install.md` | Per-OS install, arch check, websocket enablement, bgremoval plugin; macOS `obs-mac-backgroundremoval` → `mac_vision_filter` kind. |
| `references/permissions.md` | macOS permissions from the OBS log. |
| `references/presets.md` | Preset table + item statuses. |
