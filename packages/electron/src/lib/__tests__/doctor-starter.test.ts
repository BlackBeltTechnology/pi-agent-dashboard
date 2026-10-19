/**
 * Doctor "Server starter" row reads the published `launchSource`, not the
 * removed `starter` field. See change: fix-cli-control-electron-server
 * (test-plan #E11, design D6).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { probeServer, serverStarterCheck } from "../doctor.js";

function stubHealth(body: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ ok: true, pid: 1, ...body }), { status: 200 })),
  );
}

describe("Doctor server starter row", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("launchSource standalone → ok / Standalone", async () => {
    stubHealth({ launchSource: "standalone" });
    const check = serverStarterCheck(await probeServer());
    expect(check).toMatchObject({ name: "Server starter", status: "ok", message: "Standalone" });
  });

  it("neither field → warning / Unknown (old server?)", async () => {
    stubHealth({});
    const check = serverStarterCheck(await probeServer());
    expect(check).toMatchObject({ status: "warning", message: "Unknown (old server?)" });
  });

  it("legacy starter-only server still resolves", async () => {
    stubHealth({ starter: "Electron" });
    const check = serverStarterCheck(await probeServer());
    expect(check).toMatchObject({ status: "ok", message: "Electron" });
  });
});
