/**
 * Gate for the real-runtime ("L1-real") suites (design D9): they boot the real Blender WebAssembly
 * runtime, so they run only when `BLENDER_WASM_E2E=1` AND the host Node exposes JSPI (probe result is
 * not `unavailable`); otherwise they skip with the reason. They share one fixed test cache outside the
 * per-file temp HOME, so the 66 MB tarball downloads once per machine.
 *
 * See change: add-blender-wasm-mcp (task 3.1, design D9).
 */
import * as os from "node:os";
import * as path from "node:path";
import { describe } from "vitest";
import { probeJspi } from "../../host/probe.js";

/** Fixed per-machine runtime cache for the real-runtime suites. */
export const TEST_CACHE = path.join(os.tmpdir(), "pi-blender-wasm-test-cache");
/** Per-test timeout for suites that boot the runtime (a cold first call can include the download). */
export const REAL_TIMEOUT_MS = 300_000;

export interface RealGate {
  enabled: boolean;
  reason?: string;
}

export function classifyGate(env: NodeJS.ProcessEnv, jspi: "native" | "flag" | "unavailable"): RealGate {
  if (env.BLENDER_WASM_E2E !== "1") return { enabled: false, reason: "BLENDER_WASM_E2E=1 is not set" };
  if (jspi === "unavailable") return { enabled: false, reason: `this Node (${process.version}) has no WebAssembly JSPI; Node 24 or newer is required` };
  return { enabled: true };
}

async function computeGate(): Promise<RealGate> {
  if (process.env.BLENDER_WASM_E2E !== "1") return classifyGate(process.env, "unavailable");
  const probe = await probeJspi();
  return classifyGate(process.env, probe.mode);
}

export const realGate: RealGate = await computeGate();

/** `describe` that runs only when the real runtime is usable; otherwise a skipped suite naming the reason. */
export function describeReal(name: string, fn: () => void): void {
  if (realGate.enabled) describe(name, { timeout: REAL_TIMEOUT_MS }, fn);
  else describe.skip(`${name} [skipped: ${realGate.reason}]`, fn);
}
