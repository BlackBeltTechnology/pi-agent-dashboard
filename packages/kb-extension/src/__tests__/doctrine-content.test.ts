// Content contracts for the shipped doctrine and the dogfood config
// (change: inject-dox-doctrine-and-describe, test-plan #E23, #E29, #E30).
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// packages/kb-extension/src/__tests__ → package root → repo root
const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, "..", "..");
const ROOT = resolve(PKG, "..", "..");

const doctrine = () => readFileSync(join(PKG, "dox-doctrine.md"), "utf8");

/** Extract a delimited doctrine section (between the two comment markers). */
function section(text: string, start: string, end: string): string {
  const s = text.indexOf(start);
  const e = text.indexOf(end);
  expect(s, `missing marker ${start}`).toBeGreaterThanOrEqual(0);
  expect(e, `missing marker ${end}`).toBeGreaterThan(s);
  return text.slice(s, e);
}

describe("E23: canonical READ section keeps the full table", () => {
  const read = () => section(doctrine(), "<!-- dox:read:kb:start -->", "<!-- dox:read:kb:end -->");

  it("carries the doc_type lane rule", () => {
    expect(read()).toContain("doc_type");
    expect(read()).toContain("Pick the lane");
  });

  it("carries the corpus boundaries and the session-memory tool line", () => {
    expect(read()).toContain("tests/ qa/ scripts/ docker/");
    expect(read()).toContain("ctx_search");
    expect(read()).toContain("memory_search");
  });

  it("carries the trust-verdict row", () => {
    const r = read();
    for (const label of ["STALE", "GONE", "MOVED", "FRESH"]) expect(r).toContain(label);
  });

  it("carries the kb_search lane row, the kb_get row and the ctx_execute row", () => {
    expect(read()).toContain("kb_search --doc-type agents");
    expect(read()).toContain("kb_get <path> <section>");
    expect(read()).toContain("ctx_execute_file");
  });

  it("keeps the fall-through explicit", () => {
    expect(read()).toContain("Fall-through");
  });

  it("no longer ships the manual READ variant", () => {
    expect(doctrine()).not.toContain("dox:read:manual");
  });
});

describe("E29: packaging lists the shipped doctrine + skill", () => {
  const pkg = () => JSON.parse(readFileSync(join(PKG, "package.json"), "utf8")) as { files: string[] };

  it("files includes dox-doctrine.md and .pi/skills/dox-describe/", () => {
    const f = pkg().files;
    expect(f).toContain("dox-doctrine.md");
    expect(f).toContain(".pi/skills/dox-describe/");
  });

  it("both paths exist on disk", () => {
    expect(existsSync(join(PKG, "dox-doctrine.md"))).toBe(true);
    expect(existsSync(join(PKG, ".pi", "skills", "dox-describe"))).toBe(true);
  });
});

describe("E30: dogfood — root AGENTS.md reduced, project doctrine recorded", () => {
  const rootAgents = () => readFileSync(join(ROOT, "AGENTS.md"), "utf8");
  const kbConfig = () =>
    JSON.parse(readFileSync(join(ROOT, ".pi", "dashboard", "knowledge_base.json"), "utf8")) as {
      doctrine?: { write?: boolean };
    };

  it("root AGENTS.md drops the injected sections", () => {
    expect(rootAgents()).not.toContain("## Docs-First Gate");
    expect(rootAgents()).not.toContain("## Investigation Protocol");
  });

  it("root AGENTS.md re-homes the repo-specific rows", () => {
    // docs/faq.md grep row and the run-fixtures.ts reproduce line survived the trim.
    expect(rootAgents()).toContain("docs/faq.md");
    expect(rootAgents()).toContain("run-fixtures.ts");
  });

  it("project config records doctrine.write true", () => {
    expect(kbConfig().doctrine?.write).toBe(true);
  });
});
