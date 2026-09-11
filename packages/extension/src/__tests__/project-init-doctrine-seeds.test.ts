// The project-init DOX seed is now a POINTER block; the full READ doctrine is
// carried (and injected per turn) by the kb extension. This file guards the
// boundary: the seed must not re-introduce a doctrine table, and the coding
// profile template keeps its own fallback table for the pre-extension case.
// See change: inject-dox-doctrine-and-describe.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildDoctrineBlock } from "../project-init/seed-doctrine.js";

const HERE = dirname(fileURLToPath(import.meta.url));
// packages/extension/src/__tests__ → packages/extension/.pi/skills/project-init
const SEED_DIR = resolve(HERE, "..", "..", ".pi", "skills", "project-init");

const codingTmpl = () => readFileSync(join(SEED_DIR, "profiles", "coding", "AGENTS.md.tmpl"), "utf8");

describe("project-init seed carries no doctrine text", () => {
  it("the doctrine file moved out of the skill dir", () => {
    expect(existsSync(join(SEED_DIR, "dox-doctrine.md"))).toBe(false);
  });

  it("the seed is a pointer only — no READ table, no legacy delimiters", () => {
    const block = buildDoctrineBlock();
    expect(block).toContain(".pi/dashboard/knowledge_base.json");
    expect(block).not.toContain("kb_search --doc-type agents");
    expect(block).not.toMatch(/dox:\w+:start/);
  });

  it("the coding profile template keeps its own fallback READ table", () => {
    const tmpl = codingTmpl();
    expect(tmpl).toContain("kb_search --doc-type agents");
    expect(tmpl).toContain("kb agents <path>");
    expect(tmpl).toContain("Fall-through");
  });
});
