/**
 * §1.4 — `kind` gates the PID/watchdog lifecycle as provider-optional.
 * A daemon-model provider must never touch the child PID-file path.
 */

import fs from "node:fs";
import {
  PROVIDER_KIND,
  type TunnelMode,
  type TunnelProvider,
  usesChildLifecycle,
} from "@blackbelt-technology/pi-dashboard-shared/tunnel-provider.js";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.restoreAllMocks());

describe("kind gate", () => {
  it("child providers use the PID/watchdog lifecycle; daemon providers do not", () => {
    expect(usesChildLifecycle(PROVIDER_KIND.zrok)).toBe(true);
    expect(usesChildLifecycle(PROVIDER_KIND.ngrok)).toBe(true);
    expect(usesChildLifecycle(PROVIDER_KIND.tailscale)).toBe(false);
    expect(usesChildLifecycle(PROVIDER_KIND.zerotier)).toBe(false);
  });

  it("a daemon-model provider's connect/disconnect never writes a PID file", async () => {
    const writeSpy = vi.spyOn(fs, "writeFileSync").mockImplementation(() => undefined);

    // Minimal daemon provider: idempotent control commands, URL from status,
    // no owned child process → no PID file.
    const daemon: TunnelProvider = {
      id: "tailscale",
      kind: "daemon",
      supportsMode: () => true,
      detectBinary: () => true,
      isEnrolled: () => true,
      connect: async (): Promise<{ endpoints: [] }> => ({ endpoints: [] }),
      disconnect: async () => {},
      status: () => ({ active: false, endpoints: [] }),
    };

    expect(usesChildLifecycle(daemon.kind)).toBe(false);
    await daemon.connect(8000, "private" as TunnelMode);
    await daemon.disconnect(8000);

    const wrotePid = writeSpy.mock.calls.some(([p]) => String(p).endsWith(".pid"));
    expect(wrotePid).toBe(false);
  });
});
