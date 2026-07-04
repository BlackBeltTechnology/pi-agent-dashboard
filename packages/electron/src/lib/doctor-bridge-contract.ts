/**
 * Typed contract for the Doctor IPC bridge. Imported by BOTH the preload
 * (`packages/electron/src/preload/doctor-preload.ts`) AND the renderer
 * entry script in `packages/electron/src/renderer/doctor.html` so a
 * renamed channel breaks the type-check rather than silently breaking
 * a toolbar button.
 *
 * Risk #4 mitigation, channel-name-drift lint enforced by
 * `packages/electron/src/__tests__/doctor-window.test.ts`.
 *
 * See change: doctor-rich-output (task 3.1).
 */
import type { DoctorReport } from "@blackbelt-technology/pi-dashboard-shared/doctor-core.js";

export interface DoctorBridge {
  /** Run all doctor checks and return the full report. Concurrent calls are serialized. */
  run(): Promise<DoctorReport>;
  /** Open ~/.pi-dashboard/server.log in the platform default viewer. */
  openLog(): Promise<{ ok: boolean; path?: string }>;
  /** Open ~/.pi-dashboard/doctor.log; resolves with `{exists:false}` when absent. */
  openDoctorLog(): Promise<{ ok: boolean; exists: boolean; path?: string }>;
  /** Copy text to the system clipboard (used by [Copy as Markdown] / [Copy as Plain]). */
  copy(text: string): Promise<{ ok: boolean }>;
  /** Open ~/.pi-dashboard/ in the OS file manager. */
  openManagedDir(): Promise<{ ok: boolean; path: string }>;
}

/** Frozen list of the IPC channel names. The lint test imports this. */
export const DOCTOR_IPC_CHANNELS = [
  "doctor:run",
  "doctor:open-log",
  "doctor:open-doctor-log",
  "doctor:copy",
  "doctor:open-managed-dir",
] as const;
export type DoctorIpcChannel = (typeof DOCTOR_IPC_CHANNELS)[number];
