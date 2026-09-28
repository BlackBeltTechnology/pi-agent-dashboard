# @blackbelt-technology/pi-dashboard-system-one-plugin

pi-dashboard plugin for System-1 decision models, built on
[`@blackbelt-technology/pi-system-one`](../system-one).

## Surfaces

One `settings-section` claim, **Decision models (System 1)**, at
`/settings/plugins/system-one`:

- the global "allow off-machine backends" switch;
- presets and the default backend chain;
- the backend catalog with capability metadata and on-/off-machine badges;
- per-consumer override chains, filtered by each consumer's declared needs;
- per-consumer **Test** against labelled fixtures (accuracy, AUC, latency
  p50/p90, estimated cost) and calibration save (`shadow` / `enforce`);
- write-only API key entry.

Edits go through the dashboard Save Bar; key entry, Start/Stop and calibration
saves apply immediately.

## Server

- `/api/system-one/*` routes (mutations behind the dashboard network guard).
- Managed local Von (`von-sdk`) and Laya (`laya[serve]`) servers on macOS and
  Linux via `uv`: install, start on `127.0.0.1:18400–18499`, health, stop,
  orphan cleanup. Windows: run the engine yourself and add it as an HTTP
  endpoint.

Full reference: [`docs/system-one.md`](https://github.com/BlackBeltTechnology/pi-agent-dashboard/blob/develop/docs/system-one.md).

## License

MIT
