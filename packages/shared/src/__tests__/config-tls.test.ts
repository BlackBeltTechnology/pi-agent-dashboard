import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureConfig, loadConfig, parseTlsConfig } from "../config.js";

/**
 * `tls` config block loader (task 1.2; test-plan #E1 loader half).
 * See change: add-tailscale-cert-tls.
 */

let dir: string;
let origHome: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-cfg-tls-"));
  origHome = process.env.HOME!;
  process.env.HOME = dir;
});

afterEach(() => {
  process.env.HOME = origHome;
  fs.rmSync(dir, { recursive: true, force: true });
});

function write(value: unknown): void {
  fs.mkdirSync(path.join(dir, ".pi", "dashboard"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".pi", "dashboard", "config.json"), JSON.stringify(value));
}

describe("tls config loader", () => {
  it("absent block → disabled, port 8443, loopback host, no sources", () => {
    write({});
    expect(loadConfig().tls).toEqual({ enabled: false, port: 8443, host: "127.0.0.1", sources: [], acceptBridges: false });
  });

  it("no config.json → same defaults", () => {
    expect(loadConfig().tls).toEqual({ enabled: false, port: 8443, host: "127.0.0.1", sources: [], acceptBridges: false });
  });

  it("host is independent of bindHost", () => {
    write({ bindHost: "0.0.0.0", tls: { enabled: true } });
    const cfg = loadConfig();
    expect(cfg.tls.host).toBe("127.0.0.1");
    expect(cfg.tls.enabled).toBe(true);
  });

  it("keeps a valid block verbatim", () => {
    write({ tls: { enabled: true, port: 9443, host: "100.83.0.1", sources: [{ type: "tailscale" }] } });
    expect(loadConfig().tls).toEqual({
      enabled: true,
      port: 9443,
      host: "100.83.0.1",
      sources: [{ type: "tailscale" }],
      acceptBridges: false,
    });
  });

  it("ensureConfig does not seed tls", () => {
    ensureConfig();
    const raw = JSON.parse(fs.readFileSync(path.join(dir, ".pi", "dashboard", "config.json"), "utf-8"));
    expect(raw.tls).toBeUndefined();
  });
});

describe("parseTlsConfig tolerance", () => {
  it("falls back per field on garbage", () => {
    expect(parseTlsConfig({ enabled: "yes", port: 0, host: 5, sources: "x" })).toEqual({
      enabled: false,
      port: 8443,
      host: "127.0.0.1",
      sources: [],
      acceptBridges: false,
    });
  });

  it("acceptBridges is true only for the literal boolean true (a trust switch is never coerced)", () => {
    expect(parseTlsConfig({ acceptBridges: true }).acceptBridges).toBe(true);
    for (const v of ["true", 1, "yes", null, undefined]) expect(parseTlsConfig({ acceptBridges: v }).acceptBridges).toBe(false);
  });

  it("drops non-object source entries but keeps unknown-type objects (validated later)", () => {
    expect(parseTlsConfig({ sources: [null, 3, { type: "foo" }] }).sources).toEqual([{ type: "foo" }]);
  });

  it("port bounds", () => {
    expect(parseTlsConfig({ port: 1 }).port).toBe(1);
    expect(parseTlsConfig({ port: 65535 }).port).toBe(65535);
    expect(parseTlsConfig({ port: 65536 }).port).toBe(8443);
  });
});
