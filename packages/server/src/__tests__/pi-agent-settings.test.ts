import { describe, it, expect } from "vitest";
import {
  readPiRetryPolicy,
  writePiRetryPolicy,
  validatePiRetryPolicy,
  PI_RETRY_DEFAULTS,
} from "../pi-agent-settings.js";

/**
 * Read/write of pi's OWN native retry block in ~/.pi/agent/settings.json.
 * All six fields; GLOBAL only; merge-preserving at both levels; validated;
 * never touches .pi/settings.json.
 * See change: retry-forever-with-stop-control.
 */
describe("pi-agent-settings", () => {
  const home = "/fake/home";
  const GLOBAL = "/fake/home/.pi/agent/settings.json";
  const PROJECT = "/fake/proj/.pi/settings.json";

  /** In-memory fs harness. Records every path written. */
  function harness(seed: Record<string, string> = {}) {
    const files = { ...seed };
    const writes: string[] = [];
    const deps = {
      home,
      fileExists: (p: string) => p in files,
      readFile: (p: string) => {
        if (!(p in files)) throw new Error(`ENOENT ${p}`);
        return files[p]!;
      },
      writeFile: (p: string, d: string) => {
        files[p] = d;
        writes.push(p);
      },
      mkdirp: () => {},
    };
    return { files, writes, deps };
  }

  const valid = {
    enabled: true,
    maxRetries: 24,
    baseDelayMs: 2000,
    provider: { maxRetries: 0, maxRetryDelayMs: 60000 },
  };

  describe("read", () => {
    it("returns pi's defaults when the file does not exist", () => {
      const { deps } = harness();
      expect(readPiRetryPolicy(deps)).toEqual(PI_RETRY_DEFAULTS);
    });

    it("returns defaults when there is no retry block", () => {
      const { deps } = harness({ [GLOBAL]: JSON.stringify({ extensions: [] }) });
      expect(readPiRetryPolicy(deps)).toEqual(PI_RETRY_DEFAULTS);
    });

    it("reads all six fields", () => {
      const { deps } = harness({
        [GLOBAL]: JSON.stringify({
          retry: {
            enabled: false,
            maxRetries: 24,
            baseDelayMs: 5000,
            provider: { timeoutMs: 3600000, maxRetries: 5, maxRetryDelayMs: 0 },
          },
        }),
      });
      expect(readPiRetryPolicy(deps)).toEqual({
        enabled: false,
        maxRetries: 24,
        baseDelayMs: 5000,
        provider: { timeoutMs: 3600000, maxRetries: 5, maxRetryDelayMs: 0 },
      });
    });

    it("omits provider.timeoutMs when absent (SDK default)", () => {
      const { deps } = harness({
        [GLOBAL]: JSON.stringify({ retry: { provider: { maxRetries: 2 } } }),
      });
      const out = readPiRetryPolicy(deps);
      expect("timeoutMs" in out.provider).toBe(false);
      expect(out.provider.maxRetries).toBe(2);
      expect(out.provider.maxRetryDelayMs).toBe(60000); // pi default
    });
  });

  describe("write is merge-preserving", () => {
    it("preserves unrelated top-level keys BYTE-IDENTICALLY", () => {
      const untouched = {
        packages: ["@blackbelt-technology/pi-dashboard-extension"],
        extensions: ["/x/bridge.js"],
        dashboardPluginBridges: [{ id: "flows" }],
        enabledModels: ["anthropic/*"],
      };
      const { files, deps } = harness({ [GLOBAL]: JSON.stringify(untouched, null, 2) });
      expect(writePiRetryPolicy(valid, deps).ok).toBe(true);
      const written = JSON.parse(files[GLOBAL]!);
      for (const [k, v] of Object.entries(untouched)) {
        expect(JSON.stringify(written[k])).toBe(JSON.stringify(v));
      }
    });

    it("preserves UNKNOWN keys inside retry and inside retry.provider", () => {
      const { files, deps } = harness({
        [GLOBAL]: JSON.stringify({
          retry: {
            someFutureKnob: "keep-me",
            maxRetries: 3,
            provider: { futureProviderKnob: 42, maxRetries: 0 },
          },
        }),
      });
      writePiRetryPolicy(valid, deps);
      const written = JSON.parse(files[GLOBAL]!);
      expect(written.retry.someFutureKnob).toBe("keep-me");
      expect(written.retry.provider.futureProviderKnob).toBe(42);
    });

    it("writes all six fields", () => {
      const { files, deps } = harness();
      writePiRetryPolicy(
        { enabled: false, maxRetries: 10, baseDelayMs: 4000, provider: { timeoutMs: 1000, maxRetries: 3, maxRetryDelayMs: 0 } },
        deps,
      );
      const r = JSON.parse(files[GLOBAL]!).retry;
      expect(r).toMatchObject({
        enabled: false,
        maxRetries: 10,
        baseDelayMs: 4000,
        provider: { timeoutMs: 1000, maxRetries: 3, maxRetryDelayMs: 0 },
      });
    });

    it("OMITS provider.timeoutMs when undefined rather than writing 0/null", () => {
      const { files, deps } = harness({
        [GLOBAL]: JSON.stringify({ retry: { provider: { timeoutMs: 999 } } }),
      });
      writePiRetryPolicy(valid, deps); // valid has no timeoutMs
      const prov = JSON.parse(files[GLOBAL]!).retry.provider;
      expect("timeoutMs" in prov).toBe(false);
    });

    it("NEVER writes the project settings file", () => {
      const { writes, deps } = harness();
      writePiRetryPolicy(valid, deps);
      expect(writes).toEqual([GLOBAL]);
      expect(writes).not.toContain(PROJECT);
    });

    it("round-trips through read", () => {
      const { deps } = harness();
      const p = { enabled: false, maxRetries: 12, baseDelayMs: 5000, provider: { maxRetries: 1, maxRetryDelayMs: 0 } };
      writePiRetryPolicy(p, deps);
      expect(readPiRetryPolicy(deps)).toEqual(p);
    });
  });

  describe("validation", () => {
    it("accepts large attempt counts (no clamp)", () => {
      expect(validatePiRetryPolicy({ ...valid, maxRetries: 100 })).toEqual([]);
    });

    it("accepts an omitted provider.timeoutMs", () => {
      expect(validatePiRetryPolicy(valid)).toEqual([]);
    });

    it.each([
      [{ ...valid, maxRetries: -1 }, "maxRetries"],
      [{ ...valid, maxRetries: 1.5 }, "maxRetries"],
      [{ ...valid, baseDelayMs: 0 }, "baseDelayMs"],
      [{ ...valid, enabled: "yes" }, "enabled"],
      [{ ...valid, provider: { maxRetries: -1, maxRetryDelayMs: 0 } }, "provider.maxRetries"],
      [{ ...valid, provider: { maxRetries: 0, maxRetryDelayMs: -5 } }, "provider.maxRetryDelayMs"],
      [{ ...valid, provider: { timeoutMs: 0, maxRetries: 0, maxRetryDelayMs: 0 } }, "provider.timeoutMs"],
    ])("rejects %o on field %s", (bad, field) => {
      expect(validatePiRetryPolicy(bad).map((e) => e.field)).toContain(field);
    });

    it("rejects a missing provider block", () => {
      expect(validatePiRetryPolicy({ enabled: true, maxRetries: 3, baseDelayMs: 2000 }).map((e) => e.field))
        .toContain("provider");
    });

    it("does not write when invalid", () => {
      const { writes, deps } = harness();
      const res = writePiRetryPolicy({ ...valid, maxRetries: -1 }, deps);
      expect(res.ok).toBe(false);
      expect(res.errors?.length).toBeGreaterThan(0);
      expect(writes).toHaveLength(0);
    });
  });
});
