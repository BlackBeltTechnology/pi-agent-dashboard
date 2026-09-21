/**
 * E43 (task 10.43) — skill: Grammar error (triple).
 *
 * An inline `<!-- deck3d: ... -->` comment whose body is not valid JSON must
 * make `parse` exit non-zero, naming the offending slide id and the JSON error
 * position — so the agent can fix the line instead of guessing.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const BIN = new URL("../../bin/deck3d", import.meta.url).pathname;

function runCli(args: string[], cwd: string) {
  return spawnSync(BIN, args, { cwd, encoding: "utf8" });
}

const MD = `# Intro

<!-- deck3d: {mode: light} -->

- one
`;

describe("E43 markdown grammar — invalid inline override JSON", () => {
  it("parse exits non-zero naming the slide id and the JSON error position", () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-e43-"));
    writeFileSync(join(dir, "talk.md"), MD);

    const r = runCli(["parse", "talk.md", "-o", "deck.json"], dir);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/slide "intro"/);
    expect(r.stderr).toMatch(/position \d+/);
  });
});
