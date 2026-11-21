# DOX — packages/video-transcription/bin

npm `bin` launchers. One row per file.

| File | Purpose |
|------|---------|
| `pi-transcribe.mjs` | `pi-transcribe` launcher. Resolves `tsx/package.json` → `dist/cli.mjs`, spawns `node <tsx> src/bin/transcribe.ts …args`; stdio inherit, exit code + SIGINT/SIGTERM pass through. tsx missing → install hint, exit 1. Replaces raw-TS bin (bare node: ERR_MODULE_NOT_FOUND on `.js` specifiers). |
| `pi-voiceid.mjs` | `pi-voiceid` launcher. Same shape, entry `src/bin/voiceid.ts`. |
