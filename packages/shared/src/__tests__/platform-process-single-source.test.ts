/**
 * The four Windows/WSL identity helpers are exported from the single-source
 * process-termination module, `platform/process.ts`, and re-exported by the
 * platform barrel. Test-plan row E48. See change: add-windows-process-identity.
 */
import { describe, expect, it } from "vitest";
import * as barrel from "../platform/index.js";
import * as processModule from "../platform/process.js";

describe("single-source process module (E48)", () => {
  it.each(["probeProcessStart", "verifyAndKillWindows", "wslLiveness", "verifyAndKillWsl"] as const)(
    "%s is exported from platform/process.ts and the platform barrel",
    (name) => {
      expect(typeof processModule[name]).toBe("function");
      expect(barrel[name]).toBe(processModule[name]);
    },
  );
});
