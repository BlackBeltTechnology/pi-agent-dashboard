import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { chromiumAvailable } from "../../../__tests__/helpers/chromium.js";

const BIN = new URL("../../../../bin/deck3d", import.meta.url).pathname;
const FIXTURES = new URL("../../../../fixtures", import.meta.url).pathname;
const hasChromium = await chromiumAvailable();

function runCli(args: string[], cwd: string) {
  return spawnSync(BIN, args, { cwd, encoding: "utf8" });
}

function workDirWith(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), "deck3d-harvest-cli-"));
  cpSync(join(FIXTURES, name), join(dir, name));
  return dir;
}

describe.skipIf(!hasChromium)("harvest via the CLI (chromium)", () => {
  it("parses a flowchart + sequence deck into a deterministic, timestamp-free deck.json", () => {
    const dir = workDirWith("harvest.md");
    const first = runCli(["parse", "harvest.md", "-o", "a.json"], dir);
    expect(first.status, first.stderr).toBe(0);
    const second = runCli(["parse", "harvest.md", "-o", "b.json"], dir);
    expect(second.status, second.stderr).toBe(0);

    const a = readFileSync(join(dir, "a.json"), "utf8");
    const b = readFileSync(join(dir, "b.json"), "utf8");
    expect(a).toBe(b);
    // No nondeterministic fields: no clock keys anywhere, no path/date in meta.
    expect(a).not.toMatch(/"(?:time|timestamp|date|Date|now)"\s*:/);
    const ir = JSON.parse(a);
    expect(ir.meta).not.toHaveProperty("time");
    expect(ir.meta).not.toHaveProperty("date");
    expect(ir.slides[0].diagram.kind).toBe("flowchart");
    expect(ir.slides[1].diagram.kind).toBe("sequence");
  }, 120_000);

  it("warns on an unsupported diagram type and still exits 0", () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-harvest-cli-"));
    writeFileSync(join(dir, "plan.md"), "# Ütemterv\n\n```mermaid\ngantt\n  title x\n  section s\n  task t: 1, 2\n```\n");
    const r = runCli(["parse", "plan.md", "-o", "out.json"], dir);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).toContain("warn unsupported diagram gantt slide");
    const ir = JSON.parse(readFileSync(join(dir, "out.json"), "utf8"));
    expect(ir.slides[0].diagram).toEqual({ kind: "none" });
  }, 120_000);
});
