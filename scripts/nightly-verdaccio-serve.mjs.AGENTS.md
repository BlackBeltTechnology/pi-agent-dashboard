# nightly-verdaccio-serve.mjs — index

Start an ephemeral Verdaccio as a detached background service (spawn detached+unref+stdio:ignore — cross-OS, no shell backgrounding) using `.github/verdaccio/config.yml`, poll `/-/ping` until healthy (90s timeout) then exit leaving it running for the rest of the job. Windows-safe (node-native). See change: add-nightly-verdaccio-build.

`VERDACCIO_CONFIG` env overrides the config path (runtime E2E fixture's throwaway storage). See change: electron-runtime-release-pipeline.
