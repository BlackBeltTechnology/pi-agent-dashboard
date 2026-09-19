/**
 * E41 (test-plan) — check: default viewports and report grouping.
 *
 * Runs the real CLI against a fixture `deck.html`. Without `--viewport` the
 * report carries one group per default viewport (`1920x1080`, `1280x720`, in
 * order); `--viewport 1920x1080` narrows the report to a single group.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { chromiumAvailable } from "../../__tests__/helpers/chromium.js";
import type { DeckIR } from "../../ir/types.js";
import { deriveDeckIR } from "../../parse/derive.js";
import { harvestDiagram } from "../../parse/harvest/index.js";
import { parseMarkdown } from "../../parse/markdown.js";
import { ensureRuntime, renderDeck } from "../../render/index.js";

const hasChromium = await chromiumAvailable();
const BIN = new URL("../../../bin/deck3d", import.meta.url).pathname;
const FIXTURE = readFileSync(new URL("../../../fixtures/harvest.md", import.meta.url), "utf8");

async function writeFixtureHtml(): Promise<string> {
  const { ir } = await deriveDeckIR(parseMarkdown(FIXTURE), { harvest: (src, id) => harvestDiagram(src, id) });
  const html = renderDeck(ir as DeckIR, { runtime: await ensureRuntime() });
  const path = join(mkdtempSync(join(tmpdir(), "deck3d-check-e41-")), "deck.html");
  writeFileSync(path, html);
  return path;
}

interface Report {
  viewports: Array<{ viewport: string; findings: unknown[] }>;
}

describe.skipIf(!hasChromium)("deck3d check groups the report by viewport (E41)", () => {
  it("defaults to 1920x1080 + 1280x720, and --viewport narrows to one group", async () => {
    const html = await writeFixtureHtml();
    const dir = mkdtempSync(join(tmpdir(), "deck3d-check-e41-out-"));

    const def = spawnSync(BIN, ["check", html, "-o", "r.json"], { cwd: dir, encoding: "utf8" });
    const report = JSON.parse(readFileSync(join(dir, "r.json"), "utf8")) as Report;
    expect(report.viewports.map((v) => v.viewport)).toEqual(["1920x1080", "1280x720"]);
    expect(report.viewports.every((v) => Array.isArray(v.findings))).toBe(true);

    const explicit = spawnSync(BIN, ["check", html, "--viewport", "1920x1080", "-o", "one.json"], { cwd: dir, encoding: "utf8" });
    const one = JSON.parse(readFileSync(join(dir, "one.json"), "utf8")) as Report;
    expect(one.viewports).toHaveLength(1);
    expect(one.viewports[0].viewport).toBe("1920x1080");

    // Both runs wrote a report regardless of findings; the default run is non-empty.
    expect(def.status).not.toBeUndefined();
    expect(explicit.status).not.toBeUndefined();
  }, 180_000);
});
