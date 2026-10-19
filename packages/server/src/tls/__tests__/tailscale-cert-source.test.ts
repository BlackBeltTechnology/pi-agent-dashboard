import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AsyncCmdResult, AsyncCmdRunner } from "../../tunnel-providers/daemon-exec.js";
import { checkFunnelGates, tailnetHttpsEnabled } from "../../tunnel-providers/tailscale.js";
import { CertFiles } from "../cert-files.js";
import { CertManager } from "../cert-manager.js";
import { TlsCertStore } from "../cert-store.js";
import { TailscaleCertSource, tailscaleSourceType } from "../sources/tailscale-cert.js";
import { fixture } from "./helpers.js";

/**
 * Tailscale certificate source against a fake `tailscale` runner
 * (test-plan #E18–#E21, #E33, #E34 (ipv4 detail), #E44, #X8).
 * See change: add-tailscale-cert-tls.
 */

const MIN = 60_000;
const DNS = "host.example.ts.net";

function status(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    BackendState: "Running",
    CertDomains: [DNS],
    Self: { DNSName: `${DNS}.`, TailscaleIPs: ["100.83.0.1", "fd7a::1"], CapMap: { x: [] } },
    ...over,
  });
}

interface Fake {
  run: AsyncCmdRunner;
  calls: string[][];
  statusOut: () => AsyncCmdResult;
  certDelayMs: number;
  certResult: () => AsyncCmdResult;
}

function fake(): Fake {
  const f: Fake = {
    calls: [],
    certDelayMs: 0,
    statusOut: () => ({ code: 0, stdout: status(), stderr: "" }),
    certResult: () => ({ code: 0, stdout: "", stderr: "" }),
    run: async (args) => {
      f.calls.push(args);
      if (args[0] === "status") return f.statusOut();
      if (args[0] === "cert") {
        if (f.certDelayMs) await new Promise((r) => setTimeout(r, f.certDelayMs));
        const res = f.certResult();
        if (res.code === 0) {
          const certFile = args[args.indexOf("--cert-file") + 1] as string;
          const keyFile = args[args.indexOf("--key-file") + 1] as string;
          const fx = fixture("host.example.ts.net");
          fs.writeFileSync(certFile, fx.certPem);
          fs.writeFileSync(keyFile, fx.keyPem, { mode: 0o600 });
        }
        return res;
      }
      return { code: 1, stdout: "", stderr: "unexpected" };
    },
  };
  return f;
}

let dir: string;
let f: Fake;
let src: TailscaleCertSource;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-ts-src-"));
  f = fake();
  src = new TailscaleCertSource({ dataDir: dir, runStatus: f.run, runCert: f.run });
});
afterEach(() => {
  vi.useRealTimers();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("#E18 MagicDNS normalisation", () => {
  it("strips the trailing dot and passes the name to `tailscale cert`", async () => {
    expect(await src.names()).toEqual([DNS]);
    await src.obtain(DNS, () => undefined);
    const cert = f.calls.find((c) => c[0] === "cert") as string[];
    expect(cert[cert.length - 1]).toBe(DNS);
  });

  it("issues into a private temp dir that is removed afterwards and returns advertisable magicdns PEMs", async () => {
    const got = await src.obtain(DNS, () => undefined);
    expect(got).toMatchObject({ advertise: true, kind: "magicdns" });
    expect(got.certPem).toContain("BEGIN CERTIFICATE");
    expect(got.keyPem).toContain("PRIVATE KEY");
    expect(fs.readdirSync(dir)).toEqual([]); // nothing left behind
  });
});

describe("#E19 tailnet HTTPS not enabled", () => {
  it("reports an unmet https-certs gate and the manager never calls `cert`; re-checks every 15 min and on config change", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    vi.setSystemTime(new Date());
    f.statusOut = () => ({ code: 0, stdout: status({ CertDomains: null }), stderr: "" });
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-ts-mgr-"));
    const mgr = new CertManager({
      files: new CertFiles(root),
      store: new TlsCertStore(),
      log: { info: () => undefined, warn: () => undefined },
    });
    await mgr.reconcile([src]);
    await mgr.settle();
    expect(f.calls.some((c) => c[0] === "cert")).toBe(false);
    const gate = mgr.status().gates.find((g) => g.id === "https-certs");
    expect(gate).toMatchObject({ ok: false, sourceId: "tailscale", hint: expect.stringContaining("admin console") });
    expect(mgr.status().certs[0]).toMatchObject({ name: DNS, held: false });
    expect((await new CertFiles(root).readMeta("tailscale", DNS))?.failures ?? 0).toBe(0);

    // HTTPS gets enabled; the 15-minute re-check picks it up (forced read).
    f.statusOut = () => ({ code: 0, stdout: status(), stderr: "" });
    await vi.advanceTimersByTimeAsync(15 * MIN);
    await mgr.settle();
    expect(f.calls.filter((c) => c[0] === "cert")).toHaveLength(1);

    // A config change re-checks immediately.
    f.statusOut = () => ({ code: 0, stdout: status({ CertDomains: [] }), stderr: "" });
    await mgr.reconcile([new TailscaleCertSource({ dataDir: dir, runStatus: f.run, runCert: f.run })]);
    expect(mgr.status().gates.some((g) => g.id === "https-certs" && !g.ok)).toBe(true);
    mgr.suspend();
    fs.rmSync(root, { recursive: true, force: true });
  });
});

/** Real-time wait (setImmediate is not faked) until the runner has been asked for `cert` n times. */
async function untilCertCalls(n: number): Promise<void> {
  for (let i = 0; i < 2000 && f.calls.filter((c) => c[0] === "cert").length < n; i++) {
    await new Promise((r) => setImmediate(r));
  }
}

describe("#E20 slow issuance", () => {
  it("30 s succeeds; 121 s times out at 120 s", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    f.certDelayMs = 30_000;
    const ok = src.obtain(DNS, () => undefined);
    await untilCertCalls(1);
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(ok).resolves.toMatchObject({ kind: "magicdns" });

    f.certDelayMs = 121_000;
    const slow = src.obtain(DNS, () => undefined);
    const assertion = expect(slow).rejects.toThrow(/timed out after 120 s/);
    await untilCertCalls(2);
    await vi.advanceTimersByTimeAsync(120_000);
    await assertion;
    await vi.advanceTimersByTimeAsync(2_000); // let the stale fake runner finish
  });
});

describe("#E21 / #E33 tailscale absent or logged out", () => {
  it("binary missing → unmet tailscale-running gate, names() null, no cert call", async () => {
    f.statusOut = () => ({ code: 127, stdout: "", stderr: "tailscale: not found" });
    const r = await src.readiness({ force: true });
    expect(r.gates).toEqual([expect.objectContaining({ id: "tailscale-running", ok: false, hint: expect.any(String) })]);
    expect(await src.names()).toBeNull();
    expect(f.calls.some((c) => c[0] === "cert")).toBe(false);
  });

  it("NeedsLogin → the same gate", async () => {
    f.statusOut = () => ({ code: 0, stdout: status({ BackendState: "NeedsLogin" }), stderr: "" });
    const r = await src.readiness({ force: true });
    expect(r.gates.map((g) => g.id)).toEqual(["tailscale-running"]);
    expect(await src.names()).toBeNull();
  });
});

describe("source details (#E34 half)", () => {
  it("exposes the first Tailscale IPv4 even before any certificate exists", async () => {
    const r = await src.readiness({ force: true });
    expect(r).toEqual({ gates: [], details: { ipv4: "100.83.0.1" } });
  });

  it("readiness reads are cached (30 s) unless forced", async () => {
    await src.readiness();
    await src.readiness();
    expect(f.calls.filter((c) => c[0] === "status")).toHaveLength(1);
    await src.readiness({ force: true });
    expect(f.calls.filter((c) => c[0] === "status")).toHaveLength(2);
  });
});

describe("#X8 CLI error surfaced", () => {
  it("surfaces stderr in lastError and schedules the next attempt +5 min", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    vi.setSystemTime(new Date());
    f.certResult = () => ({ code: 1, stdout: "", stderr: "cert: version mismatch" });
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-ts-mgr-"));
    const mgr = new CertManager({
      files: new CertFiles(root),
      store: new TlsCertStore(),
      log: { info: () => undefined, warn: () => undefined },
    });
    const t0 = Date.now();
    await mgr.reconcile([src]);
    await mgr.settle();
    const row = mgr.status().certs[0];
    expect(row?.lastError).toContain("version mismatch");
    expect(row?.nextAttemptAt).toBe(t0 + 5 * MIN);
    mgr.suspend();
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe("#E44 tailnetHttpsEnabled + funnel gate", () => {
  const fnl = { code: 0, stdout: "", stderr: "" };
  const gateOk = (json: unknown): boolean | undefined =>
    checkFunnelGates(json, fnl).find((g) => g.name === "https-certs")?.ok;

  it("null / [] → disabled in both surfaces (even with Self.CapMap set)", () => {
    for (const CertDomains of [null, []]) {
      const json = { Self: { CapMap: { a: [] } }, CertDomains };
      expect(tailnetHttpsEnabled(json)).toBe(false);
      expect(gateOk(json)).toBe(false);
    }
  });

  it("non-empty → enabled in both", () => {
    const json = { Self: { CapMap: { a: [] } }, CertDomains: [DNS] };
    expect(tailnetHttpsEnabled(json)).toBe(true);
    expect(gateOk(json)).toBe(true);
  });

  it("key missing (older CLI) → unknown helper result, old heuristic in the funnel gate", () => {
    const json = { Self: { CapMap: { a: [] } } };
    expect(tailnetHttpsEnabled(json)).toBeUndefined();
    expect(gateOk(json)).toBe(true);
  });

  it("the source maps the same verdict to its https-certs gate", async () => {
    f.statusOut = () => ({ code: 0, stdout: status({ CertDomains: [] }), stderr: "" });
    const r = await src.readiness({ force: true });
    expect(r.gates.map((g) => g.id)).toEqual(["https-certs"]);
  });
});

describe("registered type", () => {
  it("is `tailscale` with default id `tailscale` and accepts a bare entry", () => {
    expect(tailscaleSourceType.type).toBe("tailscale");
    expect(tailscaleSourceType.defaultId).toBe("tailscale");
    expect(tailscaleSourceType.validate({ type: "tailscale" })).toBeNull();
  });
});
