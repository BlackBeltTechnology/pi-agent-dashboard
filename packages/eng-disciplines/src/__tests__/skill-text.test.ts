/**
 * reverse-spec-for-rebuild skill text (test-plan E14, E15): self-contained references
 * and discoverable frontmatter. See change: add-reverse-spec-for-rebuild.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { read, SKILL } from "./files";

const DOCS = [
  "SKILL.md",
  ...readdirSync(join(SKILL, "prompts")).map((f) => `prompts/${f}`),
  ...readdirSync(join(SKILL, "references")).map((f) => `references/${f}`),
];

const REF = /(?:^|[\s`(["'])((?:\.\.\/|prompts\/|references\/|scripts\/)[A-Za-z0-9_./-]*)/g;

function refs(doc: string): string[] {
  return [...read(join(SKILL, doc)).matchAll(REF)].map((m) => m[1].replace(/[.,:;]+$/, ""));
}

describe("reverse-spec-for-rebuild skill text", () => {
  it.each(DOCS)("E14: every relative path in %s resolves inside the skill dir", (doc) => {
    const found = refs(doc);
    expect(found.filter((r) => r.startsWith("../"))).toEqual([]);
    for (const r of found) {
      const abs = resolve(SKILL, r);
      expect(relative(SKILL, abs).startsWith(".."), `${doc}: ${r}`).toBe(false);
      expect(existsSync(abs), `${doc}: ${r}`).toBe(true);
    }
  });

  it("E14: SKILL.md references every prompt and the guard script", () => {
    const found = new Set(refs("SKILL.md"));
    for (const f of readdirSync(join(SKILL, "prompts"))) expect(found.has(`prompts/${f}`), f).toBe(true);
    expect(found.has("scripts/guard.mjs")).toBe(true);
  });

  it("E15: frontmatter names the skill and its rebuild trigger", () => {
    const fm = read(join(SKILL, "SKILL.md")).match(/^---\n([\s\S]*?)\n---/);
    expect(fm).not.toBeNull();
    expect(fm?.[1]).toMatch(/^name: reverse-spec-for-rebuild$/m);
    const desc = fm?.[1].match(/^description: (.*)$/m)?.[1] ?? "";
    expect(desc).toContain("rebuild");
  });
});

describe("format gate snippet (B1)", () => {
  // The `openspec validate` block SKILL.md tells the agent to run, executed for real
  // against a stub CLI: the block's exit status must be validate's, and the transient
  // id must be gone either way.
  const block = read(join(SKILL, "SKILL.md")).match(/```bash\n([\s\S]*?openspec validate[\s\S]*?)```/)?.[1] ?? "";

  function runGate(validateExit: number) {
    const repo = mkdtempSync(join(tmpdir(), "rsfr-gate-"));
    try {
      mkdirSync(join(repo, "openspec", "specs"), { recursive: true });
      mkdirSync(join(repo, "pkg", "capabilities", "cap-a"), { recursive: true });
      writeFileSync(join(repo, "pkg", "capabilities", "cap-a", "spec.md"), "# x\n");
      mkdirSync(join(repo, "bin"));
      writeFileSync(join(repo, "bin", "openspec"), `#!/bin/sh\nexit ${validateExit}\n`);
      chmodSync(join(repo, "bin", "openspec"), 0o755);
      const r = spawnSync("bash", ["-c", block], {
        cwd: repo,
        encoding: "utf8",
        env: { ...process.env, PATH: `${join(repo, "bin")}:${process.env.PATH}`, PKG: "pkg", CAP: "cap-a", RUN_ID: "r1" },
      });
      return { code: r.status, left: readdirSync(join(repo, "openspec", "specs")) };
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }

  it("is present and uses real variables, not placeholders", () => {
    expect(block).not.toBe("");
    expect(block).not.toMatch(/<cap>|(?<![$])\bPKG\//);
  });

  it("fails when validation fails, and cleans up", () => {
    const r = runGate(1);
    expect(r.code).not.toBe(0);
    expect(r.left).toEqual([]);
  });

  it("passes when validation passes, and cleans up", () => {
    const r = runGate(0);
    expect(r.code).toBe(0);
    expect(r.left).toEqual([]);
  });
  it("cleans up each iteration when looped over capabilities in one shell", () => {
    const repo = mkdtempSync(join(tmpdir(), "rsfr-gate-"));
    try {
      mkdirSync(join(repo, "openspec", "specs"), { recursive: true });
      for (const cap of ["cap-a", "cap-b"]) {
        mkdirSync(join(repo, "pkg", "capabilities", cap), { recursive: true });
        writeFileSync(join(repo, "pkg", "capabilities", cap, "spec.md"), "# x\n");
      }
      mkdirSync(join(repo, "bin"));
      // stub: validation of cap-a fails, cap-b passes
      writeFileSync(join(repo, "bin", "openspec"), '#!/bin/sh\ncase "$2" in *cap-a) exit 1;; esac\nexit 0\n');
      chmodSync(join(repo, "bin", "openspec"), 0o755);
      const script = `CAP=cap-a\n${block}\nr1=$?\nn1=$(ls openspec/specs | wc -l | tr -d ' ')\nCAP=cap-b\n${block}\nr2=$?\necho "$r1 $n1 $r2"`;
      const r = spawnSync("bash", ["-c", script], {
        cwd: repo,
        encoding: "utf8",
        env: { ...process.env, PATH: `${join(repo, "bin")}:${process.env.PATH}`, PKG: "pkg", RUN_ID: "r1" },
      });
      expect(r.stdout.trim()).toBe("1 0 0");
      expect(readdirSync(join(repo, "openspec", "specs"))).toEqual([]);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
