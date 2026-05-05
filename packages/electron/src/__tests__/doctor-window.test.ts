/**
 * Channel-name-drift lint for the Doctor IPC bridge (risk #4 hardening).
 *
 * Asserts that every channel name registered in `doctor-window.ts` is
 * present in the `DoctorBridge` contract AND in `doctor-preload.ts`.
 *
 * See change: doctor-rich-output (task 3.10).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DOCTOR_IPC_CHANNELS } from "../lib/doctor-bridge-contract.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function read(rel: string): string {
  return readFileSync(path.resolve(__dirname, "..", rel), "utf-8");
}

describe("Doctor IPC channel names", () => {
  it("every channel in DOCTOR_IPC_CHANNELS is registered with ipcMain.handle in doctor-window.ts", () => {
    const src = read("lib/doctor-window.ts");
    for (const ch of DOCTOR_IPC_CHANNELS) {
      expect(src.includes(`ipcMain.handle("${ch}"`)).toBe(true);
    }
  });

  it("every channel in DOCTOR_IPC_CHANNELS is consumed by ipcRenderer.invoke in doctor-preload.ts", () => {
    const src = read("preload/doctor-preload.ts");
    for (const ch of DOCTOR_IPC_CHANNELS) {
      expect(src.includes(`ipcRenderer.invoke("${ch}"`)).toBe(true);
    }
  });

  it("DoctorBridge interface has one method per channel (1-to-1 surface)", () => {
    // The interface lives in doctor-bridge-contract.ts; we count `\n  <name>(`
    // method declarations and assert N == DOCTOR_IPC_CHANNELS.length.
    const src = read("lib/doctor-bridge-contract.ts");
    // Match lines of the form `<spaces><name>(...): ...`
    const methodMatches = [...src.matchAll(/^\s{2}(\w+)\([^)]*\)\s*:/gm)].map((m) => m[1]);
    expect(methodMatches.length).toBe(DOCTOR_IPC_CHANNELS.length);
  });
});
