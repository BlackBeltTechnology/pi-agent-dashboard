/**
 * Guard tests for `scripts/check-e2e-fixture-import.mjs`.
 *
 * E6 is the decision table (direct import / fixture import / type-only import).
 * E7 is the mutation check: a guard that cannot fail proves nothing, so one
 * spec's import is deliberately reverted in-memory and the guard MUST go red.
 *
 * See change: fix-e2e-harness-memory-exhaustion (test-plan #E6, #E7).
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CORRECTION,
  E2E_DIR,
  analyzeRepository,
  analyzeSpecSource,
} from "../check-e2e-fixture-import.mjs";

const rulesOf = (findings) => findings.map((f) => f.rule);

describe("decision table (E6)", () => {
  it("FAILS a spec importing test from @playwright/test, naming file + correction", () => {
    const findings = analyzeSpecSource(
      "tests/e2e/bad.spec.ts",
      'import { expect, test } from "@playwright/test";\n',
    );
    expect(rulesOf(findings)).toEqual(["e2e-test-import-bypasses-fixture"]);
    expect(findings[0].message).toContain("tests/e2e/bad.spec.ts");
    expect(findings[0].message).toContain(CORRECTION);
  });

  it("PASSES a spec importing test from ./fixtures.js", () => {
    const findings = analyzeSpecSource(
      "tests/e2e/good.spec.ts",
      'import { expect, test } from "./fixtures.js";\n',
    );
    expect(findings).toEqual([]);
  });

  it("PASSES a spec importing ONLY types from @playwright/test", () => {
    const findings = analyzeSpecSource(
      "tests/e2e/types.spec.ts",
      'import { expect, test } from "./fixtures.js";\n' +
        'import type { Page } from "@playwright/test";\n',
    );
    expect(findings).toEqual([]);
  });

  it("PASSES an inline type-only binding on a @playwright/test statement", () => {
    // `import { type Page } from "@playwright/test"` carries no runtime `test`.
    const findings = analyzeSpecSource(
      "tests/e2e/inline-type.spec.ts",
      'import { expect, test } from "./fixtures.js";\n' +
        'import { type Locator, type Page } from "@playwright/test";\n',
    );
    expect(findings).toEqual([]);
  });

  it("FAILS when test is smuggled in alongside legal type imports", () => {
    const findings = analyzeSpecSource(
      "tests/e2e/mixed.spec.ts",
      'import { expect, type Page, test } from "@playwright/test";\n',
    );
    expect(rulesOf(findings)).toEqual(["e2e-test-import-bypasses-fixture"]);
    expect(findings[0].bindings).toEqual(expect.arrayContaining(["expect", "test"]));
  });

  it("handles the aliased-type spelling used by the websocket specs", () => {
    const findings = analyzeSpecSource(
      "tests/e2e/ws.spec.ts",
      'import { expect, test } from "./fixtures.js";\n' +
        'import { type WebSocket as PWWebSocket } from "@playwright/test";\n',
    );
    expect(findings).toEqual([]);
  });
});

describe("fails closed (E7)", () => {
  it("goes red when a real spec's import is reverted to @playwright/test", () => {
    const specs = readdirSync(E2E_DIR)
      .filter((f) => f.endsWith(".spec.ts"))
      .sort();
    expect(specs.length).toBeGreaterThan(0);

    const victim = specs[0];
    const source = readFileSync(join(E2E_DIR, victim), "utf8");
    // The mutation: swap the fixture import back to the bare Playwright one.
    const mutated = source.replace(/from\s*["']\.\/fixtures\.js["']/, 'from "@playwright/test"');
    expect(mutated, `${victim} did not contain a ./fixtures.js import to revert`).not.toBe(source);

    const findings = analyzeSpecSource(`tests/e2e/${victim}`, mutated);
    expect(rulesOf(findings)).toEqual(["e2e-test-import-bypasses-fixture"]);
  });
});

describe("repository invariant", () => {
  it("no tests/e2e/*.spec.ts bypasses the reap fixture", () => {
    const findings = analyzeRepository();
    expect(findings.map((f) => f.message).join("\n")).toBe("");
  });
});
