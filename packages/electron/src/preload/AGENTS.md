# DOX — packages/electron/src/preload

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `doctor-preload.ts` | Implements `DoctorBridge` via `contextBridge.exposeInMainWorld("electron", { doctor: … })`. |
| `remote-connect-preload.ts` | Exposes `window.remoteConnect` (`getState`/`probe`/`connect`/`useLocal`/`forget`/`close`) for `remote-connect.html`. Side-effect imported from `preload.ts`. See change: auto-launch-first-run-skip-welcome. |
