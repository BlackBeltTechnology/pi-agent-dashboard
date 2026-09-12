/**
 * Unit tests for the e2e-only `compaction.keepRecentTokens` settings seed.
 *
 * The merge decision + the file wrapper's two fault cases are the parts a
 * prompt cannot reach (mirrors seed-settings-default-model.test.mjs).
 *
 * See change: replay-compaction-boundary.
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULE = path.resolve(__dirname, "..", "seed-settings-compaction.mjs");
const { mergeE2ECompaction, seedFile, E2E_KEEP_RECENT_TOKENS } = await import(MODULE);

function tmpDir() {
  return mkdtempSync(path.join(os.tmpdir(), "pi-seed-compaction-"));
}

describe("mergeE2ECompaction decision-table", () => {
  it("absent settings → sets compaction.keepRecentTokens, changed=true", () => {
    const { cfg, changed } = mergeE2ECompaction({});
    expect(cfg).toEqual({ compaction: { keepRecentTokens: E2E_KEEP_RECENT_TOKENS } });
    expect(changed).toBe(true);
  });

  it("preserves sibling compaction keys (enabled/reserveTokens)", () => {
    const { cfg } = mergeE2ECompaction({ compaction: { enabled: true, reserveTokens: 42 } });
    expect(cfg.compaction).toEqual({
      enabled: true,
      reserveTokens: 42,
      keepRecentTokens: E2E_KEEP_RECENT_TOKENS,
    });
  });

  it("never clobbers an existing keepRecentTokens", () => {
    const input = { compaction: { keepRecentTokens: 1234 } };
    const { cfg, changed } = mergeE2ECompaction(input);
    expect(changed).toBe(false);
    expect(cfg).toBe(input);
  });

  it("keeps unrelated top-level keys (defaultProvider/defaultModel)", () => {
    const { cfg } = mergeE2ECompaction({ defaultProvider: "faux", defaultModel: "faux-1" });
    expect(cfg.defaultProvider).toBe("faux");
    expect(cfg.defaultModel).toBe("faux-1");
  });
});

describe("seedFile file wrapper", () => {
  it("present-but-unparseable file left untouched, no overwrite", () => {
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

  it("absent path treated as fresh → writes the compaction key, no throw", () => {
    const dir = tmpDir();
    try {
      const p = path.join(dir, "nested", "settings.json");
      expect(existsSync(p)).toBe(false);
      seedFile(p);
      expect(JSON.parse(readFileSync(p, "utf8"))).toEqual({
        compaction: { keepRecentTokens: E2E_KEEP_RECENT_TOKENS },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("no-op when already seeded: wrapper writes nothing new", () => {
    const dir = tmpDir();
    try {
      const p = path.join(dir, "settings.json");
      const raw = `${JSON.stringify({ compaction: { keepRecentTokens: 7 } }, null, 2)}\n`;
      writeFileSync(p, raw);
      seedFile(p);
      expect(readFileSync(p, "utf8")).toBe(raw);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
