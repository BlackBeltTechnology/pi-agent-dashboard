import { describe, expect, it, vi } from "vitest";
import {
  type CmdResult,
  type CmdRunner,
  checkFunnelGates,
  deriveEndpoints,
  isBackendRunning,
  parseServeEnableUrl,
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
    const p = new TailscaleProvider(run, undefined, {
      runServe: async (args) => {
        calls.push(args);
        return { code: 0, stdout: "", stderr: "" };
      },
    });
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

  it("probeLive with no serve config falls back to the dashboard's own port (magicdns + mesh listed)", async () => {
    const runAsync = async (args: string[]) =>
      args[0] === "status"
        ? { code: 0, stdout: JSON.stringify({ ...STATUS, BackendState: "Running" }), stderr: "" }
        : { code: 0, stdout: "{}", stderr: "" };
    const p = new TailscaleProvider(undefined, runAsync, { fallbackPort: () => 8000 });
    const eps = await p.probeLive();
    expect(eps.find((e) => e.kind === "magicdns")?.url).toMatch(/^http:\/\/.+:8000$/);
    expect(eps.find((e) => e.kind === "mesh")?.url).toBe("http://100.101.22.7:8000");
  });

  it("probeLive without any port source still reports the url-less live marker", async () => {
    const runAsync = async (args: string[]) =>
      args[0] === "status"
        ? { code: 0, stdout: JSON.stringify({ ...STATUS, BackendState: "Running" }), stderr: "" }
        : { code: 0, stdout: "{}", stderr: "" };
    const p = new TailscaleProvider(undefined, runAsync);
    expect(await p.probeLive()).toEqual([{ kind: "magicdns", url: "", tls: false }]);
  });

  it("disconnect issues an idempotent serve reset", async () => {
    const calls: string[][] = [];
    const p = new TailscaleProvider((args) => { calls.push(args); return { code: 0, stdout: "", stderr: "" }; });
    await p.disconnect(8000);
    expect(calls).toContainEqual(["serve", "reset"]);
  });
});

describe("Serve/Funnel not enabled on the tailnet", () => {
  const PROMPT = "\nServe is not enabled on your tailnet.\nTo enable, visit:\n\n         https://login.tailscale.com/f/serve?node=nJLFZgVqZA21CNTRL\n\n";

  it("parseServeEnableUrl extracts the admin approval link", () => {
    expect(parseServeEnableUrl(PROMPT)).toBe("https://login.tailscale.com/f/serve?node=nJLFZgVqZA21CNTRL");
    expect(parseServeEnableUrl("Funnel is not enabled on your tailnet.\nTo enable, visit:\n https://login.tailscale.com/f/funnel?node=X"))
      .toBe("https://login.tailscale.com/f/funnel?node=X");
    expect(parseServeEnableUrl("Available within your tailnet: https://box.ts.net/")).toBeNull();
  });

  it("connect runs serve through the bounded async runner and records the approval link", async () => {
    const sync = vi.fn((args: string[]) =>
      args[0] === "status" ? { code: 0, stdout: JSON.stringify(STATUS), stderr: "" } : { code: 0, stdout: "{}", stderr: "" },
    );
    const runServe = vi.fn(async () => ({ code: 1, stdout: PROMPT, stderr: "killed" }));
    const p = new TailscaleProvider(sync, undefined, { runServe });
    const { endpoints } = await p.connect(8000, "private");
    expect(runServe).toHaveBeenCalledWith(["serve", "--bg", "--set-path=/", "localhost:8000"]);
    expect(sync.mock.calls.some(([a]) => a[0] === "serve" && a[1] === "--bg")).toBe(false);
    expect(p.approvalUrl()).toBe("https://login.tailscale.com/f/serve?node=nJLFZgVqZA21CNTRL");
    // Direct MagicDNS/mesh on the dashboard port still works without serve.
    expect(endpoints.find((e) => e.kind === "mesh")?.url).toBe("http://100.101.22.7:8000");
  });

  it("a successful serve clears a previously recorded approval link", async () => {
    const sync = () => ({ code: 0, stdout: JSON.stringify(STATUS), stderr: "" });
    let out = PROMPT;
    const p = new TailscaleProvider(sync, undefined, { runServe: async () => ({ code: 0, stdout: out, stderr: "" }) });
    await p.connect(8000, "private");
    out = "Available within your tailnet:\nhttps://box.ts.net/";
    await p.connect(8000, "private");
    expect(p.approvalUrl()).toBeUndefined();
  });
});
