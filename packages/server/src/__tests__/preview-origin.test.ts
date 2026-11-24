/**
 * `isPreviewShapedOrigin`, label helpers and the redaction choke point.
 * See change: serve-live-previews-on-capability-origin (D2, D3; test-plan #E15-#E17, #E19, #E27).
 */
import { parsePreviewOrigins, resolvePreviewOrigins } from "@blackbelt-technology/pi-dashboard-shared/preview-origins.js";
import { describe, expect, it } from "vitest";
import { redactCapability } from "../live-server/capability-redact.js";
import {
  canonicalHostOf,
  generatePreviewLabel,
  isPreviewShapedHost,
  isPreviewShapedOrigin,
  isPreviewShapedOriginUrl,
  PREVIEW_LABEL_SHAPE,
  previewLogHash,
  splitHostHeader,
} from "../live-server/preview-origin.js";

const L = "k7q4mzxa2bcdefghijklmnopqr".slice(0, 26);
const ctxBase = { port: 8000, piPort: 9999, allowedHosts: [], publicBaseUrls: [], corsOrigins: [] };
const resolved = (cfg: unknown, over: Record<string, unknown> = {}) =>
  resolvePreviewOrigins(parsePreviewOrigins(cfg).value, { ...ctxBase, ...over });
const cfg = {
  wildcard: { suffix: "preview.example.com", forHosts: ["dash.example.com"] },
  portPool: "8100-8199",
  ipDnsSuffix: "sslip.io",
};
const none = () => null;

describe("isPreviewShapedOrigin — label forms (E15)", () => {
  const r = resolved(cfg);
  const shaped = (host: string, port?: number, scheme: "http" | "https" = "http") =>
    isPreviewShapedOrigin(scheme, host, port, { resolved: r, classify: none });

  it("true for `.localhost`, case-folded, trailing-dot, any port", () => {
    expect(shaped(`${L}.localhost`, 8000)).toBe(true);
    expect(shaped(`${L.toUpperCase()}.LOCALHOST`, 8000)).toBe(true);
    expect(shaped(`${L}.localhost.`, 8000)).toBe(true);
    expect(shaped(`${L}.localhost`, 80)).toBe(true);
    expect(shaped(`${L}.localhost`)).toBe(true);
  });
  it("false for near-miss labels and shapes", () => {
    expect(shaped(`${L.slice(1)}.localhost`)).toBe(false); // 25
    expect(shaped(`${L}a.localhost`)).toBe(false); // 27
    expect(shaped(`${L.slice(1)}1.localhost`)).toBe(false); // digit 1
    expect(shaped(`x.${L}.localhost`)).toBe(false);
    expect(shaped(`${L}.localhost.evil.com`)).toBe(false);
    expect(shaped(`${L}.xlocalhost`)).toBe(false);
    expect(shaped("name.localhost")).toBe(false);
    expect(shaped("localhost")).toBe(false);
  });
  it("configured suffix forms", () => {
    expect(shaped(`${L}.preview.example.com`, undefined, "https")).toBe(true);
    expect(shaped(`${L}.192-168-1-5.sslip.io`, 8000)).toBe(true);
    expect(shaped(`${L}.sslip.io`)).toBe(false); // no a-b-c-d segment
    expect(shaped(`${L}.other.example.com`)).toBe(false);
  });
  it("enabled:false keeps `.localhost` and every valid configured form preview-shaped (Q11)", () => {
    const off = resolved({ ...cfg, enabled: false });
    const s = (h: string, p?: number) => isPreviewShapedOrigin("http", h, p, { resolved: off, classify: none });
    expect(s(`${L}.localhost`, 8000)).toBe(true);
    expect(s(`${L}.preview.example.com`)).toBe(true);
    expect(s(`${L}.192-168-1-5.sslip.io`)).toBe(true);
    expect(s("192.168.1.5", 8101)).toBe(true);
  });
  it("no config at all: only `.localhost` label hosts", () => {
    const bare = resolved(undefined);
    expect(isPreviewShapedOrigin("http", `${L}.localhost`, 8000, { resolved: bare, classify: none })).toBe(true);
    expect(isPreviewShapedOrigin("http", `${L}.preview.example.com`, 80, { resolved: bare, classify: none })).toBe(false);
  });
});

describe("isPreviewShapedOrigin — (a) IP + resolved pool port, never exempted (E16)", () => {
  const r = resolved(cfg);
  // a classifier that admits every IP literal, like classifyAdmittedHostname does
  const admitIp = (h: string) => (/^[\d.]+$/.test(h) || h.includes(":") ? "ip-address" : null);
  const shaped = (h: string, p?: number) => isPreviewShapedOrigin("http", h, p, { resolved: r, classify: admitIp });
  it("pool ports are shaped, including IPv6 and IPv4-mapped spellings", () => {
    for (const port of [8100, 8101, 8199]) expect(shaped("192.168.1.5", port)).toBe(true);
    expect(shaped("2001:db8::1", 8101)).toBe(true);
    expect(shaped("[2001:db8::1]", 8101)).toBe(true);
    expect(shaped("::ffff:192.168.1.5", 8101)).toBe(true);
    expect(shaped("::ffff:c0a8:0105", 8101)).toBe(true);
  });
  it("outside the pool / no port / dashboard port are not", () => {
    for (const port of [8099, 8200, 8000, undefined]) expect(shaped("192.168.1.5", port)).toBe(false);
  });
  it("scheme-default effective port (E18 shape): :80 / :443 are not pool-shaped; an invalid pool shapes nothing", () => {
    expect(isPreviewShapedOrigin("https", "192.168.16.242", undefined, { resolved: r, classify: admitIp })).toBe(false);
    const low = resolved({ portPool: "80-90" });
    expect(low.pool).toBeUndefined();
    expect(isPreviewShapedOrigin("http", "192.168.16.242", 80, { resolved: low, classify: admitIp })).toBe(false);
    expect(isPreviewShapedOrigin("http", "192.168.16.242", 8101, { resolved: low, classify: admitIp })).toBe(false);
  });
});

describe("isPreviewShapedOrigin — (b) static exemption applies to non-IP names only (E17)", () => {
  const r = resolved({ wildcard: cfg.wildcard });
  it("statically admitted names are not preview-shaped; the same names unadmitted are", () => {
    const names = [`${L}.localhost`, `${L}.preview.example.com`];
    for (const n of names) {
      expect(isPreviewShapedOrigin("http", n, 8000, { resolved: r, classify: () => "allowed-host" }), n).toBe(false);
      expect(isPreviewShapedOrigin("http", n, 8000, { resolved: r, classify: none }), n).toBe(true);
    }
  });
  it("a throwing classifier fails toward preview-shaped (never the dashboard)", () => {
    const boom = () => {
      throw new Error("x");
    };
    expect(isPreviewShapedOrigin("http", `${L}.localhost`, 8000, { resolved: r, classify: boom })).toBe(true);
  });
});

describe("Host / Origin helpers", () => {
  const r = resolved(cfg);
  it("isPreviewShapedHost / isPreviewShapedOriginUrl wrap the predicate", () => {
    const deps = { resolved: r, classify: none };
    expect(isPreviewShapedHost("http", `${L}.localhost:8000`, deps)).toBe(true);
    expect(isPreviewShapedHost("http", "192.168.1.5:8150", deps)).toBe(true);
    expect(isPreviewShapedHost("http", "[::ffff:192.168.1.5]:8101", deps)).toBe(true);
    expect(isPreviewShapedHost("http", "localhost:8000", deps)).toBe(false);
    expect(isPreviewShapedHost("http", undefined, deps)).toBe(false);
    expect(isPreviewShapedOriginUrl(`http://${L}.localhost:8000`, deps)).toBe(true);
    expect(isPreviewShapedOriginUrl("http://[::ffff:192.168.16.242]:8101", deps)).toBe(true);
    expect(isPreviewShapedOriginUrl("http://192.168.16.242", deps)).toBe(false);
    expect(isPreviewShapedOriginUrl("https://192.168.16.242", deps)).toBe(false);
    expect(isPreviewShapedOriginUrl("null", deps)).toBe(false);
    expect(isPreviewShapedOriginUrl("ftp://x", deps)).toBe(false);
  });
  it("canonicalHostOf elides the scheme default port", () => {
    expect(canonicalHostOf("http", `${L.toUpperCase()}.LOCALHOST:80`)).toBe(`${L}.localhost`);
    expect(canonicalHostOf("http", `${L}.localhost:8000`)).toBe(`${L}.localhost:8000`);
    expect(canonicalHostOf("https", "a.example.com:443")).toBe("a.example.com");
    expect(canonicalHostOf("http", "[::1]:8000")).toBe("[::1]:8000");
    expect(canonicalHostOf("http", "a:b:c")).toBeNull();
    expect(splitHostHeader("x:99999")).toBeNull();
  });
});

describe("labels (E19)", () => {
  it("10,000 labels: all [a-z2-7]{26}, no duplicates", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const l = generatePreviewLabel();
      expect(PREVIEW_LABEL_SHAPE.test(l)).toBe(true);
      seen.add(l);
    }
    expect(seen.size).toBe(10_000);
  });
  it("is deterministic over injected bytes (collision tests)", () => {
    const zero = () => Buffer.alloc(16);
    expect(generatePreviewLabel(zero)).toBe("a".repeat(26));
    expect(previewLogHash(L)).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("redactCapability (E27)", () => {
  const cases: [string, string][] = [
    [`Origin: http://${L}.localhost:8000`, "Origin: http://<redacted>.localhost:8000"],
    [`Origin: http://${L.toUpperCase()}.LOCALHOST:8000`, "Origin: http://<redacted>.LOCALHOST:8000"],
    [`${L}.localhost.:8000`, "<redacted>.localhost.:8000"],
    [`https://${L}.preview.example.com`, "https://<redacted>.preview.example.com"],
    [`${L}.192-168-1-5.sslip.io`, "<redacted>.192-168-1-5.sslip.io"],
    [`x.${L}.localhost`, "x.<redacted>.localhost"],
    ["/preview/abc123DEF/x", "/preview/<redacted>/x"],
    ["/a?k=abc&y=1", "/a?k=<redacted>&y=1"],
    ["/a?y=1&k=abc", "/a?y=1&k=<redacted>"],
    ["/live/x/~c/abcDEF_-123", "/live/x/~c/<redacted>"],
  ];
  it.each(cases)("%s", (input, want) => {
    expect(redactCapability(input)).toBe(want);
  });
  it("a 27-char label is not a label and is left alone; ports are kept", () => {
    expect(redactCapability(`${L}a.localhost:8000`)).toBe(`${L}a.localhost:8000`);
    expect(redactCapability("http://192.168.1.5:8101/x")).toBe("http://192.168.1.5:8101/x");
  });
});

describe("gate log lines are redacted (E27, 2.4)", () => {
  it("[csrf-gate] never prints a live label, even upper-cased with a trailing dot", async () => {
    const { vi } = await import("vitest");
    const { createMutationOriginGate } = await import("../auth/mutation-origin-gate.js");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const gate = createMutationOriginGate(() => ({ configuredOrigins: [], trustedNetworks: [] }) as never);
    const reply = { code: () => ({ send: () => {} }) };
    const origin = `http://${L.toUpperCase()}.EVIL.EXAMPLE.:8000`;
    gate(
      { method: "POST", url: "/api/x", routeOptions: { url: "/api/x" }, headers: { origin, host: "localhost:8000" } } as never,
      reply as never,
      () => {},
    );
    const line = String(spy.mock.calls[0]?.[0]);
    expect(line).toContain("[csrf-gate] rejected");
    expect(line.toLowerCase()).not.toContain(L);
    expect(line).toContain("<redacted>.");
    spy.mockRestore();
  });
});
