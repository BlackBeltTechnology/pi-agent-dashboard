/**
 * X3 — harvest: syntax error in a supported type (#X3, 10.66).
 *
 * Observable: `parse` exits non-zero naming the slide id and the mermaid error
 * text, and writes no `deck.json`.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { chromiumAvailable } from "../../../__tests__/helpers/chromium.js";

const BIN = new URL("../../../../bin/deck3d", import.meta.url).pathname;
const hasChromium = await chromiumAvailable();

/** Truncated edge: mermaid cannot parse `A --> ` with nothing after it. */
const MERMAID = ["flowchart TD", "  A --> "].join("\n");
const SLIDE_ID = "broken";

describe.skipIf(!hasChromium)("harvest: syntax error in a supported type (X3)", () => {
  it("exits non-zero with the slide id and mermaid's error text, writing no deck.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-harvest-x3-"));
    writeFileSync(join(dir, "broken.md"), `# Broken\n\n\`\`\`mermaid\n${MERMAID}\n\`\`\`\n`);
    const r = spawnSync(BIN, ["parse", "broken.md", "-o", "out.json"], { cwd: dir, encoding: "utf8" });

    expect(r.status, r.stderr).not.toBe(0);
    expect(r.stderr).toContain(`"${SLIDE_ID}"`);
    // Mermaid's own parse error, not a generic wrapper message.
    expect(r.stderr).toMatch(/Parse error on line \d+:/);
    expect(r.stderr).toContain("Expecting");
    // A failed harvest must not leave a partial deck.json behind.
    expect(existsSync(join(dir, "out.json"))).toBe(false);
  }, 90_000);
});
