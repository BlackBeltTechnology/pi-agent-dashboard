/**
 * E18 — harvest: unsupported type (#E18, 10.18).
 *
 * Observable: a ```mermaid `gantt` slide still exits 0, its `diagram.kind` is
 * `none`, and stderr carries `warn unsupported diagram gantt slide <id>`.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Diagram } from "../../../ir/types.js";
import { chromiumAvailable } from "../../../__tests__/helpers/chromium.js";

const BIN = new URL("../../../../bin/deck3d", import.meta.url).pathname;
const hasChromium = await chromiumAvailable();

const MERMAID = ["gantt", "  title x", "  section s", "  task t: 1, 2"].join("\n");
const SLIDE_ID = "plan";

describe.skipIf(!hasChromium)("harvest: unsupported type (E18)", () => {
  it("warns, keeps `diagram: none` and exits 0", () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-harvest-e18-"));
    writeFileSync(join(dir, "plan.md"), `# Plan\n\n\`\`\`mermaid\n${MERMAID}\n\`\`\`\n`);
    const r = spawnSync(BIN, ["parse", "plan.md", "-o", "plan.json"], { cwd: dir, encoding: "utf8" });

    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).toContain(`warn unsupported diagram gantt slide ${SLIDE_ID}`);

    const diagram = (JSON.parse(readFileSync(join(dir, "plan.json"), "utf8")) as {
      slides: Array<{ id: string; diagram: Diagram }>;
    }).slides.find((s) => s.id === SLIDE_ID)?.diagram;
    expect(diagram).toEqual({ kind: "none" });
  }, 90_000);
});
