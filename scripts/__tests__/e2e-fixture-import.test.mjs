/**
 * Guard tests for `scripts/check-e2e-fixture-import.mjs`.
 *
 * E6 is the decision table (direct import / fixture import / type-only import).
 * E7 is the mutation check: a guard that cannot fail proves nothing, so one
 * spec's import is deliberately reverted in-memory and the guard MUST go red.
 *
 * See change: fix-e2e-harness-memory-exhaustion (test-plan #E6, #E7).
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  analyzeRepository,
  analyzeSpecSource,
  analyzeTrustWriteSource,
  CORRECTION,
  E2E_DIR,
  TRUST_WRITE_ALLOWLIST,
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

/**
 * Trust-write lint (change: triage-browser-e2e-offbox-poison, test-plan #E21/#E22).
 * A spec may change harness-global trust only through `narrowTrust`.
 */
describe("trust-write lint decision table (E21)", () => {
  const lint = (file, source) => analyzeTrustWriteSource(file, source);

  it("FAILS a raw PUT /api/config of trustedNetworks, naming file + key", () => {
    const f = lint(
      "tests/e2e/a.spec.ts",
      'await request.put("/api/config", { data: { trustedNetworks: [] } });\n',
    );
    expect(f).toHaveLength(1);
    expect(f[0].key).toBe("trustedNetworks");
    expect(f[0].message).toContain("tests/e2e/a.spec.ts");
    expect(f[0].message).toContain("narrowTrust");
  });

  it("FAILS a putConfig helper call carrying allowedHosts", () => {
    const f = lint("tests/e2e/b.spec.ts", "await putConfig(request, { allowedHosts: [] });\n");
    expect(f.map((x) => x.key)).toEqual(["allowedHosts"]);
  });

  it("FAILS an in-container config.json write (patchConfig) of hostGate", () => {
    const f = lint("tests/e2e/c.spec.ts", 'patchConfig({ hostGate: { mode: "enforce" } });\n');
    expect(f.map((x) => x.key)).toEqual(["hostGate"]);
  });

  it("PASSES a non-trust key, a route stub and a narrowTrust call", () => {
    expect(lint("tests/e2e/d.spec.ts", 'await request.put("/api/config", { data: { cors: { allowedOrigins: [] } } });')).toEqual([]);
    expect(lint("tests/e2e/e.spec.ts", 'await page.route("**/api/config", (r) => r.fulfill({ body: stub({ trustedNetworks: [] }) }));\nawait stubConfig(page, { bypassHosts: [] });')).toEqual([]);
    expect(lint("tests/e2e/f.spec.ts", "await narrowTrust(request, { trustedNetworks: [] });")).toEqual([]);
  });

  it("does not flag a local helper's own declaration", () => {
    expect(lint("tests/e2e/g.spec.ts", "async function putConfig(request, partial) {\n  await request.put(url, { data: partial });\n}")).toEqual([]);
  });

  it("allowlists the narrowTrust implementation and the deliberate-poisoning spec", () => {
    expect(TRUST_WRITE_ALLOWLIST).toContain("tests/e2e/harness-isolation-faults.spec.ts");
    expect(
      lint("tests/e2e/harness-isolation-faults.spec.ts", 'await request.put("/api/config", { data: { trustedNetworks: [] } });'),
    ).toEqual([]);
  });

  it("honours a justified marker ONLY in a file that also declares via narrowTrust", () => {
    const withMarker =
      "await narrowTrust(request, {}, { touches: [\"hostGate.mode\"] });\n// e2e-trust-write-ok(absent-key default)\ndelete stripped.hostGate;\n";
    expect(lint("tests/e2e/h.spec.ts", withMarker)).toEqual([]);
    const noDeclaration = "// e2e-trust-write-ok(absent-key default)\ndelete stripped.hostGate;\n";
    expect(lint("tests/e2e/i.spec.ts", noDeclaration).map((x) => x.key)).toEqual(["hostGate"]);
  });
});

describe("trust-write lint fails closed (E22)", () => {
  it("goes red when a migrated spec is reverted in-memory to a raw PUT", () => {
    const file = "tests/e2e/mcp-tiered-token.spec.ts";
    const source = readFileSync(join(E2E_DIR, "mcp-tiered-token.spec.ts"), "utf8");
    expect(analyzeTrustWriteSource(file, source)).toEqual([]);
    const reverted = source.replace(
      /await narrowTrust\(request, \{ trustedNetworks: \[\], auth: \{ bypassUrls: \["\/v1\/"\] \} \}\);/,
      'await request.put("/api/config", { data: { trustedNetworks: [] } });',
    );
    expect(reverted, "the migrated narrowTrust call must exist to be reverted").not.toBe(source);
    expect(analyzeTrustWriteSource(file, reverted).map((x) => x.key)).toEqual(["trustedNetworks"]);
  });

  it("the current tree is clean (every trust write goes through narrowTrust)", () => {
    const findings = analyzeRepository().filter((f) => f.rule === "e2e-trust-write-outside-narrow-trust");
    expect(findings.map((f) => f.message).join("\n")).toBe("");
  });
});
