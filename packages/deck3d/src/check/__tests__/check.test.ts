import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { chromiumAvailable } from "../../__tests__/helpers/chromium.js";
import { makeLocalDeck, runCli as runDeckCli } from "../../__tests__/helpers/local-fx.js";
import { NON_DETERMINISTIC_RULES } from "../index.js";
import type { DeckIR } from "../../ir/types.js";
import { deriveDeckIR } from "../../parse/derive.js";
import { harvestDiagram } from "../../parse/harvest/index.js";
import { parseMarkdown } from "../../parse/markdown.js";
import { ensureRuntime, renderDeck } from "../../render/index.js";

const hasChromium = await chromiumAvailable();
const BIN = new URL("../../../bin/deck3d", import.meta.url).pathname;
const FIXTURE = readFileSync(new URL("../../../fixtures/harvest.md", import.meta.url), "utf8");

async function writeHtml(overrides: DeckIR["overrides"] = {}): Promise<string> {
  const { ir } = await deriveDeckIR(parseMarkdown(FIXTURE), { harvest: (s, id) => harvestDiagram(s, id) });
  ir.overrides = { ...ir.overrides, ...overrides };
  const html = renderDeck(ir, { runtime: await ensureRuntime() });
  const path = join(mkdtempSync(join(tmpdir(), "deck3d-check-")), "deck.html");
  writeFileSync(path, html);
  return path;
}

function runCheck(html: string, args: string[], cwd: string) {
  return spawnSync(BIN, ["check", html, ...args], { cwd, encoding: "utf8" });
}

describe.skipIf(!hasChromium)("deck3d check (chromium)", () => {
  it("evaluates the default two viewports and groups the report by viewport (E41)", async () => {
    const html = await writeHtml();
    const dir = mkdtempSync(join(tmpdir(), "deck3d-check-out-"));
    const r = runCheck(html, ["-o", "report.json"], dir);
    const report = JSON.parse(readFileSync(join(dir, "report.json"), "utf8"));
    expect(report.viewports.map((v: { viewport: string }) => v.viewport)).toEqual(["1920x1080", "1280x720"]);

    const explicit = runCheck(html, ["--viewport", "1920x1080", "-o", "one.json"], dir);
    const one = JSON.parse(readFileSync(join(dir, "one.json"), "utf8"));
    expect(one.viewports).toHaveLength(1);
    expect(one.viewports[0].viewport).toBe("1920x1080");
    void r;
    void explicit;
  }, 180_000);

  it("reports an oversized flowchart as a fit error with a diagram.scale suggestion", async () => {
    const html = await writeHtml({ slides: { rendszer: { diagram: { scale: 2.5 } } } });
    const dir = mkdtempSync(join(tmpdir(), "deck3d-check-out-"));
    const r = runCheck(html, ["--viewport", "1920x1080", "--slide", "1", "-o", "report.json"], dir);
    expect(r.status).not.toBe(0);
    const report = JSON.parse(readFileSync(join(dir, "report.json"), "utf8"));
    const fit = report.viewports[0].findings.find((f: { rule: string }) => f.rule === "fit");
    expect(fit).toBeTruthy();
    expect(fit.severity).toBe("error");
    expect(fit.suggest).toBe('overrides.slides["rendszer"].diagram.scale');
    expect(r.stderr).toContain("error fit slide 1");
  }, 120_000);

  it("exits 0 on warnings and non-zero with --strict (legibility promotion)", async () => {
    const html = await writeHtml({ slides: { rendszer: { labels: { size: 0.01 }, diagram: { scale: 0.5 } } } });
    const dir = mkdtempSync(join(tmpdir(), "deck3d-check-out-"));
    const lenient = runCheck(html, ["--viewport", "1920x1080", "--slide", "1"], dir);
    expect(lenient.stderr).toContain("warn legibility");
    expect(lenient.status, lenient.stderr).toBe(0);

    const strict = runCheck(html, ["--viewport", "1920x1080", "--slide", "1", "--strict"], dir);
    expect(strict.status).not.toBe(0);
  }, 180_000);

  it("build runs check but only --strict fails on findings (7c.4)", () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-build-check-"));
    writeFileSync(join(dir, "harvest.md"), FIXTURE);
    const lenient = spawnSync(BIN, ["build", "harvest.md", "-o", "a.html"], { cwd: dir, encoding: "utf8" });
    expect(lenient.stdout).toContain("wrote a.html");
    expect(lenient.status, lenient.stderr).toBe(0);
    expect(readFileSync(join(dir, "a.html"), "utf8")).toContain("window.__DECK=");

    const strict = spawnSync(BIN, ["build", "harvest.md", "-o", "b.html", "--strict"], { cwd: dir, encoding: "utf8" });
    expect(strict.status).not.toBe(0);
  }, 180_000);
});

/**
 * test-plan #X6 — the report stays byte-stable. `contrast` (pixels) and
 * `local-fx-network` (request timing) are the declared exceptions; everything
 * else, including `local-fx-error`, must be identical run to run.
 */
describe.skipIf(!hasChromium)("X6 report byte-equality excludes only the declared rules", () => {
  it("produces identical JSON across two runs once the volatile rules are stripped", () => {
    const src = 'export default function (ctx, params) { throw new Error("boom"); }\n';
    const { dir } = makeLocalDeck({ effects: [{ name: "x", src }] }, "deck3d-x6-");
    expect(runDeckCli(["render", "deck.json", "-o", "deck.html"], dir).status).toBe(0);

    const runOnce = (out: string): string => {
      runDeckCli(["check", "deck.html", "-o", out], dir);
      const report = JSON.parse(readFileSync(join(dir, out), "utf8")) as {
        viewports: Array<{ viewport: string; findings: Array<{ rule: string }> }>;
      };
      for (const v of report.viewports) {
        v.findings = v.findings.filter((f) => !NON_DETERMINISTIC_RULES.includes(f.rule as never));
      }
      return JSON.stringify(report);
    };

    const a = runOnce("a.json");
    expect(a).toBe(runOnce("b.json"));
    // The deterministic class really does still carry the local-fx error.
    expect(a).toContain("local-fx-error");
  }, 240_000);
});
