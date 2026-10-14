/**
 * Doctor preload bridge. Exposes `window.electron.doctor` to the
 * `doctor.html` renderer with the typed channel set declared in
 * `doctor-bridge-contract.ts`.
 *
 * This file is imported once from `packages/electron/src/preload.ts` — the
 * WIZARD preload bundle (doctor + remote-connect windows, trusted `file://`
 * only). The main window uses `preload-main.ts` and must never carry this
 * bridge (it loads untrusted remote content).
 * See change: harden-electron-renderer-boundary.
 *
 * See change: doctor-rich-output (task 3.2).
 */
import { contextBridge, ipcRenderer } from "electron";
import type { DoctorBridge } from "../lib/doctor-bridge-contract.js";

const doctor: DoctorBridge = {
  run: () => ipcRenderer.invoke("doctor:run"),
  openLog: () => ipcRenderer.invoke("doctor:open-log"),
  openDoctorLog: () => ipcRenderer.invoke("doctor:open-doctor-log"),
  copy: (text: string) => ipcRenderer.invoke("doctor:copy", text),
  openManagedDir: () => ipcRenderer.invoke("doctor:open-managed-dir"),
};

contextBridge.exposeInMainWorld("electron", { doctor });
