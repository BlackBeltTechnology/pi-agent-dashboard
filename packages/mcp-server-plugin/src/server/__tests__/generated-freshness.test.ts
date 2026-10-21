/**
 * E17 (test-plan expand-mcp-tiered-surface) — generated freshness.
 *
 * The checked-in `generated/tools.ts` and README catalogue must equal what the
 * codegen produces right now. A changed manifest row or shared request type
 * fails this test until the artefacts are regenerated — the mechanism that
 * makes the schema "generated, never hand-edited".
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { routeTier } from "@blackbelt-technology/pi-dashboard-shared/route-tiers.js";
import { describe, expect, it } from "vitest";
import { build, readmeBlockFor } from "../../../codegen/generate-tools.js";
import { GENERATED_VERB_TIERS } from "@blackbelt-technology/pi-dashboard-shared/mcp/verb-tiers.generated.js";
import { GENERATED_TOOLS } from "../generated/tools.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, "..", "..", "..");
const GENERATED = path.join(PKG_ROOT, "src/server/generated/tools.ts");
const README = path.join(PKG_ROOT, "README.md");
const VERB_TIERS_FILE = path.join(PKG_ROOT, "..", "shared", "src", "mcp", "verb-tiers.generated.ts");

function readmeBlock(): string {
  const text = fs.readFileSync(README, "utf8");
  const start = text.indexOf("<!-- tools:start -->");
  const end = text.indexOf("<!-- tools:end -->") + "<!-- tools:end -->".length;
  return text.slice(start, end);
}

/**
 * @structural-pin freshness gate: the checked-in generated tools.ts and README catalogue must equal regenerated output byte for byte
 */
describe("E17 — generated tool artefacts are fresh", () => {
  it("the checked-in generated file matches a fresh build", () => {
    const { content, tools } = build(routeTier);
    expect(fs.readFileSync(GENERATED, "utf8")).toBe(content);
    expect(tools.length).toBe(GENERATED_TOOLS.length);
  });

  it("the README catalogue block matches a fresh build", () => {
    const { tools } = build(routeTier);
    expect(readmeBlock()).toBe(readmeBlockFor(tools));
  });

  it("is NOT vacuous — a hand-edited description no longer matches", () => {
    const { content } = build(routeTier);
    const tampered = content.replace(
      /"name":"list_sessions","description":"[^"]*"/,
      '"name":"list_sessions","description":"HAND-EDITED"',
    );
    expect(tampered).not.toBe(content);
    expect(fs.readFileSync(GENERATED, "utf8")).toBe(content);
  });
});

/**
 * Task 2.6 / #E12 — the verb→tier table lives in shared so chat-gateway reads it
 * without importing the mcp-server plugin.
 */
describe("E12 — shared verb-tier table is generated and fresh", () => {
  it("the checked-in shared file matches a fresh build", () => {
    const { verbTiersContent } = build(routeTier);
    expect(fs.readFileSync(VERB_TIERS_FILE, "utf8")).toBe(verbTiersContent);
  });

  it("equals GENERATED_TOOLS name+tier, in order", () => {
    expect(GENERATED_VERB_TIERS).toEqual(GENERATED_TOOLS.map((t) => ({ name: t.name, tier: t.tier })));
  });

  it("is NOT vacuous — a changed tier no longer matches", () => {
    const { verbTiersContent } = build(routeTier);
    const tampered = verbTiersContent.replace(/"tier":"(observe|control|operate)"/, '"tier":"nonsense"');
    expect(tampered).not.toBe(verbTiersContent);
  });
});
