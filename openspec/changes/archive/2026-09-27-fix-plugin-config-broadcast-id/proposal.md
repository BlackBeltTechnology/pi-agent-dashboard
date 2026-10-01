# Plugin `updatePluginConfig` broadcast carries the plugin id

## Why

The spec already requires `plugin_config_update { id, config }` for every
config change, including server-side `updatePluginConfig`. The plugin server
ctx implementation in `server.ts` sent `{ type, config }` only. An `as any`
cast hid the missing required `id`. The client keys `applyPluginConfigUpdate`
on `id`, so the config landed under `"undefined"`. The plugin's settings UI
kept the stale value until a reload. The gap surfaced during the Biome
`noExplicitAny` cleanup (commit aee07c87f), which already fixed the code.

## What Changes

- `server.ts` plugin ctx `updatePluginConfig` broadcast includes `id` (landed
  in aee07c87f).
- Spec: `Reactive plugin config broadcast` gains a scenario naming the
  server-side path, so the REST path is not the only one exercised by the spec.

## Capabilities

### Modified Capabilities

- `dashboard-plugin-loader`: the server-side `updatePluginConfig` broadcast is
  pinned to carry the calling plugin's `id`.

## Impact

- Server only; no protocol change (`PluginConfigUpdateMessage.id` was already
  required). Rollback: revert the commit.

## Discipline Skills

- `review-code`: the defect was found by removing an `as any` and letting
  `tsc` report the mismatch against `ServerToBrowserMessage`.
