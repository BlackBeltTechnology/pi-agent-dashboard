---
name: obs-studio
description: Set up, provision and drive OBS Studio from a pi session — detect or install OBS, enable obs-websocket with a stored secret, register it as a managed service, switch scenes, bind cameras and displays, virtual camera, recording, stream target, subtitles text, AI background removal, screenshots, diagnose blank sources and crashes. Use on "set up OBS", "switch OBS scene", "turn on the virtual camera", "start recording in OBS", "my OBS source is blank", "OBS safe mode / crash loop", "add the webcam to OBS", "OBS remote control", "provision OBS".
---

# OBS Studio (`pi-obs`)

`pi-obs` is the CLI of this plugin. OBS is a managed service (`obs` for the local one,
`obs-<host>` for remote ones). The obs-websocket password lives only in the managed-services
secret store — you never see, print or pass it.

## Rules (read first)

1. **`ask_user` before every host-changing step**: `install`, `provision` (incl. `--update`,
   config rotation, secret import), `stop`, and before ANY use of `--yes`. Say exactly what will
   run. `--yes` skips only the CLI's own prompt; the user's consent comes from you asking first.
2. **Offline verbs run directly** (no secret, work while OBS is down or `blocked`):
   `pi-obs doctor`, `install`, `provision`, `launch`, `stop`, `preset list`.
3. **Live verbs run through `service exec`** — always pass the id explicitly:

   ```bash
   pi-dashboard service ensure obs --json          # starts OBS if needed; state must be healthy
   pi-dashboard service exec obs -- pi-obs <verb> --service obs
   ```

   Never put a password on a command line (`--password` is refused). Never read
   `~/.pi/dashboard/services-secrets.json`.
4. **Prefer verbs over `call`.** `call <Request>` is the escape hatch; its JSON comes from stdin or
   `--json-file`, never argv. Removals, scene-collection/profile changes and stream settings are
   denied through `call` by design.
5. **Blank source or unhealthy service → `pi-obs doctor` first**, before any permission advice.
   A black frame alone is not a permission problem (a stale display id looks identical).
6. **After the virtual camera is first activated**, tell the user to fully quit and reopen apps
   that list cameras (Meet, Zoom, Teams) — they cache the camera list at launch.

## Flows

**First setup** — `doctor` → (not installed? `ask_user`, then `install`) → `ask_user`, then
`provision` → `pi-dashboard service start obs` → `pi-dashboard service exec obs -- pi-obs doctor --live --service obs`.

**Remote OBS** — password on stdin only:
`printf '%s' "$PW" | pi-obs provision --remote ws://host:4455 --service obs-studio2` (warn the user it is
plain `ws://`, LAN or tunnel only).

**Scenes** — `scene list|switch <name>|create <name>`, `preset apply webcam|desktop|desktop-webcam-pip|pip-bgremoval|subtitles`
(idempotent by name; never changes existing inputs; reports `created|existing|incomplete|skipped|plugin-missing`).

**Devices** — `devices list --kind camera|audio|display`, `input bind <input> --device <id>|--display <uuid>`.
The OBS Virtual Camera is excluded and refused (feedback loop). Displays are macOS-only.

**Outputs** — `vcam on|off`, `record on|off`, `stream target <url> --key-stdin` (key on stdin).

**Text / filters / pixels** — `text set <input> <text>`, `filter add <input> bgremoval`,
`screenshot <source> --out file.jpg`.

## Diagnose

| Symptom | Do |
|---|---|
| service `blocked` | OBS shows its safe-mode prompt on the host. Run `pi-obs doctor` (works without a secret); the user answers the prompt. |
| `recovery-suspended` | Two early crashes in a row. After the user answered the prompt: `pi-obs launch --reset-recovery`. |
| `auth-failed` | Stored password rejected → `ask_user`, then `pi-obs provision --update`. |
| blank screen capture | `doctor` → `stale-display-binding` → `devices list --kind display` → `input bind <input> --display <uuid>`. |
| `unsupported-request` | The connected OBS lacks that request; do not retry with `call`. |

`pi-obs stop` crashes OBS 32 during teardown (measured 3/3). It warns and asks; the next
`service start` recovers automatically. Never offer it as routine.

References: `references/install.md`, `references/gotchas.md`, `references/presets.md`,
`references/permissions.md`.
