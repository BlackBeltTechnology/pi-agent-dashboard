/**
 * Unit tests for the split defaultProvider+defaultModel settings seed.
 *
 * Covers (test-plan split-faux-seed-default-provider):
 *   - mergeDefaultModel decision-table: E1 split-shape, E2 normalize legacy
 *     combined, E3 idempotent no-op, E4 no-clobber slash-bearing bare id,
 *     E5 provider-set model-absent, E6 split on FIRST slash.
 *   - seedFile fault cases: X1 corrupt file untouched, X2 absent-file fresh write.
 *
 * See change: split-faux-seed-default-provider.
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULE = path.resolve(__dirname, "..", "seed-settings-default-model.mjs");
const { mergeDefaultModel, seedFile } = await import(MODULE);

function tmpDir() {
  return mkdtempSync(path.join(os.tmpdir(), "pi-seed-"));
}

describe("mergeDefaultModel decision-table", () => {
  it("E1: absent settings (cfg={}) → pins split faux/faux-1, changed=true", () => {
    const { cfg, changed } = mergeDefaultModel({});
    expect(cfg).toEqual({ defaultProvider: "faux", defaultModel: "faux-1" });
    expect(changed).toBe(true);
  });

  it("E2: legacy combined defaultModel, no provider → normalized split, no slash remains", () => {
    const { cfg, changed } = mergeDefaultModel({ defaultModel: "faux/faux-1" });
    expect(cfg.defaultProvider).toBe("faux");
    expect(cfg.defaultModel).toBe("faux-1");
    expect(cfg.defaultModel).not.toContain("/");
    expect(changed).toBe(true);
  });

  it("E3: already split → changed=false, object reference unchanged", () => {
    const input = { defaultProvider: "faux", defaultModel: "faux-1" };
    const { cfg, changed } = mergeDefaultModel(input);
    expect(changed).toBe(false);
    expect(cfg).toBe(input);
  });

  it("E4: provider set + slash-bearing bare id → no-clobber, model NOT split", () => {
    const { cfg, changed } = mergeDefaultModel({
      defaultProvider: "openrouter",
      defaultModel: "anthropic/claude-3.5",
    });
    expect(changed).toBe(false);
    expect(cfg.defaultModel).toBe("anthropic/claude-3.5");
  });

  it("E5: provider set, model absent → not faux-filled", () => {
    const { cfg, changed } = mergeDefaultModel({ defaultProvider: "anthropic" });
    expect(changed).toBe(false);
    expect(cfg.defaultModel).toBeUndefined();
  });

  it("E6: split on FIRST slash only", () => {
    const { cfg, changed } = mergeDefaultModel({ defaultModel: "a/b/c" });
    expect(cfg.defaultProvider).toBe("a");
    expect(cfg.defaultModel).toBe("b/c");
    expect(changed).toBe(true);
  });
});

describe("seedFile file wrapper", () => {
  it("X1: present-but-unparseable file left untouched, no overwrite", () => {
    const dir = tmpDir();
    try {
      const p = path.join(dir, "settings.json");
      const raw = "{not json";
      writeFileSync(p, raw);
      seedFile(p);
      expect(readFileSync(p, "utf8")).toBe(raw);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("X2: absent path treated as fresh → writes split keys, no throw", () => {
    const dir = tmpDir();
    try {
      const p = path.join(dir, "nested", "settings.json");
      expect(existsSync(p)).toBe(false);
      seedFile(p);
      const cfg = JSON.parse(readFileSync(p, "utf8"));
      expect(cfg).toEqual({ defaultProvider: "faux", defaultModel: "faux-1" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("no-op when already split: wrapper writes nothing new", () => {
    const dir = tmpDir();
    try {
      const p = path.join(dir, "settings.json");
      const raw = `${JSON.stringify({ defaultProvider: "faux", defaultModel: "faux-1" }, null, 2)}\n`;
      writeFileSync(p, raw);
      seedFile(p);
      expect(readFileSync(p, "utf8")).toBe(raw);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
