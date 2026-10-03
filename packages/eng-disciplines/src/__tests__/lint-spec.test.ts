/**
 * guard.mjs lint-spec — the built-in structural format gate (test-plan E21-E24).
 * See change: add-reverse-spec-for-rebuild.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { guard } from "./files";

const dir = mkdtempSync(join(tmpdir(), "rsfr-lint-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const OK = `# order-limits Specification

## Purpose

Checks an order total against a configured maximum.

## Requirements

### Requirement: Order total limit
The system SHALL reject an order whose total exceeds the maximum (BR-001).
<!-- cite: ref=src/orders.ts:12-18, confidence=confirmed -->

#### Scenario: Total above the limit
<!-- cite: ref=src/orders.ts:14-16, confidence=confirmed -->
- **WHEN** an order total is greater than the maximum
- **THEN** the order is rejected with \`ORDER_TOO_LARGE\`
<!-- cite: ref=src/orders.ts:15, confidence=confirmed -->
- **AND** no order is stored
`;

function spec(name: string, body: string): string {
  const p = join(dir, name);
  writeFileSync(p, body);
  return p;
}

describe("lint-spec", () => {
  it("E21: accepts a well-formed full-form spec with cite comments", () => {
    const r = guard(dir, "lint-spec", spec("ok.md", OK));
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("");
  });

  it.each([
    ["bold-scenario.md", OK.replace("#### Scenario: Total above the limit", "**Scenario: Total above the limit**"), "**Scenario: Total above the limit**"],
    ["numbered.md", OK.replace("### Requirement: Order total limit", "### Requirement 1: x"), "### Requirement 1: x"],
    ["no-then.md", OK.replace("- **THEN** the order is rejected with `ORDER_TOO_LARGE`\n", ""), "#### Scenario: Total above the limit"],
    ["table.md", OK.replace("- **AND** no order is stored\n", "- **AND** no order is stored\n\n| a | b |\n|---|---|\n"), "| a | b |"],
  ])("E22: rejects %s naming the offending line", (name, body, offending) => {
    const p = spec(name, body);
    const r = guard(dir, "lint-spec", p);
    expect(r.code).toBe(1);
    const line = body.split("\n").indexOf(offending) + 1;
    expect(line).toBeGreaterThan(0);
    expect(r.stdout).toMatch(new RegExp(`^${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:${line}: .+`, "m"));
  });

  it("E23: missing ## Purpose", () => {
    const r = guard(dir, "lint-spec", spec("no-purpose.md", OK.replace("## Purpose\n\nChecks an order total against a configured maximum.\n\n", "")));
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("## Purpose");
  });

  it("E23: zero requirements", () => {
    const body = OK.slice(0, OK.indexOf("### Requirement:"));
    const r = guard(dir, "lint-spec", spec("no-reqs.md", body));
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/requirement/i);
  });

  it("E24: no file argument", () => {
    const r = guard(dir, "lint-spec");
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/usage/i);
  });

  it("E24: non-existent file", () => {
    const r = guard(dir, "lint-spec", "nope.md");
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/not found/i);
  });
});
