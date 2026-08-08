/**
 * pi 0.84.0 added `AGENTS.override.md`: a per-directory context file that
 * REPLACES that directory's context rather than adding to it. pi's own loader
 * (`dist/core/resource-loader.js`) lists it first among the candidates and
 * returns on first match, so within a directory the override shadows its
 * sibling `AGENTS.md`.
 *
 * The dashboard's kb tooling keeps its own notion of "which files are context
 * files" (dox chain walking + index doc-typing). Without this it would miss an
 * override entirely, and — worse — inject BOTH files for one directory, applying
 * that directory's context twice.
 *
 * See change: update-pi-core-0-84-adopt-apis (test-plan #E14, #E15, #E16).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentsChain } from "../dox.js";
import { docTypeOf } from "../indexer.js";

describe("AGENTS.override.md — kb context-file recognition", () => {
  let dir: string;
  beforeAll(() => (dir = mkdtempSync(join(tmpdir(), "kb-override-"))));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("E14: an override shadows its sibling AGENTS.md in the same directory", () => {
    mkdirSync(join(dir, "sub"), { recursive: true });
    writeFileSync(join(dir, "AGENTS.md"), "# Root\n");
    writeFileSync(join(dir, "sub", "AGENTS.md"), "# Sub (should be shadowed)\n");
    writeFileSync(join(dir, "sub", "AGENTS.override.md"), "# Sub OVERRIDE\n");
    writeFileSync(join(dir, "sub", "code.ts"), "export const x = 1;\n");

    const { chain } = agentsChain(dir, join(dir, "sub", "code.ts"));

    // The ancestor still applies; only the overridden directory is replaced.
    expect(chain.map((c) => c.rel)).toEqual(["AGENTS.md", "sub/AGENTS.override.md"]);
    // Applying both would inject that directory's context twice.
    expect(chain.map((c) => c.rel)).not.toContain("sub/AGENTS.md");
  });

  it("E15: absence of an override leaves normal inheritance untouched", () => {
    const plain = mkdtempSync(join(tmpdir(), "kb-plain-"));
    mkdirSync(join(plain, "sub"), { recursive: true });
    writeFileSync(join(plain, "AGENTS.md"), "# Root\n");
    writeFileSync(join(plain, "sub", "AGENTS.md"), "# Sub\n");
    writeFileSync(join(plain, "sub", "code.ts"), "export const x = 1;\n");

    const { chain } = agentsChain(plain, join(plain, "sub", "code.ts"));

    expect(chain.map((c) => c.rel)).toEqual(["AGENTS.md", "sub/AGENTS.md"]);
    rmSync(plain, { recursive: true, force: true });
  });

  it("E14: an override also shadows CLAUDE.md when claudeMd is enabled", () => {
    const c = mkdtempSync(join(tmpdir(), "kb-claude-"));
    writeFileSync(join(c, "CLAUDE.md"), "# Claude\n");
    writeFileSync(join(c, "AGENTS.override.md"), "# Override\n");
    writeFileSync(join(c, "code.ts"), "export const x = 1;\n");

    const { chain } = agentsChain(c, join(c, "code.ts"), { claudeMd: true });

    expect(chain.map((c2) => c2.rel)).toEqual(["AGENTS.override.md"]);
    rmSync(c, { recursive: true, force: true });
  });

  it("E16: an override is doc-typed as an agents context file, not ordinary markdown", () => {
    expect(docTypeOf("sub/AGENTS.override.md", false)).toBe("agents");
    // Unchanged for the existing names.
    expect(docTypeOf("AGENTS.md", false)).toBe("agents");
    expect(docTypeOf("CLAUDE.md", false)).toBe("agents");
    expect(docTypeOf("docs/guide.md", false)).toBe("doc");
  });
});
