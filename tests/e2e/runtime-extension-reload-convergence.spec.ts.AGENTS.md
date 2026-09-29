# runtime-extension-reload-convergence.spec.ts — index

F5: two independent pi sessions (own process groups); re-point settings to `extension-b`, restart server with Electron runtime env, B SIGSTOPped until A converges; each exactly one `/reload` (server.log `[runtime-overlay]`). Restores default server. See change: electron-runtime-overlay-updates.
