// `dox lint` missing-arm coverage of SOURCE files (design D9).
// Today every `missing` finding is `.md`; zero `.ts`/`.tsx` are ever flagged,
// while 38% of source files agents opened after a kb fall-through have no row.
// See change: fix-kb-search-retrieval-quality.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { doxLint } from "../dox.js";

const tmps: string[] = [];
function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "dox-src-"));
  tmps.push(dir);
  for (const [p, body] of Object.entries(files)) {
    const abs = join(dir, p);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, body);
  }
  return dir;
}
afterEach(() => {
  for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true });
});

// Table-header shape (fix-dox-lint-blind-rows): rows are recognized by the
// `| File | Purpose |` header, not by heading state — uppercase is rejected
// by the case-sensitive grammar.
const DOX = (rows = "") => `# DOX\n\n| File | Purpose |\n|---|---|\n${rows}`;
const missingFor = (dir: string, extra: Record<string, unknown> = {}) =>
  doxLint({ cwd: dir, sourceFileRows: true, ...extra }).issues.filter((i) => i.kind === "missing").map((i) => i.path);

describe("dox lint: source-file missing arm", () => {
  it("reports an undocumented source file in a covered directory", () => {
    const dir = project({ "src/AGENTS.md": DOX(), "src/thing.ts": "export const a = 1;\n" });
    expect(missingFor(dir)).toContain("src/thing.ts");
  });

  it("does not report a source file that already has a row", () => {
    const dir = project({ "src/AGENTS.md": DOX("| `thing.ts` | does a thing |\n"), "src/thing.ts": "export const a = 1;\n" });
    expect(missingFor(dir)).not.toContain("src/thing.ts");
  });

  it("accepts a <file>.AGENTS.md sidecar in place of a row", () => {
    const dir = project({
      "src/AGENTS.md": DOX(),
      "src/thing.ts": "export const a = 1;\n",
      "src/thing.ts.AGENTS.md": "# DOX\n\ndetail for thing.ts\n",
    });
    expect(missingFor(dir)).not.toContain("src/thing.ts");
  });

  it("accepts a row in an ANCESTOR AGENTS.md, not only the nearest one", () => {
    const dir = project({
      "AGENTS.md": DOX("| `src/deep/thing.ts` | documented from the root |\n"),
      "src/deep/AGENTS.md": DOX(),
      "src/deep/thing.ts": "export const a = 1;\n",
    });
    expect(missingFor(dir)).not.toContain("src/deep/thing.ts");
  });

  it("never reports declaration, test or spec files", () => {
    const dir = project({
      "src/AGENTS.md": DOX(),
      "src/types.d.ts": "export {};\n",
      "src/thing.test.ts": "export {};\n",
      "src/thing.spec.tsx": "export {};\n",
    });
    const missing = missingFor(dir);
    expect(missing.some((p) => p?.endsWith(".d.ts"))).toBe(false);
    expect(missing.some((p) => p?.includes(".test."))).toBe(false);
    expect(missing.some((p) => p?.includes(".spec."))).toBe(false);
  });

  it("never reports files in excluded trees", () => {
    const dir = project({ "src/AGENTS.md": DOX(), "src/thing.ts": "export const a = 1;\n", "node_modules/pkg/index.ts": "export {};\n" });
    expect(missingFor(dir).some((p) => p?.startsWith("node_modules/"))).toBe(false);
  });

  it("reports nothing for a source file outside any AGENTS.md area", () => {
    const dir = project({ "src/AGENTS.md": DOX(), "elsewhere/thing.ts": "export const a = 1;\n" });
    expect(missingFor(dir)).not.toContain("elsewhere/thing.ts");
  });

  it("is independently enableable — OFF by default so an existing tree can adopt it", () => {
    const dir = project({ "src/AGENTS.md": DOX(), "src/thing.ts": "export const a = 1;\n", "src/doc.md": "# Doc\nprose\n" });
    const off = doxLint({ cwd: dir }).issues.filter((i) => i.kind === "missing");
    expect(off.some((i) => i.path === "src/thing.ts")).toBe(false);
    // the markdown arm is unaffected by the flag
    expect(off.some((i) => i.path === "src/doc.md")).toBe(true);
  });

  it("source-file findings are distinguishable from markdown findings", () => {
    const dir = project({ "src/AGENTS.md": DOX(), "src/thing.ts": "export const a = 1;\n", "src/doc.md": "# Doc\nprose\n" });
    const missing = doxLint({ cwd: dir, sourceFileRows: true }).issues.filter((i) => i.kind === "missing");
    const src = missing.find((i) => i.path === "src/thing.ts")!;
    const md = missing.find((i) => i.path === "src/doc.md")!;
    expect(src.arm).toBe("source");
    expect(md.arm).not.toBe("source");
  });

  it("fix mode does NOT auto-append blank source rows (a purpose row needs a human)", () => {
    const dir = project({ "src/AGENTS.md": DOX(), "src/thing.ts": "export const a = 1;\n" });
    const before = doxLint({ cwd: dir, sourceFileRows: true });
    const after = doxLint({ cwd: dir, sourceFileRows: true, fix: true });
    expect(after.issues.filter((i) => i.kind === "missing" && i.path === "src/thing.ts").length).toBe(
      before.issues.filter((i) => i.kind === "missing" && i.path === "src/thing.ts").length,
    );
  });
});
