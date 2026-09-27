# launch-source-types.ts — index

`LaunchSource` discriminated union for Electron server layout. `SourceKind` = `attach` | `bundled` | `devMonorepo` | `localLink` | `overlay`; variants carry url/starter or cliPath/cwd; `localLink`/`overlay` also carry `runtimeId`. Replaces pre-R3 layouts. See change: electron-runtime-overlay-updates.
