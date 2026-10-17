# @blackbelt-technology/pi-dashboard-obs-studio-plugin

OBS Studio as a first-class pi-dashboard capability: detect or install OBS,
enable obs-websocket with a stored secret, register it as a managed service,
drive it from agents through the `pi-obs` CLI and the `obs-studio` skill, and
from the dashboard through a scene / virtual-camera / record panel.

## What you get

- **`pi-obs` CLI** (bin of this package)
  - offline: `doctor`, `install`, `provision`, `launch`, `stop`, `preset list`
  - live (through `pi-dashboard service exec <id> -- pi-obs <verb> --service <id>`):
    `status`, `scene list|switch|create`, `devices list`, `input bind`, `vcam on|off`,
    `record on|off`, `stream target <url> --key-stdin`, `text set`, `filter add <input> bgremoval`,
    `screenshot <source> --out <file>`, `preset apply <name>`, `call <Request>` (JSON on stdin or `--json-file`)
- **Managed service**: one local `attached` OBS per host (`ws-first-message` health,
  process-name adoption, start via `pi-obs launch`, no managed stop, never idle-stopped)
  plus any number of remote `external` OBS instances.
- **Dashboard**: Settings → OBS Studio status card, and the OBS panel at `/obs/`
  (standalone at `/apps/obs/`).
- **Skill** `obs-studio` with references (install, gotchas, presets, permissions).

## Quick start

```bash
pi-obs doctor                       # what is installed, websocket state, log diagnostics
pi-obs provision                    # registers service `obs` (review + confirm), enables obs-websocket
pi-dashboard service start obs      # starts OBS minimized (recovers from an unclean exit)
pi-dashboard service exec obs -- pi-obs status --service obs
pi-dashboard service exec obs -- pi-obs preset apply desktop-webcam-pip --service obs
```

Remote OBS (password on stdin, never argv):

```bash
printf '%s' "$PW" | pi-obs provision --remote ws://10.0.0.5:4455 --service obs-studio2
```

## Security notes

- The obs-websocket password lives only in the managed-services secret store
  (`store:<id>/password`), OBS's own config and `pi-obs` child envs. It is never
  printed, logged, put on argv, returned by a route, or injected into OBS.
- obs-websocket always listens on all interfaces (`*:4455`); `doctor` reports
  `exposure: all-interfaces`. Block the port for other hosts in your firewall.
- Remote OBS uses plain `ws://`: LAN or tunnel only. Stream keys are refused
  over non-loopback `ws://` unless `--allow-insecure-remote`.
- Panel screenshots and controls need operate authority (the same rule as
  `/api/services` mutations); status reads never start OBS.

## Known OBS 32 behaviour

- An external quit crashes OBS 32.2.2 during teardown (3/3 in the spike), so
  there is no managed stop; `pi-obs stop` warns and asks. The next start clears
  the leftover sentinel unless OBS crashed early twice in a row (then OBS shows
  its safe-mode prompt and recovery stays suspended until
  `pi-obs launch --reset-recovery`).
- A blank capture source is usually a stale display binding, not a missing
  permission: run `pi-obs doctor` first.

Design: `openspec/changes/add-obs-studio-plugin/` · Docs: `docs/obs-studio.md`.
