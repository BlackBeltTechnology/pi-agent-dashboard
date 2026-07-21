import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_GRAMMAR, loadConfig } from "../config.js";

describe("loadConfig — grammar block", () => {
  let testDir: string;
  let configFile: string;
  let origHome: string;

  beforeEach(() => {
    testDir = path.join(
      os.tmpdir(),
      `test-config-grammar-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    fs.mkdirSync(path.join(testDir, ".pi", "dashboard"), { recursive: true });
    configFile = path.join(testDir, ".pi", "dashboard", "config.json");
    origHome = process.env.HOME!;
    process.env.HOME = testDir;
  });

  afterEach(() => {
    process.env.HOME = origHome;
    if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true });
  });

  it("yields the disabled default when the grammar block is absent", () => {
    fs.writeFileSync(configFile, JSON.stringify({ port: 8000 }));
    const cfg = loadConfig();
    expect(cfg.grammar).toEqual(DEFAULT_GRAMMAR);
    expect(cfg.grammar.enabled).toBe(false);
    expect(cfg.grammar.backend).toBe("languagetool");
    expect(cfg.grammar.autoCheck).toBe(true);
    expect(cfg.grammar.debounceMs).toBe(1200);
    expect(cfg.grammar.minChars).toBe(12);
    expect(cfg.grammar.maxChars).toBe(4000);
    expect(cfg.grammar.language).toBe("auto");
    expect(cfg.grammar.languagetool.url).toBe("http://localhost:8081");
    expect(cfg.grammar.llm).toBeUndefined();
  });

  it("returns default when grammar is not an object", () => {
    fs.writeFileSync(configFile, JSON.stringify({ grammar: "on" }));
    expect(loadConfig().grammar).toEqual(DEFAULT_GRAMMAR);
  });

  it("preserves valid explicit values", () => {
    fs.writeFileSync(
      configFile,
      JSON.stringify({
        grammar: {
          enabled: true,
          backend: "llm",
          autoCheck: false,
          debounceMs: 2000,
          minChars: 20,
          maxChars: 8000,
          language: "hu-HU",
          languagetool: { url: "http://lt.local:8010" },
          llm: { provider: "anthropic", model: "claude-haiku-4-5" },
        },
      }),
    );
    const g = loadConfig().grammar;
    expect(g.enabled).toBe(true);
    expect(g.backend).toBe("llm");
    expect(g.autoCheck).toBe(false);
    expect(g.debounceMs).toBe(2000);
    expect(g.minChars).toBe(20);
    expect(g.maxChars).toBe(8000);
    expect(g.language).toBe("hu-HU");
    expect(g.languagetool.url).toBe("http://lt.local:8010");
    expect(g.llm).toEqual({ provider: "anthropic", model: "claude-haiku-4-5" });
  });

  it("clamps out-of-range numerics", () => {
    fs.writeFileSync(
      configFile,
      JSON.stringify({
        grammar: { debounceMs: 50, minChars: 9999, maxChars: 999999 },
      }),
    );
    const g = loadConfig().grammar;
    expect(g.debounceMs).toBe(300);
    expect(g.minChars).toBe(500);
    expect(g.maxChars).toBe(20000);
  });

  it("clamps low maxChars up to the floor", () => {
    fs.writeFileSync(configFile, JSON.stringify({ grammar: { maxChars: 1 } }));
    expect(loadConfig().grammar.maxChars).toBe(100);
  });

  it("falls back to languagetool on an invalid backend", () => {
    fs.writeFileSync(configFile, JSON.stringify({ grammar: { backend: "wizard" } }));
    expect(loadConfig().grammar.backend).toBe("languagetool");
  });

  it("ignores a malformed llm block", () => {
    fs.writeFileSync(
      configFile,
      JSON.stringify({ grammar: { llm: { provider: "anthropic" } } }),
    );
    expect(loadConfig().grammar.llm).toBeUndefined();
  });

  it("ignores unknown keys in the grammar block", () => {
    fs.writeFileSync(
      configFile,
      JSON.stringify({ grammar: { enabled: true, nonsense: 42 } }),
    );
    const g = loadConfig().grammar;
    expect(g.enabled).toBe(true);
    expect((g as unknown as Record<string, unknown>).nonsense).toBeUndefined();
  });

  it("defaults languagetool.url when blank", () => {
    fs.writeFileSync(
      configFile,
      JSON.stringify({ grammar: { languagetool: { url: "  " } } }),
    );
    expect(loadConfig().grammar.languagetool.url).toBe("http://localhost:8081");
  });

  it("round-trips through load → stringify → load", () => {
    fs.writeFileSync(
      configFile,
      JSON.stringify({ grammar: { enabled: true, backend: "llm", debounceMs: 1500 } }),
    );
    const first = loadConfig();
    fs.writeFileSync(configFile, JSON.stringify(first));
    const second = loadConfig();
    expect(second.grammar.enabled).toBe(true);
    expect(second.grammar.backend).toBe("llm");
    expect(second.grammar.debounceMs).toBe(1500);
  });
});
