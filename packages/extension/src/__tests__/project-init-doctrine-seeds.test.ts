// E24 (phase 7.7): the project-init seeded READ doctrine stays UNTRIMMED —
// both template variants (kb-wired + manual) keep their substitution-table
// rows, because a seeded project may never install kb-extension and its prose
// is the only enforcement it has. A gate trim landed in THIS repo's root
// AGENTS.md must never silently shrink the seeds.
// See change: add-kb-trust-verdicts-and-search-guard.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
// packages/extension/src/__tests__ → packages/extension/.pi/skills/project-init
const SEED_DIR = resolve(HERE, "..", "..", ".pi", "skills", "project-init");

const doctrine = () => readFileSync(join(SEED_DIR, "dox-doctrine.md"), "utf8");
const codingTmpl = () => readFileSync(join(SEED_DIR, "profiles", "coding", "AGENTS.md.tmpl"), "utf8");

function block(text: string, start: string, end: string): string {
  const s = text.indexOf(start);
  const e = text.indexOf(end);
  expect(s, `missing marker ${start}`).toBeGreaterThanOrEqual(0);
  expect(e, `missing marker ${end}`).toBeGreaterThan(s);
  return text.slice(s, e);
}

describe("project-init seeds keep the full READ doctrine (E24)", () => {
  it("kb-wired variant keeps the substitution table rows + fall-through", () => {
    const kb = block(doctrine(), "<!-- dox:read:kb:start -->", "<!-- dox:read:kb:end -->");
    expect(kb).toContain("| You're about to… | Do this FIRST instead |");
    expect(kb).toContain("kb_search --doc-type agents");
    expect(kb).toContain("kb agents <path>");
    expect(kb).toContain("kb_get <path> <section>");
    expect(kb).toContain("Fall-through");
  });

  it("manual variant keeps its substitution table rows + fall-through", () => {
    const manual = block(doctrine(), "<!-- dox:read:manual:start -->", "<!-- dox:read:manual:end -->");
    expect(manual).toContain("| You're about to… | Do this FIRST instead |");
    expect(manual).toContain("read the nearest directory `AGENTS.md`");
    expect(manual).toContain("Fall-through");
  });

  it("the coding profile AGENTS.md.tmpl keeps its own substitution table", () => {
    const tmpl = codingTmpl();
    expect(tmpl).toContain("kb_search --doc-type agents");
    expect(tmpl).toContain("kb agents <path>");
    expect(tmpl).toContain("Fall-through");
  });
});
