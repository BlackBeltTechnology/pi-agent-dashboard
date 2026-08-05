import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

import { buildWorkItems, parseRows, replaceRowPurpose, resolveBaseline } from "../dox-triage.js";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" });

describe("dox-triage: row parsing", () => {
  const md = [
    "# DOX — pkg/src",
    "",
    "| File | Purpose |",
    "|------|---------|",
    "| `a.ts` | Does A. See change: x. |",
    "| `sub/b.ts` | Does B. |",
    "",
  ].join("\n");

  it("parses path + purpose per row", () => {
    const rows = parseRows(md);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ path: "a.ts", purpose: "Does A. See change: x." });
    expect(rows[1].path).toBe("sub/b.ts");
  });

  it("ignores the header separator and non-row lines", () => {
    expect(parseRows(md).map((r) => r.path)).not.toContain("------");
  });

  it("replaces only the targeted row purpose, preserving the rest byte-for-byte", () => {
    const out = replaceRowPurpose(md, "a.ts", "Does A differently.");
    expect(out).toContain("| `a.ts` | Does A differently. |");
    expect(out).toContain("| `sub/b.ts` | Does B. |");
    expect(out.split("\n")).toHaveLength(md.split("\n").length);
  });

  it("is a no-op when the row path is absent", () => {
    expect(replaceRowPurpose(md, "nope.ts", "x")).toBe(md);
  });
});

describe("dox-triage: baseline resolution from a content hash", () => {
  let repo: string;
  let v1Sha: string;

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), "dox-triage-"));
    git(repo, "init", "-q");
    git(repo, "config", "user.email", "t@t.t");
    git(repo, "config", "user.name", "t");

    writeFileSync(join(repo, "a.ts"), "export const v = 1;\n");
    v1Sha = sha("export const v = 1;\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-qm", "v1");

    writeFileSync(join(repo, "a.ts"), "export const v = 2;\nexport const extra = true;\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-qm", "v2");
  });
  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  it("finds the commit whose blob matches the acked hash", () => {
    const r = resolveBaseline({ cwd: repo, file: "a.ts", ackedSha: v1Sha, depth: 20 });
    expect(r.found).toBe(true);
    expect(r.commit).not.toBeNull();
    expect(git(repo, "log", "-1", "--format=%s", r.commit!).trim()).toBe("v1");
  });

  it("returns a real diff between the acked state and HEAD", () => {
    const r = resolveBaseline({ cwd: repo, file: "a.ts", ackedSha: v1Sha, depth: 20 });
    expect(r.diff).toContain("+export const extra = true;");
    expect(r.diff).toContain("-export const v = 1;");
  });

  it("includes UNCOMMITTED working-tree edits in the diff", () => {
    // staleness is hashed from the working tree, so a row can be stale purely from
    // unstaged work. Diffing base..HEAD would miss it entirely and yield no evidence.
    writeFileSync(join(repo, "a.ts"), "export const v = 2;\nexport const extra = true;\nexport const uncommitted = 9;\n");
    const r = resolveBaseline({ cwd: repo, file: "a.ts", ackedSha: v1Sha, depth: 20 });
    expect(r.found).toBe(true);
    expect(r.diff).toContain("+export const uncommitted = 9;");
    // restore committed state for the remaining assertions
    writeFileSync(join(repo, "a.ts"), "export const v = 2;\nexport const extra = true;\n");
  });

  it("reports found=false when the hash matches no commit in range", () => {
    const r = resolveBaseline({ cwd: repo, file: "a.ts", ackedSha: sha("never existed"), depth: 20 });
    expect(r.found).toBe(false);
    expect(r.diff).toBe("");
  });

  it("reports found=false (not a crash) for an untracked file", () => {
    const r = resolveBaseline({ cwd: repo, file: "ghost.ts", ackedSha: v1Sha, depth: 20 });
    expect(r.found).toBe(false);
  });
});

describe("dox-triage: work items", () => {
  let repo: string;

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), "dox-triage-wi-"));
    git(repo, "init", "-q");
    git(repo, "config", "user.email", "t@t.t");
    git(repo, "config", "user.name", "t");
    writeFileSync(join(repo, "a.ts"), "export const v = 1;\n");
    writeFileSync(join(repo, "AGENTS.md"), "# DOX\n\n| File | Purpose |\n|------|---------|\n| `a.ts` | Exports v. |\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-qm", "v1");
    writeFileSync(join(repo, "a.ts"), "export const v = 2;\nexport const added = 1;\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-qm", "v2");
  });
  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  it("pairs each stale issue with its row text and a diff", () => {
    const items = buildWorkItems({
      cwd: repo,
      issues: [{ kind: "stale", agentsFile: "AGENTS.md", path: "a.ts", detail: "hash mismatch" }],
      staleness: { "a.ts": sha("export const v = 1;\n") },
    });
    expect(items).toHaveLength(1);
    expect(items[0].purpose).toBe("Exports v.");
    expect(items[0].target).toBe("a.ts");
    expect(items[0].diff).toContain("+export const added = 1;");
  });

  it("skips non-stale issue kinds", () => {
    const items = buildWorkItems({
      cwd: repo,
      issues: [{ kind: "missing", agentsFile: "AGENTS.md", path: "a.ts", detail: "no row" }],
      staleness: {},
    });
    expect(items).toHaveLength(0);
  });
});
