/**
 * Bridge env projection. Folds E8, E9, X3 (bridge half).
 * See change: add-context-mode-settings-plugin.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyRuntimeSettings } from "../index.js";

let dir: string;
let file: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "cms-bridge-"));
  file = path.join(dir, "settings.json");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
const put = (o: unknown) => fs.writeFileSync(file, typeof o === "string" ? o : JSON.stringify(o));

describe("applyRuntimeSettings", () => {
  it("E8: projects runtime keys only, records them in the marker", () => {
    put({ "storage.dir": "/d", "search.windowMs": 30000 });
    const env: NodeJS.ProcessEnv = {};
    applyRuntimeSettings(env, file);
    expect(env.CONTEXT_MODE_SEARCH_WINDOW_MS).toBe("30000");
    expect(env.CONTEXT_MODE_DIR).toBeUndefined();
    expect(env.PI_CONTEXT_MODE_SETTINGS_PROJECTED).toBe("CONTEXT_MODE_SEARCH_WINDOW_MS");
  });

  it("E9: an exported variable wins (including for disabling) and is not listed", () => {
    put({ "fetch.strict": false, "locale.timeZone": "Europe/Budapest" });
    const env: NodeJS.ProcessEnv = { CTX_FETCH_STRICT: "1", CONTEXT_MODE_TZ: "UTC" };
    applyRuntimeSettings(env, file);
    expect(env.CTX_FETCH_STRICT).toBe("1");
    expect(env.CONTEXT_MODE_TZ).toBe("UTC");
    expect(env.PI_CONTEXT_MODE_SETTINGS_PROJECTED).toBeUndefined();
  });

  it("X3/X7: absent or corrupt file changes nothing and never throws", () => {
    const env: NodeJS.ProcessEnv = {};
    expect(() => applyRuntimeSettings(env, file)).not.toThrow();
    put("{not json");
    expect(() => applyRuntimeSettings(env, file)).not.toThrow();
    expect(env).toEqual({});
  });

  it("invalid entries are skipped individually", () => {
    put({ "search.blockAfter": -1, "search.windowMs": 30000 });
    const env: NodeJS.ProcessEnv = {};
    applyRuntimeSettings(env, file);
    expect(env.CONTEXT_MODE_SEARCH_BLOCK_AFTER).toBeUndefined();
    expect(env.CONTEXT_MODE_SEARCH_WINDOW_MS).toBe("30000");
  });

  it("a nested session re-reads names an ancestor bridge projected", () => {
    put({ "search.windowMs": 45000 });
    const env: NodeJS.ProcessEnv = {
      CONTEXT_MODE_SEARCH_WINDOW_MS: "30000",
      CTX_FETCH_STRICT: "1",
      PI_CONTEXT_MODE_SETTINGS_PROJECTED: "CONTEXT_MODE_SEARCH_WINDOW_MS,CTX_FETCH_STRICT",
    };
    applyRuntimeSettings(env, file);
    expect(env.CONTEXT_MODE_SEARCH_WINDOW_MS).toBe("45000");
    expect(env.CTX_FETCH_STRICT).toBeUndefined();
    expect(env.PI_CONTEXT_MODE_SETTINGS_PROJECTED).toBe("CONTEXT_MODE_SEARCH_WINDOW_MS");
  });
});
