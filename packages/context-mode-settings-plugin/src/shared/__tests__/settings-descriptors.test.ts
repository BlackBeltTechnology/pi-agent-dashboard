/**
 * Descriptor table, validation and env projection. Folds test-plan E1–E7.
 * See change: add-context-mode-settings-plugin.
 */
import { describe, expect, it } from "vitest";
import { CONTEXT_SETTINGS, projectEnv, validateSettings } from "../settings-descriptors.js";

const errs = (obj: unknown) => {
  const r = validateSettings(obj);
  return r.ok ? [] : r.errors;
};

describe("validateSettings", () => {
  it("E1: search.blockAfter is a positive integer", () => {
    for (const v of [1, 8]) expect(errs({ "search.blockAfter": v })).toEqual([]);
    for (const v of [0, -1, 1.5, "8"]) {
      const e = errs({ "search.blockAfter": v });
      expect(e).toHaveLength(1);
      expect(e[0].key).toBe("search.blockAfter");
    }
  });

  it("E2: search.windowMs is a finite positive number", () => {
    for (const v of [1, 60000]) expect(errs({ "search.windowMs": v })).toEqual([]);
    for (const v of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) expect(errs({ "search.windowMs": v })).toHaveLength(1);
  });

  it("E3: IANA time zone and BCP-47 locale", () => {
    for (const v of ["Europe/Budapest", "UTC"]) expect(errs({ "locale.timeZone": v })).toEqual([]);
    for (const v of ["Mars/Olympus", ""]) expect(errs({ "locale.timeZone": v })).toHaveLength(1);
    for (const v of ["hu-HU", "en"]) expect(errs({ "locale.locale": v })).toEqual([]);
    expect(errs({ "locale.locale": "xx_YY!!" })).toHaveLength(1);
  });

  it("E4: paths must be absolute or ~-prefixed", () => {
    for (const v of ["/abs/x", "~/cm"]) expect(errs({ "storage.dir": v })).toEqual([]);
    expect(errs({ "storage.dir": "rel/x" })).toHaveLength(1);
    if (process.platform !== "win32") expect(errs({ "storage.dir": "C:\\x" })).toHaveLength(1);
  });

  it("E5: unknown/internal keys are rejected and never in the table", () => {
    for (const k of ["bridge.depth", "platform", "storage.projectDir"]) {
      expect(errs({ [k]: 1 })).toEqual([{ key: k, error: "unknown_key" }]);
    }
    const banned = [
      /^CONTEXT_MODE_BRIDGE_/,
      /^CONTEXT_MODE_PROJECT_DIR$/,
      /^CONTEXT_MODE_PLATFORM$/,
      /^CONTEXT_MODE_EMBEDDED_PLUGIN_TOOLS$/,
      /^CONTEXT_MODE_AGY_EXEC_TIMEOUT_MS$/,
      /^CONTEXT_MODE_COPILOT_PLUGIN$/,
    ];
    for (const d of CONTEXT_SETTINGS) for (const b of banned) expect(d.env).not.toMatch(b);
  });

  it("rejects non-object bodies", () => {
    expect(errs(null)).toHaveLength(1);
    expect(errs([])).toHaveLength(1);
  });

  it("every descriptor accepts a valid sample (table coverage)", () => {
    const sample: Record<string, unknown> = {
      "storage.dir": "/d", "storage.dataDir": "~/d", "storage.sessionSuffix": "x",
      "search.windowMs": 5, "search.maxResultsAfter": 2, "search.blockAfter": 3,
      "locale.locale": "en", "locale.timeZone": "UTC",
      "stats.outputPricePerToken": 0.1, "stats.modelId": "m", "fetch.strict": true,
    };
    expect(Object.keys(sample).sort()).toEqual(CONTEXT_SETTINGS.map((d) => d.key).sort());
    expect(errs(sample)).toEqual([]);
  });
});

describe("projectEnv", () => {
  it("E6: booleans project to '1' only when true", () => {
    expect(projectEnv({ "fetch.strict": true }, { scopes: ["runtime"] })).toEqual({ CTX_FETCH_STRICT: "1" });
    expect(projectEnv({ "fetch.strict": false }, { scopes: ["runtime"] })).toEqual({});
    expect(projectEnv({}, { scopes: ["runtime"] })).toEqual({});
  });

  it("E7: storage.dir expands ~ to an absolute path", () => {
    expect(projectEnv({ "storage.dir": "~/cm-data" }, { scopes: ["storage"], home: "/h" })).toEqual({
      CONTEXT_MODE_DIR: "/h/cm-data",
    });
  });

  it("scopes filter, and invalid entries are dropped individually", () => {
    const bad: string[] = [];
    const out = projectEnv(
      { "storage.dir": "/d", "search.windowMs": 30000, "search.blockAfter": -1 },
      { scopes: ["runtime"], onInvalid: (e) => bad.push(e.key) },
    );
    expect(out).toEqual({ CONTEXT_MODE_SEARCH_WINDOW_MS: "30000" });
    expect(bad).toEqual(["search.blockAfter"]);
  });
});
