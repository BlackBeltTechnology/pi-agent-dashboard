import { describe, expect, it, vi } from "vitest";
import {
  type CmdResult,
  type CmdRunner,
  checkFunnelGates,
  deriveEndpoints,
  isBackendRunning,
  parseTailscaleAuthUrl,
  TailscaleProvider,
} from "../tunnel-providers/tailscale.js";

const STATUS = {
  BackendState: "Running",
  Self: { DNSName: "dev-box.tail1234.ts.net.", TailscaleIPs: ["100.101.22.7", "fd7a:1::1"] },
};

/** A runner that dispatches canned results by the first two args. */
function runnerFor(map: Record<string, CmdResult>): CmdRunner {
  return (args) => map[args.slice(0, 2).join(" ")] ?? map[args[0]] ?? { code: 0, stdout: "", stderr: "" };
}

describe("tailscale pure helpers", () => {
  it("parseTailscaleAuthUrl extracts the login URL (4.2)", () => {
    const out = "\nTo authenticate, visit:\n\n\thttps://login.tailscale.com/a/abc123def\n\n";
    expect(parseTailscaleAuthUrl(out)).toBe("https://login.tailscale.com/a/abc123def");
    expect(parseTailscaleAuthUrl("no url here")).toBeNull();
  });

  it("isBackendRunning reflects login state", () => {
    expect(isBackendRunning(STATUS)).toBe(true);
    expect(isBackendRunning({ BackendState: "NeedsLogin" })).toBe(false);
  });

  it("checkFunnelGates blocks on ACL/cert errors (4.3)", () => {
    const blocked: CmdResult = { code: 1, stdout: "", stderr: "Funnel is not enabled: node attribute missing" };
    const gates = checkFunnelGates(STATUS, blocked);
    expect(gates.find((g) => g.name === "funnel-acl")?.ok).toBe(false);
    const ok: CmdResult = { code: 0, stdout: "https://dev-box.tail1234.ts.net (Funnel on)", stderr: "" };
    expect(checkFunnelGates(STATUS, ok).every((g) => g.ok)).toBe(true);
  });

  it("deriveEndpoints emits magicdns + mesh kinds (4.4)", () => {
    const pub = deriveEndpoints(STATUS, {}, 8000, "public");
    expect(pub.map((e) => e.kind).sort()).toEqual(["magicdns", "mesh"]);
    const magic = pub.find((e) => e.kind === "magicdns")!;
    expect(magic).toMatchObject({ url: "https://dev-box.tail1234.ts.net", tls: true });
    const mesh = pub.find((e) => e.kind === "mesh")!;
    expect(mesh).toMatchObject({ url: "http://100.101.22.7:8000", tls: false });
  });

  it("private serve magicdns is no-TLS http unless a cert/443 handler exists", () => {
    const noCert = deriveEndpoints(STATUS, {}, 8000, "private");
    expect(noCert.find((e) => e.kind === "magicdns")).toMatchObject({ tls: false, url: "http://dev-box.tail1234.ts.net:8000" });
    const withCert = deriveEndpoints(STATUS, { Web: { "dev-box.tail1234.ts.net:443": {} } }, 8000, "private");
    expect(withCert.find((e) => e.kind === "magicdns")).toMatchObject({ tls: true, url: "https://dev-box.tail1234.ts.net" });
  });
});

describe("TailscaleProvider daemon lifecycle (4.1)", () => {
  it("is a daemon-kind provider supporting both modes", () => {
    const p = new TailscaleProvider(() => ({ code: 0, stdout: "", stderr: "" }));
    expect(p.kind).toBe("daemon");
    expect(p.supportsMode("public")).toBe(true);
    expect(p.supportsMode("private")).toBe(true);
  });

  it("private connect runs `serve` and derives endpoints from status json", async () => {
    const calls: string[][] = [];
    const run: CmdRunner = (args) => {
      calls.push(args);
      if (args[0] === "status") return { code: 0, stdout: JSON.stringify(STATUS), stderr: "" };
      if (args[0] === "serve" && args[1] === "status") return { code: 0, stdout: "{}", stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    };
    const p = new TailscaleProvider(run);
    const { endpoints } = await p.connect(8000, "private");
    expect(calls.some((c) => c[0] === "serve" && c.includes("localhost:8000"))).toBe(true);
    expect(endpoints.find((e) => e.kind === "mesh")?.url).toBe("http://100.101.22.7:8000");
    expect(p.status().active).toBe(true);
  });

  it("public connect refuses when funnel gates are unmet", async () => {
    const run: CmdRunner = (args) => {
      if (args[0] === "status") return { code: 0, stdout: JSON.stringify(STATUS), stderr: "" };
      if (args[0] === "funnel" && args[1] === "status")
        return { code: 1, stdout: "", stderr: "Funnel is not enabled: node attribute" };
      return { code: 0, stdout: "", stderr: "" };
    };
    const p = new TailscaleProvider(run);
    await expect(p.connect(8000, "public")).rejects.toThrow(/funnel gates/);
  });

  it("disconnect issues an idempotent serve reset", async () => {
    const calls: string[][] = [];
    const p = new TailscaleProvider((args) => { calls.push(args); return { code: 0, stdout: "", stderr: "" }; });
    await p.disconnect(8000);
    expect(calls).toContainEqual(["serve", "reset"]);
  });
});
