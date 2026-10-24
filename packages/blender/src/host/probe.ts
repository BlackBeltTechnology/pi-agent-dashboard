/**
 * JSPI probe (design D2): run the host entry with `--probe`, first without and then with
 * `--experimental-wasm-jspi`. Exit 9 / `bad option` (an unknown V8 flag) means `unavailable`.
 * The probe never touches the network or the runtime.
 *
 * See change: add-blender-wasm-mcp (design D2, task 3.1).
 */
import { execFileAsync } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import type { JspiMode } from "../report.js";
import { hostArgv, JSPI_FLAG } from "./entry.js";

export interface SpawnResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export type ProbeSpawn = (flags: readonly string[]) => Promise<SpawnResult>;

export interface ProbeResult {
  mode: JspiMode;
  /** `process.version` of the host Node. */
  node: string;
}

const PROBE_TIMEOUT_MS = 30_000;

/** Default spawn: `node [flags] <host entry> --probe`. */
export const spawnProbe: ProbeSpawn = async (flags) => {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, hostArgv(flags, ["--probe"]), {
      timeout: PROBE_TIMEOUT_MS,
      encoding: "utf8",
    });
    return { code: 0, stdout: String(stdout), stderr: String(stderr) };
  } catch (e) {
    const err = e as { code?: unknown; stdout?: unknown; stderr?: unknown };
    return {
      code: typeof err.code === "number" ? err.code : null,
      stdout: String(err.stdout ?? ""),
      stderr: String(err.stderr ?? ""),
    };
  }
};

function reportsJspi(r: SpawnResult): boolean {
  if (r.code !== 0) return false;
  for (const line of r.stdout.split("\n").reverse()) {
    try {
      const v: unknown = JSON.parse(line);
      if (v !== null && typeof v === "object" && (v as { jspi?: unknown }).jspi === true) return true;
    } catch {
      /* not the JSON line */
    }
  }
  return false;
}

/** Classify JSPI support: `native` (no flag needed), `flag` (needs `--experimental-wasm-jspi`) or `unavailable`. */
export async function probeJspi(spawn: ProbeSpawn = spawnProbe, node: string = process.version): Promise<ProbeResult> {
  if (reportsJspi(await spawn([]))) return { mode: "native", node };
  if (reportsJspi(await spawn([JSPI_FLAG]))) return { mode: "flag", node };
  return { mode: "unavailable", node };
}
