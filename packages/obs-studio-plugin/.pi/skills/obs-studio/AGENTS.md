# DOX — packages/obs-studio-plugin/.pi/skills/obs-studio

| File | Purpose |
|------|---------|
| `SKILL.md` | Agent rules: `ask_user` before install/provision/rotation/stop/`--yes`; offline verbs direct; live verbs via `service exec`; doctor-first for blank sources; vcam restart notice; stop outputs before OBS exits (live `stop`); verify output state live, not from log. |
| `references/gotchas.md` | Spike F1–F9 gotchas (no managed stop, active output blocks quit, `--startvirtualcam` not proof, sentinel, exposure, screen_capture crash, stale display, vcam feedback). |
| `references/install.md` | Per-OS install, arch check, websocket enablement, bgremoval plugin. |
| `references/permissions.md` | macOS permissions from the OBS log. |
| `references/presets.md` | Preset table + item statuses. |
