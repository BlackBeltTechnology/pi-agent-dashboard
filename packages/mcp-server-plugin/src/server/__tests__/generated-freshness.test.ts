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
import { build, readmeBlockFor } from "../../codegen/generate-tools.js";
import { GENERATED_TOOLS } from "../generated/tools.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, "..", "..", "..");
const GENERATED = path.join(PKG_ROOT, "src/server/generated/tools.ts");
const README = path.join(PKG_ROOT, "README.md");

function readmeBlock(): string {
  const text = fs.readFileSync(README, "utf8");
  const start = text.indexOf("<!-- tools:start -->");
  const end = text.indexOf("<!-- tools:end -->") + "<!-- tools:end -->".length;
  return text.slice(start, end);
}

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
