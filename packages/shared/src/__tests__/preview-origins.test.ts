/**
 * `liveServer.previewOrigins` parse + overlap validation (D12, D5 pool grammar).
 * See change: serve-live-previews-on-capability-origin (test-plan #E1-#E14, #E53, #X1).
 */
import { describe, expect, it } from "vitest";
import {
  formatTierSet,
  type PreviewOriginsContext,
  parsePreviewOrigins,
  previewOriginsConfigChanged,
  resolvePreviewOrigins,
} from "../preview-origins.js";

const a26 = "a".repeat(26);
const ctx = (over: Partial<PreviewOriginsContext> = {}): PreviewOriginsContext => ({
  port: 8000,
  piPort: 9999,
  allowedHosts: [],
  publicBaseUrls: [],
  corsOrigins: [],
  ...over,
});
const keysOf = (r: { issues: { keys: string[] }[] }) => r.issues.flatMap((i) => i.keys);

describe("parsePreviewOrigins — defaults and types", () => {
  it("absent → enabled, no issues", () => {
    const r = parsePreviewOrigins(undefined);
    expect(r.value).toEqual({ enabled: true });
    expect(r.issues).toEqual([]);
  });

  it("E14: every non-boolean `enabled` resolves to false and logs the key; absent keeps the default", () => {
    for (const bad of ["false", 0, null, "no", 1]) {
      const r = parsePreviewOrigins({ enabled: bad });
      expect(r.value.enabled, String(bad)).toBe(false);
      expect(keysOf(r)).toEqual(["liveServer.previewOrigins.enabled"]);
    }
    expect(parsePreviewOrigins({}).value.enabled).toBe(true);
    expect(parsePreviewOrigins({ enabled: false }).value.enabled).toBe(false);
  });

  it("X1: wrongly typed tier values disable only that tier", () => {
    const cases: [unknown, string][] = [
      ["yes", "liveServer.previewOrigins"],
      [{ wildcard: [] }, "liveServer.previewOrigins.wildcard"],
      [{ wildcard: { suffix: 5 } }, "liveServer.previewOrigins.wildcard.suffix"],
      [{ ipDnsSuffix: 5 }, "liveServer.previewOrigins.ipDnsSuffix"],
      [{ wildcard: { suffix: "p.example.com", forHosts: {} } }, "liveServer.previewOrigins.wildcard.forHosts"],
      [{ portPool: {} }, "liveServer.previewOrigins.portPool"],
    ];
    for (const [raw, key] of cases) {
      const r = parsePreviewOrigins(raw);
      expect(r.value.enabled).toBe(true);
      expect(r.value.wildcard).toBeUndefined();
      expect(r.value.portPool).toBeUndefined();
      expect(r.value.ipDnsSuffix).toBeUndefined();
      expect(keysOf(r)).toContain(key);
      expect(r.issues).toHaveLength(1);
    }
  });
});

describe("parsePreviewOrigins — portPool grammar (E1-E3)", () => {
  const pool = (s: unknown) => parsePreviewOrigins({ portPool: s });
  it("E1/E2: range limits", () => {
    expect(pool("8100-8199").value.portPool).toBe("8100-8199");
    expect(pool("8100-8200").value.portPool).toBeUndefined();
    expect(pool("8100-8200").issues).toHaveLength(1);
    expect(pool("8100-8100").value.portPool).toBe("8100-8100");
    expect(pool("1024-1030").value.portPool).toBe("1024-1030");
    expect(pool("65530-65535").value.portPool).toBe("65530-65535");
    for (const bad of ["1023-1030", "80-90", "65535-65536"]) {
      const r = pool(bad);
      expect(r.value.portPool, bad).toBeUndefined();
      expect(keysOf(r), bad).toEqual(["liveServer.previewOrigins.portPool"]);
    }
  });
  it("E3: malformed strings never throw and disable tier 3", () => {
    for (const bad of ["8200-8100", "8100", "8100-", "-8100", "a-b", " 8100-8199", "08100-08199", 8100, null, []]) {
      const r = pool(bad);
      expect(r.value.portPool, String(bad)).toBeUndefined();
      expect(r.issues, String(bad)).toHaveLength(1);
    }
  });
});

describe("parsePreviewOrigins — suffix + forHosts (E5, E6, E11)", () => {
  const wc = (w: unknown) => parsePreviewOrigins({ wildcard: w });
  it("E5: localhost suffixes are invalid (label boundary)", () => {
    for (const bad of ["localhost", "preview.localhost", "LOCALHOST", "localhost."]) {
      const w = wc({ suffix: bad, forHosts: ["dash.example.com"] });
      expect(w.value.wildcard, bad).toBeUndefined();
      expect(keysOf(w)).toContain("liveServer.previewOrigins.wildcard.suffix");
      const ip = parsePreviewOrigins({ ipDnsSuffix: bad });
      expect(ip.value.ipDnsSuffix, bad).toBeUndefined();
      expect(keysOf(ip)).toContain("liveServer.previewOrigins.ipDnsSuffix");
    }
    for (const ok of ["mylocalhost.com", "foolocalhost"]) {
      expect(wc({ suffix: ok, forHosts: ["d.example.com"] }).value.wildcard?.suffix).toBe(ok);
      expect(parsePreviewOrigins({ ipDnsSuffix: ok }).value.ipDnsSuffix).toBe(ok);
    }
  });
  it("suffix rejects scheme, port, path, `*.`, empty label, IP literal", () => {
    for (const bad of ["https://a.com", "a.com:8443", "a.com/x", "*.a.com", ".a.com", "a..com", "1.2.3.4", "::1", ""]) {
      expect(parsePreviewOrigins({ ipDnsSuffix: bad }).value.ipDnsSuffix, bad).toBeUndefined();
    }
  });
  it("E6: equal suffixes (after normalisation) disable both tiers with ONE log line naming both keys", () => {
    for (const [a, b] of [
      ["sslip.io", "sslip.io"],
      ["SSLIP.io", "sslip.io"],
      ["sslip.io.", "sslip.io"],
    ]) {
      const r = parsePreviewOrigins({ wildcard: { suffix: a, forHosts: ["d.example.com"] }, ipDnsSuffix: b });
      expect(r.value.wildcard).toBeUndefined();
      expect(r.value.ipDnsSuffix).toBeUndefined();
      expect(r.issues).toHaveLength(1);
      expect(r.issues[0].keys).toEqual([
        "liveServer.previewOrigins.wildcard.suffix",
        "liveServer.previewOrigins.ipDnsSuffix",
      ]);
    }
    // `.sslip.io` is an empty label → only that tier is disabled
    const r = parsePreviewOrigins({ wildcard: { suffix: ".sslip.io", forHosts: ["d.example.com"] }, ipDnsSuffix: "sslip.io" });
    expect(r.value.wildcard).toBeUndefined();
    expect(r.value.ipDnsSuffix).toBe("sslip.io");
  });
  it("E11: forHosts is required; entries are normalised; scheme/port entries reject the tier", () => {
    for (const bad of [undefined, [], [""], "dash.example.com", ["https://dash.example.com"], ["dash.example.com:8443"]]) {
      const r = wc({ suffix: "preview.example.com", ...(bad === undefined ? {} : { forHosts: bad }) });
      expect(r.value.wildcard, JSON.stringify(bad)).toBeUndefined();
      expect(keysOf(r)).toContain("liveServer.previewOrigins.wildcard.forHosts");
    }
    const ok = wc({ suffix: "Preview.Example.com.", forHosts: ["DASH.Example.com."] });
    expect(ok.value.wildcard).toEqual({ suffix: "preview.example.com", forHosts: ["dash.example.com"], scheme: "https" });
  });
  it("scalar validation: scheme, port (elided at the scheme default)", () => {
    const base = { suffix: "p.example.com", forHosts: ["d.example.com"] };
    expect(wc({ ...base, port: 8443 }).value.wildcard?.port).toBe(8443);
    expect(wc({ ...base, port: 443 }).value.wildcard?.port).toBeUndefined();
    expect(wc({ ...base, scheme: "http", port: 80 }).value.wildcard?.port).toBeUndefined();
    expect(wc({ ...base, scheme: "http", port: 443 }).value.wildcard?.port).toBe(443);
    for (const bad of [0, 65536, 1.5, "443", -1]) {
      const r = wc({ ...base, port: bad });
      expect(r.value.wildcard, String(bad)).toBeUndefined();
      expect(keysOf(r)).toContain("liveServer.previewOrigins.wildcard.port");
    }
    expect(wc({ ...base, scheme: "ftp" }).value.wildcard).toBeUndefined();
  });
});

describe("resolvePreviewOrigins — overlap validation", () => {
  const parsed = (o: unknown) => parsePreviewOrigins(o).value;
  const wildcard = { suffix: "preview.example.com", forHosts: ["dash.example.com"] };

  it("tier set: 1 and 5 always (when enabled), others per validity", () => {
    const r = resolvePreviewOrigins(
      parsed({ wildcard, portPool: "8100-8199", ipDnsSuffix: "sslip.io" }),
      ctx(),
    );
    expect(r.tiers).toEqual([1, 2, 3, 4, 5]);
    expect(formatTierSet(r)).toBe("1, 2, 3(8100-8199), 4, 5");
    expect(resolvePreviewOrigins(parsed({ enabled: false }), ctx()).tiers).toEqual([]);
    // enabled:false keeps the validated fields: they still define what is preview-shaped (Q11)
    const off = resolvePreviewOrigins(parsed({ enabled: false, wildcard, portPool: "8100-8199" }), ctx());
    expect(off.tiers).toEqual([]);
    expect(off.wildcard?.suffix).toBe("preview.example.com");
    expect(off.pool).toEqual({ from: 8100, to: 8199 });
    expect(resolvePreviewOrigins(parsed({}), ctx()).tiers).toEqual([1, 5]);
  });

  it("E4: pool must be disjoint from dashboard/piPort/TLS/model-proxy ports", () => {
    const run = (p: string, over: Partial<PreviewOriginsContext> = {}) =>
      resolvePreviewOrigins(parsed({ portPool: p }), ctx(over));
    expect(run("8001-8100").pool).toBeDefined();
    expect(run("7900-7999").pool).toBeDefined();
    for (const p of ["7950-8000", "8000-8049"]) {
      const r = run(p);
      expect(r.pool, p).toBeUndefined();
      expect(keysOf(r)).toEqual(["port"]);
    }
    expect(keysOf(run("9990-10000"))).toEqual(["piPort"]);
    // TLS / model-proxy only reserved when configured
    expect(run("8440-8450").pool).toBeDefined();
    const tls = run("8440-8450", { tlsPort: 8443 });
    expect(tls.pool).toBeUndefined();
    expect(keysOf(tls)).toEqual(["tls.port"]);
    const mp = run("8440-8450", { modelProxyPort: 8445 });
    expect(mp.pool).toBeUndefined();
    expect(keysOf(mp)).toEqual(["modelProxy.secondPort"]);
  });

  it("E7/E8: suffix covering a 26-base32-label host in any source is rejected", () => {
    const sources = (host: string): Partial<PreviewOriginsContext>[] => [
      { allowedHosts: [host] },
      { publicBaseUrls: [`https://${host}`] },
      { corsOrigins: [`https://${host}`] },
    ];
    for (const label of [a26, a26.toUpperCase()]) {
      for (const over of sources(`${label}.preview.example.com`)) {
        const r = resolvePreviewOrigins(parsed({ wildcard }), ctx(over));
        expect(r.wildcard).toBeUndefined();
        expect(r.issues).toHaveLength(1);
      }
    }
    const forHosts = resolvePreviewOrigins(
      parsed({ wildcard: { ...wildcard, forHosts: [`${a26}.preview.example.com`] } }),
      ctx(),
    );
    expect(forHosts.wildcard).toBeUndefined();
    for (const label of ["a".repeat(25), "a".repeat(27), `${"a".repeat(25)}1`, `${"a".repeat(25)}8`, "dash"]) {
      for (const over of sources(`${label}.preview.example.com`)) {
        expect(resolvePreviewOrigins(parsed({ wildcard }), ctx(over)).wildcard, label).toBeDefined();
      }
    }
  });

  it("E10: suffix under a static admission row disables the tier", () => {
    const classify = (h: string) => (h.endsWith(".local") ? "local" : null);
    const w = resolvePreviewOrigins(
      parsed({ wildcard: { suffix: "preview.local", forHosts: ["d.example.com"] }, ipDnsSuffix: "nip.local" }),
      ctx({ classifyAdmittedHostname: classify }),
    );
    expect(w.wildcard).toBeUndefined();
    expect(w.ipDnsSuffix).toBeUndefined();
    expect(w.issues).toHaveLength(2);
    const ok = resolvePreviewOrigins(
      parsed({ wildcard: { suffix: "preview.local.example.com", forHosts: ["d.example.com"] } }),
      ctx({ classifyAdmittedHostname: classify }),
    );
    expect(ok.wildcard).toBeDefined();
  });

  it("E53: live-tunnel origins and TLS-listener names are in the overlap set", () => {
    const host = `${a26}.preview.example.com`;
    expect(resolvePreviewOrigins(parsed({ wildcard }), ctx({ tunnelOrigins: [`https://${host}`] })).wildcard).toBeUndefined();
    expect(resolvePreviewOrigins(parsed({ wildcard }), ctx({ tlsNames: [host] })).wildcard).toBeUndefined();
    expect(resolvePreviewOrigins(parsed({ wildcard }), ctx({ tunnelOrigins: ["https://t.example.com"] })).wildcard).toBeDefined();
  });

  it("tier 4 overlap: ip-dns suffix covering a 26-label host", () => {
    const r = resolvePreviewOrigins(parsed({ ipDnsSuffix: "sslip.io" }), ctx({ allowedHosts: [`${a26}.sslip.io`] }));
    expect(r.ipDnsSuffix).toBeUndefined();
  });
});

describe("previewOriginsConfigChanged / E9 live re-evaluation", () => {
  it("detects validation-result or tier-set changes only", () => {
    const wildcard = { suffix: "preview.example.com", forHosts: ["dash.example.com"] };
    const a = resolvePreviewOrigins(parsePreviewOrigins({ wildcard }).value, ctx());
    const a2 = resolvePreviewOrigins(parsePreviewOrigins({ wildcard }).value, ctx());
    const b = resolvePreviewOrigins(
      parsePreviewOrigins({ wildcard }).value,
      ctx({ allowedHosts: [`${a26}.preview.example.com`] }),
    );
    expect(previewOriginsConfigChanged(a, a2)).toBe(false);
    expect(previewOriginsConfigChanged(a, b)).toBe(true);
    expect(b.wildcard).toBeUndefined();
    expect(previewOriginsConfigChanged(b, a)).toBe(true);
  });
});
