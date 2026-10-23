# doctor-window.ts — index

`openDoctorWindow()` factory. BrowserWindow 1000×720. Single-instance focus-reuse. Registers IPC handlers `doctor:run` (concurrency-serialized), `doctor:open-log`, `doctor:open-doctor-log` (returns `{exists:false}` when absent), `doctor:copy`, `doctor:open-managed-dir`. `doctor:run-setup` + "Run setup wizard" button removed with the wizard; reset-to-local now via app-menu "Use Local Dashboard". See change: auto-launch-first-run-skip-welcome. Wires `closed` → null reference.

`sandbox: true`; `guardDoctorWindow`: `setWindowOpenHandler` always denies (http(s) → `shell.openExternal`), `will-navigate` blocked unless same Doctor file URL (hash-only/reload allowed). Mirrors `connecting-window.ts`. See change: harden-media-and-electron-args.
