import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const BIN = new URL("../../../../bin/deck3d", import.meta.url).pathname;

/** X1 — no usable browser: parse fails with an install hint naming chromium. */
describe("harvest: no browser (X1)", () => {
  it("exits non-zero with the chromium install command", () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-x1-"));
    writeFileSync(join(dir, "deck.md"), "# Diagram\n\n```mermaid\nflowchart TD\n  A --> B\n```\n");
    const empty = mkdtempSync(join(tmpdir(), "deck3d-browsers-"));
    const r = spawnSync(BIN, ["parse", "deck.md", "-o", "out.json"], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: empty },
    });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("chromium");
    expect(r.stderr).toContain("npx playwright install chromium");
  }, 60_000);
});
