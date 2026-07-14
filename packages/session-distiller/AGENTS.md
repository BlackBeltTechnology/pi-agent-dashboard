# DOX — packages/session-distiller

Files in this directory. One row per source file.
Published npm package `@blackbelt-technology/pi-dashboard-session-distiller` (public, MIT). Offline miner engine + `distill-session-knowledge` bin. Consumed by the thin skill package `packages/distill-session-knowledge`. See change: extract-distill-session-knowledge-package.

| File | Purpose |
|------|---------|
| `NOTICE` | Copyright + MIT notice. All source original; no third-party bundled. Shipped via `files[]`. |
| `README.md` | Public npm readme. CLI + library usage, five signal classes, privacy note (state → `~/.pi/agent/distill-session-knowledge/`, dry-run default). |
| `package.json` | Public (`private` removed): `publishConfig.access=public`, MIT, `repository.directory`, `keywords`, `files[]` (src/ bin/ README NOTICE). `bin: distill-session-knowledge → bin/distill.mjs`. |
| `vitest.config.ts` | Vitest project config. node env, forks pool. Registered in root `vitest.config.ts` `test.projects`. |
