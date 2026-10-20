/**
 * Read/write IO tests against a temp dir (spec: "Read effective config",
 * "Write the full resolved config"). See change: add-hermes-memory-settings-plugin,
 * resync-hermes-memory-config-0-9 (test-plan E8–E11, F2, X1–X4).
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { legacyFile, noTouchBody } from "../../__tests__/hermes-fixtures.js";
import { upstreamHermes, upstreamLoadConfig } from "../../__tests__/upstream-hermes.js";
import { HermesConfigError, readEffectiveConfig, writeResolvedConfig } from "../config-io.js";

let dir: string;
let file: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-io-"));
  file = path.join(dir, "hermes-memory-config.json");
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("readEffectiveConfig", () => {
  it("reports exists:false and all defaults when the file is absent", () => {
    const eff = readEffectiveConfig(file);
    expect(eff.exists).toBe(false);
    expect(eff.fields.nudgeInterval).toEqual({ value: 10, default: 10, isDefault: true });
    expect(eff.fields.memoryMode.isDefault).toBe(true);
    expect(Object.values(eff.fields).every((f) => f.isDefault)).toBe(true);
  });

  it("marks a present key as non-default and leaves others default", () => {
    fs.writeFileSync(file, JSON.stringify({ llmModelOverride: "anthropic/claude-haiku-4-5" }));
    const eff = readEffectiveConfig(file);
    expect(eff.exists).toBe(true);
    expect(eff.fields.llmModelOverride).toEqual({
      value: "anthropic/claude-haiku-4-5",
      default: undefined,
      isDefault: false,
    });
    expect(eff.fields.nudgeInterval.isDefault).toBe(true);
    expect(eff.raw.llmModelOverride).toBe("anthropic/claude-haiku-4-5");
  });

  it("treats a malformed file as present with all defaults", () => {
    fs.writeFileSync(file, "{ not valid json ");
    const eff = readEffectiveConfig(file);
    expect(eff.exists).toBe(true);
    expect(Object.values(eff.fields).every((f) => f.isDefault)).toBe(true);
    expect(eff.fields.nudgeInterval.value).toBe(10);
  });
});

describe("writeResolvedConfig", () => {
  it("creates the parent dir and writes pretty JSON", () => {
    const nested = path.join(dir, "deep", "nested", "hermes-memory-config.json");
    writeResolvedConfig(nested, { nudgeInterval: 7, reviewEnabled: false });
    const text = fs.readFileSync(nested, "utf-8");
    expect(text).toContain('"nudgeInterval": 7');
    expect(text.includes("\n  ")).toBe(true); // 2-space indent
  });

  it("leaves no partial/tmp file behind (atomic rename)", () => {
    writeResolvedConfig(file, { nudgeInterval: 3 });
    const leftovers = fs.readdirSync(dir).filter((f) => f.includes(".tmp"));
    expect(leftovers).toEqual([]);
    expect(JSON.parse(fs.readFileSync(file, "utf-8")).nudgeInterval).toBe(3);
  });

  it("round-trips: a subsequent read reports exists + the saved value", () => {
    writeResolvedConfig(file, { nudgeInterval: 42 });
    const eff = readEffectiveConfig(file);
    expect(eff.exists).toBe(true);
    expect(eff.fields.nudgeInterval).toEqual({ value: 42, default: 10, isDefault: false });
  });
});

// ── resync-hermes-memory-config-0-9 ───────────────────────────────────────────

const write = (obj: unknown) => fs.writeFileSync(file, JSON.stringify(obj));

describe("E8 GET reports 0.9.10 defaults", () => {
  it("consolidationTimeoutMs 180000 and all 12 new keys with their defaults", () => {
    const eff = readEffectiveConfig(file);
    expect(eff.fields.consolidationTimeoutMs).toEqual({ value: 180000, default: 180000, isDefault: true });
    const expected: Record<string, unknown> = {
      lazyInitialization: false,
      flushCompactTimeoutMs: 60000,
      quickCheckOnOpen: true,
      llmFallbackModels: undefined,
      overflowGraceMs: 180000,
      consolidationChunking: false,
      consolidationChunkChars: 4000,
      usageHitTrackingEnabled: true,
      consolidationUsageSignals: true,
      autoConsolidationWarnOnFailure: true,
      standingInstructionsEnabled: true,
      sessionRetentionDays: 0,
    };
    for (const [key, value] of Object.entries(expected)) {
      expect(eff.fields[key], key).toEqual({ value, default: value, isDefault: true });
    }
  });
});

describe("E9 raw carries unknown on-disk keys; fields do not", () => {
  it("raw has futureHermesKey + nudgeInterval; fields lacks futureHermesKey", () => {
    write({ futureHermesKey: 42, nudgeInterval: 3 });
    const eff = readEffectiveConfig(file);
    expect(eff.raw.futureHermesKey).toBe(42);
    expect(eff.raw.nudgeInterval).toBe(3);
    expect(Object.hasOwn(eff.fields, "futureHermesKey")).toBe(false);
  });
});

describe("E10 strategy ⇄ autoConsolidate derivation (upstream config.ts:234-237)", () => {
  const read = (obj: unknown) => {
    write(obj);
    const { fields } = readEffectiveConfig(file);
    return { strategy: fields.memoryOverflowStrategy, auto: fields.autoConsolidate };
  };
  it("(a) autoConsolidate:false alone → strategy reject, non-default", () => {
    expect(read({ autoConsolidate: false }).strategy).toMatchObject({ value: "reject", isDefault: false });
  });
  it("(b) autoConsolidate:true alone → strategy auto-consolidate, non-default", () => {
    expect(read({ autoConsolidate: true }).strategy).toMatchObject({ value: "auto-consolidate", isDefault: false });
  });
  it("(c) valid strategy wins → autoConsolidate derived false", () => {
    const r = read({ memoryOverflowStrategy: "reject", autoConsolidate: true });
    expect(r.strategy).toMatchObject({ value: "reject", isDefault: false });
    expect(r.auto).toMatchObject({ value: false, isDefault: false });
  });
  it("(d) strategy outside the enum → verbatim, no derivation", () => {
    const r = read({ memoryOverflowStrategy: "bogus", autoConsolidate: false });
    expect(r.strategy).toMatchObject({ value: "bogus", isDefault: false });
    expect(r.auto).toMatchObject({ value: false, isDefault: false });
  });
  it("(e) neither → both default", () => {
    const r = read({});
    expect(r.strategy).toMatchObject({ value: "auto-consolidate", isDefault: true });
    expect(r.auto).toMatchObject({ value: true, isDefault: true });
  });
});

describe("E11 array-form llmModelOverride + legacy fallback aliases (design D9)", () => {
  it("(a) padded array → trimmed primary + tail as fallbacks", () => {
    write({ llmModelOverride: [" a/b ", "c/d"] });
    const { fields } = readEffectiveConfig(file);
    expect(fields.llmModelOverride).toMatchObject({ value: "a/b", isDefault: false });
    expect(fields.llmFallbackModels).toMatchObject({ value: ["c/d"], isDefault: false });
  });
  it("(b) canonical ∪ llmModelFallbacks ∪ fallbackModels, deduped in upstream order; aliases stay in raw", () => {
    write({ llmModelOverride: ["a/b"], llmFallbackModels: ["c/d"], fallbackModels: ["e/f", "c/d"], llmModelFallbacks: ["g/h"] });
    const eff = readEffectiveConfig(file);
    expect(eff.fields.llmModelOverride.value).toBe("a/b");
    expect(eff.fields.llmFallbackModels).toMatchObject({ value: ["c/d", "g/h", "e/f"], isDefault: false });
    expect(eff.raw.fallbackModels).toEqual(["e/f", "c/d"]);
    expect(eff.raw.llmModelFallbacks).toEqual(["g/h"]);
  });
  it("(c) all-empty array → override unset", () => {
    write({ llmModelOverride: ["", ""] });
    expect(readEffectiveConfig(file).fields.llmModelOverride).toEqual({ value: undefined, default: undefined, isDefault: true });
  });
});

describe("X1–X4 malformed on-disk file is quarantined on PUT (design D3)", () => {
  const NOW = new Date("2026-10-20T08:09:10.123Z");
  const STAMPED = () => `${file}.corrupt-20261020T080910123Z`;

  it("X1 unparseable: exact bytes copied (0600, colon-free name), new object written, one log line without values", () => {
    const bytes = '{ "memoryMode": ';
    fs.writeFileSync(file, bytes);
    const logs: string[] = [];
    writeResolvedConfig(file, { nudgeInterval: 3 }, { now: () => NOW, log: (m) => logs.push(m) });
    expect(fs.readFileSync(STAMPED(), "utf-8")).toBe(bytes);
    expect(path.basename(STAMPED())).not.toContain(":");
    if (process.platform !== "win32") expect(fs.statSync(STAMPED()).mode & 0o777).toBe(0o600);
    expect(JSON.parse(fs.readFileSync(file, "utf-8"))).toEqual({ nudgeInterval: 3 });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain(STAMPED());
    expect(logs[0]).toContain("unparseable");
    expect(logs[0]).not.toMatch(/memoryMode|nudgeInterval/);
  });

  it.each([
    ["null", "not-an-object"],
    ["[]", "not-an-object"],
    ["42", "not-an-object"],
    ["", "unparseable"],
    ['\uFEFF{"nudgeInterval":3}', "unparseable"],
  ])("X2 %j → quarantined (%s)", (bytes, reason) => {
    fs.writeFileSync(file, bytes);
    // GET is tolerant: a BOM file reads all defaults, exactly as hermes sees it.
    expect(Object.values(readEffectiveConfig(file).fields).every((f) => f.isDefault)).toBe(true);
    const logs: string[] = [];
    writeResolvedConfig(file, { reviewEnabled: false }, { now: () => NOW, log: (m) => logs.push(m) });
    expect(fs.readFileSync(STAMPED(), "utf-8")).toBe(bytes);
    expect(logs[0]).toContain(reason);
    expect(JSON.parse(fs.readFileSync(file, "utf-8"))).toEqual({ reviewEnabled: false });
  });

  it("X3 never overwrites an existing backup: suffix -1", () => {
    fs.writeFileSync(file, "{ broken");
    fs.writeFileSync(STAMPED(), "older backup");
    writeResolvedConfig(file, { nudgeInterval: 3 }, { now: () => NOW });
    expect(fs.readFileSync(STAMPED(), "utf-8")).toBe("older backup");
    expect(fs.readFileSync(`${STAMPED()}-1`, "utf-8")).toBe("{ broken");
  });

  it("X4 failed copy → HermesConfigError quarantine failed / EACCES, config untouched, no tmp", () => {
    fs.writeFileSync(file, "{ broken");
    const denied = () => {
      throw Object.assign(new Error("denied"), { code: "EACCES" });
    };
    let caught: unknown;
    try {
      writeResolvedConfig(file, { nudgeInterval: 3 }, { now: () => NOW, writeQuarantine: denied });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(HermesConfigError);
    expect(caught).toMatchObject({ error: "hermes config quarantine failed", code: "EACCES" });
    expect(fs.readFileSync(file, "utf-8")).toBe("{ broken");
    expect(fs.readdirSync(dir).filter((f) => f.includes(".tmp"))).toEqual([]);
  });
});

const up = upstreamHermes();

describe("F2 no-touch save is effective-neutral under upstream loadConfig", () => {
  const cases: [string, Record<string, unknown>][] = [
    ["legacy 90000", legacyFile({ consolidationTimeoutMs: 90000 })],
    ["E10(a) autoConsolidate:false", { autoConsolidate: false }],
    ["E11(a) array override", { llmModelOverride: [" a/b ", "c/d"] }],
    [
      "E11(b) override + aliases",
      { llmModelOverride: ["a/b"], llmFallbackModels: ["c/d"], fallbackModels: ["e/f", "c/d"], llmModelFallbacks: ["g/h"] },
    ],
    ["strategy reject", { memoryOverflowStrategy: "reject" }],
    ["unknown + sessionSearch", { futureHermesKey: 1, sessionSearch: { variant: "anchors" } }],
  ];
  it.skipIf(!up).each(cases)("%s", async (_name, original) => {
    if (!up) return;
    const loadConfig = await upstreamLoadConfig(up);
    write(original);
    const before = loadConfig(file);
    writeResolvedConfig(file, noTouchBody(readEffectiveConfig(file)));
    expect(loadConfig(file)).toEqual(before);
  });
});
