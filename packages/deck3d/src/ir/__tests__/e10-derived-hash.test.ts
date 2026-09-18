/**
 * E10 (task 10.10) — ir: Edit outside overrides detected (`derivedHash`).
 *
 * Case A: editing a derived field (`slides[0].title`) makes `validate` warn
 * `edited outside overrides` (exit 0). Case B: editing inside
 * `overrides.slides[id].mode` does not.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const BIN = new URL("../../../bin/deck3d", import.meta.url).pathname;

function runCli(args: string[], cwd: string) {
  return spawnSync(BIN, args, { cwd, encoding: "utf8" });
}

function clone(deck: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(deck)) as Record<string, unknown>;
}

describe("E10 derivedHash detects edits outside overrides", () => {
  it("warns when a derived field is edited and stays silent for an override edit", () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-e10-"));
    writeFileSync(join(dir, "talk.md"), "# Intro\n\n- a\n");
    const parsed = runCli(["parse", "talk.md", "-o", "deck.json"], dir);
    expect(parsed.status, parsed.stderr).toBe(0);

    const deck = JSON.parse(readFileSync(join(dir, "deck.json"), "utf8")) as Record<string, unknown>;
    expect(typeof (deck.meta as Record<string, unknown>).derivedHash).toBe("string");

    // Case A — edit a derived field.
    const a = clone(deck);
    (a.slides as Array<Record<string, unknown>>)[0].title = "Edited Outside";
    writeFileSync(join(dir, "a.json"), JSON.stringify(a, null, 2));
    const va = runCli(["validate", "a.json"], dir);
    expect(va.status, va.stderr).toBe(0);
    expect(va.stderr).toMatch(/edited outside overrides/);

    // Case B — edit inside overrides only.
    const b = clone(deck);
    (b.overrides as Record<string, unknown>).slides = { intro: { mode: "light" } };
    writeFileSync(join(dir, "b.json"), JSON.stringify(b, null, 2));
    const vb = runCli(["validate", "b.json"], dir);
    expect(vb.status, vb.stderr).toBe(0);
    expect(vb.stderr).not.toMatch(/edited outside overrides/);
  });
});
