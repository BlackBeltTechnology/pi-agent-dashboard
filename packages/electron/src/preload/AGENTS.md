# DOX — packages/electron/src/preload

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `connecting-preload.ts` | Exposes `window.connecting` (`ready`/`onState`/`sendRequest`/`stopWaiting`/`pairAgain`/`close`) for bundled `connecting.html` via `servers:*` channels. Side-effect imported from `preload.ts`. See change: add-electron-server-windows. |
| `doctor-preload.ts` | Implements `DoctorBridge` via `contextBridge.exposeInMainWorld("electron", { doctor: … })`. |
| `remote-connect-preload.ts` | Exposes `window.remoteConnect` (`getState`/`probe`/`connect`/`useLocal`/`forget`/`close`) for `remote-connect.html`. Side-effect imported from `preload.ts`. See change: auto-launch-first-run-skip-welcome. Adds `listServers`/`onServersChanged`/`openServer`/`connectServer`/`openInWindow`/`forgetServer`/`pairAgain` (main `servers:*`). See change: add-electron-server-windows. |
