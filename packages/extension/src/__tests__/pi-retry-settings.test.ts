import { describe, it, expect } from "vitest";
import { readPiRetrySettings, PI_RETRY_DEFAULTS } from "../pi-retry-settings.js";

/**
 * Read-only reader for pi's `retry` block. Never writes; never throws.
 * See change: retry-forever-with-stop-control.
 */
describe("readPiRetrySettings", () => {
  const home = "/fake/home";
  const cwd = "/fake/proj";
  const GLOBAL = "/fake/home/.pi/agent/settings.json";
  const PROJECT = "/fake/proj/.pi/settings.json";

  function reader(files: Record<string, string>) {
    return readPiRetrySettings({
      home,
      cwd,
      fileExists: (p) => p in files,
      readFile: (p) => {
        if (!(p in files)) throw new Error(`ENOENT ${p}`);
        return files[p]!;
      },
    });
  }

  it("returns pi's defaults when no settings files exist", () => {
    expect(reader({})).toEqual(PI_RETRY_DEFAULTS);
  });

  it("returns defaults when the file has no retry block", () => {
    expect(reader({ [GLOBAL]: JSON.stringify({ extensions: [] }) })).toEqual(PI_RETRY_DEFAULTS);
  });

  it("reads enabled, maxRetries and baseDelayMs from the global file", () => {
    expect(
      reader({ [GLOBAL]: JSON.stringify({ retry: { enabled: false, maxRetries: 24, baseDelayMs: 5000 } }) }),
    ).toEqual({ enabled: false, maxRetries: 24, baseDelayMs: 5000, maxAgentDelayMs: 60000 });
  });

  it("reads enabled:false so the tracker can suppress a phantom countdown", () => {
    expect(reader({ [GLOBAL]: JSON.stringify({ retry: { enabled: false } }) }).enabled).toBe(false);
  });

  it("lets the project file override the global one (mirrors pi's own merge)", () => {
    // Reading both mirrors pi's settings merge so the rendered countdown matches
    // what pi will actually do. The EDITOR remains global-only.
    expect(
      reader({
        [GLOBAL]: JSON.stringify({ retry: { maxRetries: 3, baseDelayMs: 2000 } }),
        [PROJECT]: JSON.stringify({ retry: { maxRetries: 99 } }),
      }),
    ).toEqual({ enabled: true, maxRetries: 99, baseDelayMs: 2000, maxAgentDelayMs: 60000 });
  });

  it("degrades to baseDelayMs:0 (elapsed-only) when a present file is unparseable", () => {
    const out = reader({ [GLOBAL]: "{ not json" });
    expect(out.baseDelayMs).toBe(0);
    expect(out.maxRetries).toBe(PI_RETRY_DEFAULTS.maxRetries);
  });

  it("ignores non-numeric retry values", () => {
    expect(
      reader({ [GLOBAL]: JSON.stringify({ retry: { maxRetries: "lots", baseDelayMs: null } }) }),
    ).toEqual(PI_RETRY_DEFAULTS);
  });

  // See change: fix-retry-delay-cap — pi caps the agent-level delay at
  // `retry.maxAgentDelayMs` (pi-ai `retryDelayMs`); the reader must surface it.
  describe("maxAgentDelayMs (test-plan #E7, #E8)", () => {
    it("defaults to 60000 when neither file sets it", () => {
      expect(reader({}).maxAgentDelayMs).toBe(60000);
      expect(PI_RETRY_DEFAULTS.maxAgentDelayMs).toBe(60000);
    });

    it("reads the global cap", () => {
      expect(reader({ [GLOBAL]: JSON.stringify({ retry: { maxAgentDelayMs: 60000 } }) }).maxAgentDelayMs).toBe(60000);
      expect(reader({ [GLOBAL]: JSON.stringify({ retry: { maxAgentDelayMs: 7000 } }) }).maxAgentDelayMs).toBe(7000);
    });

    it("lets the project cap override the global cap", () => {
      expect(
        reader({
          [GLOBAL]: JSON.stringify({ retry: { maxAgentDelayMs: 60000 } }),
          [PROJECT]: JSON.stringify({ retry: { maxAgentDelayMs: 10000 } }),
        }).maxAgentDelayMs,
      ).toBe(10000);
    });

    it("falls back to the default for non-numeric values", () => {
      expect(reader({ [GLOBAL]: JSON.stringify({ retry: { maxAgentDelayMs: "abc" } }) }).maxAgentDelayMs).toBe(60000);
      expect(reader({ [GLOBAL]: JSON.stringify({ retry: { maxAgentDelayMs: null } }) }).maxAgentDelayMs).toBe(60000);
    });

    it("mirrors what pi obeys: any finite number, including fractions and negatives", () => {
      expect(reader({ [GLOBAL]: JSON.stringify({ retry: { maxAgentDelayMs: 1.5 } }) }).maxAgentDelayMs).toBe(1.5);
      expect(reader({ [GLOBAL]: JSON.stringify({ retry: { maxAgentDelayMs: -1 } }) }).maxAgentDelayMs).toBe(-1);
    });

    it("keeps the cap on the unparseable-file degrade path", () => {
      expect(reader({ [GLOBAL]: "{ not json" }).maxAgentDelayMs).toBe(60000);
    });
  });
});
