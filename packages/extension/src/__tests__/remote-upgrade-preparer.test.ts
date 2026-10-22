/**
 * The bridge's mint preparer: resolves the HTTP origin, mints, fails closed,
 * and logs the origin once per change without ever logging the bearer.
 *
 * See change: fix-remote-bridge-ticket-origin (D2, D4).
 */
import { describe, expect, it, vi } from "vitest";
import { gateRemoteRegistration } from "../remote-registration-gate.js";
import { createRemoteUpgradePreparer } from "../remote-upgrade-preparer.js";

function rig(env: Record<string, string | undefined>, fetchImpl?: typeof fetch) {
  const out: string[] = [];
  const recorded: string[] = [];
  const fetchSpy = vi.fn(
    fetchImpl ??
      ((async () => ({ ok: true, status: 200, json: async () => ({ data: { ticket: "tkt" } }) })) as unknown as typeof fetch),
  );
  const prepare = createRemoteUpgradePreparer({
    env,
    fetchImpl: fetchSpy as unknown as typeof fetch,
    log: { log: (...a: unknown[]) => out.push(a.join(" ")), error: (...a: unknown[]) => out.push(a.join(" ")) },
    record: (d) => recorded.push(d.detail),
  });
  return { prepare, out, recorded, fetchSpy };
}

describe("createRemoteUpgradePreparer", () => {
  it("mints from the HTTP origin, not the gateway port", async () => {
    const { prepare, fetchSpy } = rig({ PI_DASHBOARD_TOKEN: "t" });
    const res = await prepare("ws://dash.example:9999");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe("http://dash.example:8000/api/ws-ticket");
    expect(res).toEqual({ url: "ws://dash.example:9999?ticket=tkt" });
  });

  it("#X7 fails closed on a bad override without a round trip", async () => {
    const { prepare, out, fetchSpy } = rig({ PI_DASHBOARD_TOKEN: "t", PI_DASHBOARD_HTTP_URL: "ftp://x" });
    await expect(prepare("ws://dash.example:9999")).rejects.toThrow();
    expect(out.some((l) => l.startsWith("[dashboard] bridge ticket bad-http-url:"))).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("#X8 logs the origin on change only, and never the bearer", async () => {
    const { prepare, out, recorded } = rig({ PI_DASHBOARD_TOKEN: "secret-bearer-123" });
    for (let i = 0; i < 3; i++) await prepare("ws://a.example:9999");
    await prepare("ws://b.example:9999");
    const lines = out.filter((l) => l.includes("http origin"));
    expect(lines).toEqual([
      "[dashboard] http origin http://a.example:8000 (endpoint-host+http-port)",
      "[dashboard] http origin http://b.example:8000 (endpoint-host+http-port)",
    ]);
    expect(recorded).toEqual([
      "http origin http://a.example:8000 (endpoint-host+http-port)",
      "http origin http://b.example:8000 (endpoint-host+http-port)",
    ]);
    expect([...out, ...recorded].join("\n")).not.toContain("secret-bearer-123");
  });

  it("noteOrigin shares the dedupe with the mint path", async () => {
    const { prepare, out } = rig({ PI_DASHBOARD_TOKEN: "t" });
    prepare.noteOrigin("ws://a.example:9999");
    await prepare("ws://a.example:9999");
    expect(out.filter((l) => l.includes("http origin"))).toHaveLength(1);
  });

  it("#X9 a local bridge is unaffected by a bad override", async () => {
    const env = { PI_DASHBOARD_HTTP_URL: "not a url" };
    const { prepare, out, fetchSpy } = rig(env);
    await expect(prepare("ws://127.0.0.1:9999")).resolves.toBeUndefined();
    await expect(prepare("ws+unix:/tmp/gw.sock")).resolves.toBeUndefined();
    const challenge = vi.fn();
    for (const endpoint of ["ws://127.0.0.1:9999", "ws+unix:/tmp/gw.sock"]) {
      const gate = await gateRemoteRegistration({ endpoint, store: { servers: [] }, env, challenge });
      expect(gate).toMatchObject({ allow: true, cause: "local" });
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(challenge).not.toHaveBeenCalled();
    expect(out.join("\n")).not.toContain("bad-http-url");
  });
});
