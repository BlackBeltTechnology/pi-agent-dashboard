/**
 * mermaidRepair config block parse (test-plan #E1–#E5).
 * See change: add-mermaid-ai-repair.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig, parseMermaidRepairConfig } from "../config.js";

let tmpHome: string;
let realHome: string;

beforeEach(() => {
  tmpHome = mkdtempSync(path.join(os.tmpdir(), "mrepair-cfg-"));
  realHome = process.env.HOME ?? "";
  process.env.HOME = tmpHome;
});

afterEach(() => {
  process.env.HOME = realHome;
  rmSync(tmpHome, { recursive: true, force: true });
});

function seed(config: Record<string, unknown>): void {
  const p = path.join(tmpHome, ".pi", "dashboard", "config.json");
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(config));
}

describe("parseMermaidRepairConfig", () => {
  it("E1: absent block resolves to disabled defaults without throwing", () => {
    expect(parseMermaidRepairConfig(undefined)).toEqual({ enabled: false, maxChars: 20000, timeoutMs: 30000 });
    seed({});
    expect(loadConfig().mermaidRepair).toEqual({ enabled: false, maxChars: 20000, timeoutMs: 30000 });
  });

  it("E2: maxChars is clamped 1000–50000", () => {
    const got = [999, 1000, 20000, 50000, 50001, 999999].map(
      (maxChars) => parseMermaidRepairConfig({ maxChars }).maxChars,
    );
    expect(got).toEqual([1000, 1000, 20000, 50000, 50000, 50000]);
  });

  it("E3: timeoutMs is clamped 5000–120000", () => {
    const got = [10, 4999, 5000, 120000, 120001].map((timeoutMs) => parseMermaidRepairConfig({ timeoutMs }).timeoutMs);
    expect(got).toEqual([5000, 5000, 5000, 120000, 120000]);
  });

  it("E4: wrong types fall back to defaults and unknown fields are dropped", () => {
    expect(parseMermaidRepairConfig("str")).toEqual({ enabled: false, maxChars: 20000, timeoutMs: 30000 });
    const r = parseMermaidRepairConfig({ enabled: "yes", model: 42, maxChars: "big", foo: 1 });
    expect(r).toEqual({ enabled: false, maxChars: 20000, timeoutMs: 30000 });
    expect("foo" in r).toBe(false);
  });

  it("E5: enable decision table", () => {
    expect(parseMermaidRepairConfig({ enabled: true })).toMatchObject({ enabled: false, disabledReason: "no_model" });
    expect(parseMermaidRepairConfig({ enabled: true, model: "@fast" })).toMatchObject({
      enabled: false,
      disabledReason: "role_refs_unsupported",
    });
    const ok = parseMermaidRepairConfig({ enabled: true, model: "openrouter/x:free" });
    expect(ok.enabled).toBe(true);
    expect(ok.model).toBe("openrouter/x:free");
    expect(ok.disabledReason).toBeUndefined();
    const off = parseMermaidRepairConfig({ enabled: false, model: "a/b" });
    expect(off.enabled).toBe(false);
    expect(off.disabledReason).toBeUndefined();
  });
});
