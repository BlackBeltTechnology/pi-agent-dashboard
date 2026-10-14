/**
 * Preload for the TRUSTED local wizard windows (doctor, remote-connect), which
 * load `file://` content only. Exposes the wizard bridges. The main window —
 * which in remote mode loads untrusted remote content — uses `preload-main.ts`
 * instead and must never get these bridges.
 * See change: harden-electron-renderer-boundary (VD5).
 */
// Register the doctor bridge namespace (`window.electron.doctor`).
// Side-effect import — `doctor-preload.ts` calls contextBridge.exposeInMainWorld.
// See change: doctor-rich-output.
import "./preload/doctor-preload.js";
// Register the remote-connect bridge namespace (window.remoteConnect).
// See change: auto-launch-first-run-skip-welcome.
import "./preload/remote-connect-preload.js";
