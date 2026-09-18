/**
 * E1 (task 10.1) — ir: Parse is deterministic.
 *
 * `fixtures/strategy-lab.md` (7 slides, 2 mermaid) parsed twice yields a
 * byte-identical `deck.json`, and the IR carries no volatile keys (no
 * timestamps, no host-specific paths). The mermaid harvest needs chromium, so
 * the whole suite is self-skipping without a browser.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { chromiumAvailable } from "../../__tests__/helpers/chromium.js";

const BIN = new URL("../../../bin/deck3d", import.meta.url).pathname;
const FIXTURE = new URL("../../../fixtures/strategy-lab.md", import.meta.url);
const hasChromium = await chromiumAvailable();

function runCli(args: string[], cwd: string) {
  return spawnSync(BIN, args, { cwd, encoding: "utf8" });
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** Visit every (key, value) pair anywhere in a JSON tree. */
function walk(value: unknown, visit: (key: string, value: unknown) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      visit(key, child);
      walk(child, visit);
    }
  }
}

describe.skipIf(!hasChromium)("E1 parse determinism (chromium)", () => {
  it("parses strategy-lab twice byte-identically with no volatile keys", () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-e1-"));
    copyFileSync(FIXTURE, join(dir, "strategy-lab.md"));

    const first = runCli(["parse", "strategy-lab.md", "-o", "a.json"], dir);
    expect(first.status, first.stderr).toBe(0);
    const second = runCli(["parse", "strategy-lab.md", "-o", "b.json"], dir);
    expect(second.status, second.stderr).toBe(0);

    const a = join(dir, "a.json");
    const b = join(dir, "b.json");
    expect(sha256(a)).toBe(sha256(b));

    const ir = JSON.parse(readFileSync(a, "utf8")) as Record<string, unknown>;
    expect(ir.slides).toHaveLength(7);

    const pairs: Array<{ key: string; value: unknown }> = [];
    walk(ir, (key, value) => pairs.push({ key, value }));

    // Spec: the IR carries no timestamps/random ids/host-specific paths.
    // `path` is the documented edge-geometry key (`slides[].diagram.edges[].path`,
    // an array of [x, y] samples) — the one legitimate `path` key in the schema.
    const volatile = pairs.filter(({ key }) => /time|date|path|Date/.test(key));
    expect(volatile.filter(({ key }) => key !== "path")).toEqual([]);
    for (const { key, value } of volatile.filter(({ key }) => key === "path")) {
      expect(Array.isArray(value), `edge geometry ${key}`).toBe(true);
    }

    // No string value is a host-specific absolute path (e.g. `meta.source`).
    const absolute = pairs.filter(({ value }) => typeof value === "string" && value.startsWith("/"));
    expect(absolute).toEqual([]);

    // The mermaid engine pin is recorded for the determinism contract.
    expect((ir.meta as Record<string, unknown>).mermaid).toBe("11.17.2");
  }, 120_000);
});
