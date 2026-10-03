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

const GUARD_PATH = join(SKILL, "scripts", "guard.mjs");

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
        env: { ...process.env, PATH: `${join(repo, "bin")}:${process.env.PATH}`, PKG: "pkg", CAP: "cap-a", RUN_ID: "r1", G: `node ${GUARD_PATH}` },
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
  it("refuses a traversal capability name before touching the filesystem (B1 r5)", () => {
    const repo = mkdtempSync(join(tmpdir(), "rsfr-gate-"));
    try {
      mkdirSync(join(repo, "openspec", "specs"), { recursive: true });
      mkdirSync(join(repo, "victim"));
      writeFileSync(join(repo, "victim", "keep.txt"), "x");
      mkdirSync(join(repo, "bin"));
      writeFileSync(join(repo, "bin", "openspec"), "#!/bin/sh\nexit 0\n");
      chmodSync(join(repo, "bin", "openspec"), 0o755);
      // naive ids: CAP escapes to <repo>/victim (the EXIT trap would rm -rf it);
      // RUN_ID escapes so mkdir/cp/rm act inside <repo>/victim
      for (const [cap, run] of [["x/../../../victim", "r1"], ["y", "a/../../../victim/z"]]) {
        const r = spawnSync("bash", ["-c", block], {
          cwd: repo,
          encoding: "utf8",
          env: { ...process.env, PATH: `${join(repo, "bin")}:${process.env.PATH}`, PKG: "pkg", CAP: cap, RUN_ID: run, G: `node ${GUARD_PATH}` },
        });
        expect(r.status, `${cap} ${run}`).not.toBe(0);
      }
      expect(readdirSync(join(repo, "victim"))).toEqual(["keep.txt"]);
      expect(readdirSync(join(repo, "openspec", "specs"))).toEqual([]);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
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
        env: { ...process.env, PATH: `${join(repo, "bin")}:${process.env.PATH}`, PKG: "pkg", RUN_ID: "r1", G: `node ${GUARD_PATH}` },
      });
      expect(r.stdout.trim()).toBe("1 0 0");
      expect(readdirSync(join(repo, "openspec", "specs"))).toEqual([]);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe("tuned prompt text (test-plan E9-E12) — See change: tune-reverse-spec-for-rebuild-eval", () => {
  const norm = (rel: string) => read(join(SKILL, rel)).replace(/\s+/g, " ");
  const BOUNDARY =
    "Catalog boundary: a rule is anything that decides a caller-visible outcome from domain data or failure class, " +
    "including HTTP/WS/CLI error maps (which failure class yields which status, code, reply or non-success exit) and " +
    "fallback handlers that hide or substitute details. Plumbing is a numbering or formatting choice that encodes no " +
    "decision (one non-success exit status for every failure, output formatting, id formats, subscribe/unsubscribe " +
    "mechanics); plumbing belongs in the spec, not in the rule catalog.";

  it.each(["prompts/generator-rebuild.md", "prompts/auditor-rebuild.md", "SKILL.md"])(
    "E9: %s states the catalog boundary verbatim and drops the old plumbing wording",
    (rel) => {
      const text = norm(rel);
      expect(text).toContain(BOUNDARY);
      expect(text).not.toContain("Interface plumbing (exit codes,");
      expect(text).not.toContain("exit codes or output formatting belong in the spec");
    },
  );

  it("E10: generator names the literal external config key", () => {
    expect(norm("prompts/generator-rebuild.md")).toContain("name the key exactly as read");
  });

  it("E11: SKILL.md wires lint-cite into G list, pre-merge, post-merge, gate summary and promotion", () => {
    const text = norm("SKILL.md");
    expect(text).toContain("`check-dest`, `sweep`, `lint-spec`, `lint-cite`");
    expect(text).toContain("G lint-cite PKG/_fragments/*.json PKG/_fragments/*.spec.md");
    expect(text).toContain("G lint-cite PKG/rules.md PKG/model.md PKG/quirks.md PKG/gaps.md PKG/capabilities/*/spec.md");
    expect(text).toContain("G lint-cite PKG/completeness.md");
    expect(text).toMatch(/Gate summary\..*citation check \(`lint-cite`/);
    expect(text).toMatch(/Promote on confirm\..*citation check \(`G lint-cite`\) is clean/);
  });

  it("E11 (review B1): the fragment citation check opens step 6, so every revise loop's re-merge runs it", () => {
    const text = norm("SKILL.md");
    const merge = text.slice(text.indexOf("6. **Merge**"), text.indexOf("7. **Audit in parallel.**"));
    expect(merge).toContain("G lint-cite PKG/_fragments/*.json PKG/_fragments/*.spec.md");
    const step5 = text.slice(text.indexOf("5. **Generate in parallel.**"), text.indexOf("6. **Merge**"));
    expect(step5).not.toContain("lint-cite");
  });

  it("D4 tuning: generator requires every needed line in a confirmed cite; auditor separates necessary omissions (confidence) from mere context (note)", () => {
    expect(norm("prompts/generator-rebuild.md")).toContain("A `confirmed` cite must contain EVERY line its exact claim needs");
    const aud = norm("prompts/auditor-rebuild.md");
    // review B1: an omitted line that is NECESSARY for the exact claim is a confidence matter, mere context is a note
    expect(aud).toContain("NECESSARY to verify the exact claim");
    expect(aud).toMatch(/report it in `confidence_errors` when the claim is tagged `confirmed`/);
    expect(aud).toContain("omits only context");
    expect(aud).not.toContain("merely omits a supporting line");
    expect(aud).not.toContain("never makes the verdict `revise` on its own");
    expect(norm("prompts/generator-rebuild.md")).toContain("STEP 7 — Self-check every cite BEFORE you reply");
  });

  it("E12: the fragment JSON example in package-templates.md passes lint-cite", () => {
    const md = read(join(SKILL, "references", "package-templates.md"));
    const section = md.slice(md.indexOf("## _fragments/<cap>.json"));
    const json = section.match(/```json\n([\s\S]*?)```/)?.[1] ?? "";
    expect(json).not.toBe("");
    const dir = mkdtempSync(join(tmpdir(), "rsfr-tpl-"));
    try {
      const p = join(dir, "example.json");
      writeFileSync(p, json);
      const r = spawnSync(process.execPath, [GUARD_PATH, "lint-cite", p], { encoding: "utf8" });
      expect(r.stderr).toBe("");
      expect(r.status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
