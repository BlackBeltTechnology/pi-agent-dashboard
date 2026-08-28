// Vitest for verdict.ts — query-time trust verdicts over a hit's DOX-row
// subject set. Uses the temp-git-repo pattern from dox-triage.test.ts.
// See change: add-kb-trust-verdicts-and-search-guard.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ackTargets, readStaleness } from "../dox-triage.js";
import type { KbHit } from "../types.js";
import type { EnrichCtx, VerdictFs } from "../verdict.js";
import { enrichHits } from "../verdict.js";

const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" });

/** Counting/spying fake fs — records every content read + cap, serves bytes from a map. */
function fakeFs(files: Record<string, Buffer | string>, opts: { failReads?: string[] } = {}): VerdictFs & { reads: string[]; caps: number[] } {
  const reads: string[] = [];
  const caps: number[] = [];
  return {
    reads,
    caps,
    stat(p: string): { size: number; mtimeMs: number } | null {
      const v = files[p];
      if (v === undefined) return null;
      const buf = Buffer.isBuffer(v) ? v : Buffer.from(v);
      return { size: buf.length, mtimeMs: 1000 };
    },
    read(p: string, cap: number): Buffer {
      reads.push(p);
      caps.push(cap);
      if (opts.failReads?.includes(p)) throw Object.assign(new Error("EACCES"), { code: "EACCES" });
      const v = files[p];
      const buf = Buffer.isBuffer(v) ? v : Buffer.from(v ?? "");
      return buf.subarray(0, cap);
    },
  };
}

function hit(partial: Partial<KbHit> & { body?: string }): KbHit {
  return {
    root: ".",
    path: "AGENTS.md",
    headingPath: "DOX — src",
    chunkId: "t:1",
    docType: "agents",
    score: 1,
    snippet: "",
    ...partial,
  };
}

describe("verdict: D1 label-only — verdicts never reorder (E14, task 1.3)", () => {
  it("returns hits in byte-identical order with verdicts on and off", async () => {
    const dir = mkdtempSync(join(tmpdir(), "verdict-d1-"));
    try {
      const a = join(dir, "a.ts");
      writeFileSync(a, "export const a = 1;\n");
      const body = "| File | Purpose |\n|------|---------|\n| `a.ts` | A. |\n| `ghost.ts` | Gone. |\n";
      const page = [hit({ path: "AGENTS.md", body, score: 2 }), hit({ path: "other.md", body: "prose", docType: "doc", score: 3 })];
      const on = await enrichHits(page.map((h) => ({ ...h })), { cwd: dir });
      const off = await enrichHits(page.map((h) => ({ ...h })), { cwd: dir, verdicts: false });
      expect(on.map((h) => `${h.root}:${h.path}:${h.chunkId}`)).toEqual(off.map((h) => `${h.root}:${h.path}:${h.chunkId}`));
      // A STALE/GONE hit keeps its rank — labelled, never demoted or suppressed.
      expect(on[0].verdict?.label).toBe("GONE");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("verdict: subject-set resolution (E8/E9, task 2.1)", () => {
  it("resolves the section's rows to subjects, capped at 8 in row order", async () => {
    const dir = mkdtempSync(join(tmpdir(), "verdict-cap-"));
    try {
      for (let i = 0; i < 9; i++) writeFileSync(join(dir, `f${i}.ts`), `export const v${i} = ${i};\n`);
      const rows = Array.from({ length: 9 }, (_, i) => `| \`f${i}.ts\` | F${i}. |`).join("\n");
      const body = `| File | Purpose |\n|------|---------|\n${rows}\n`;
      const [h] = await enrichHits([hit({ body })], { cwd: dir });
      expect(h.verdict).not.toBeNull();
      expect(h.verdict!.counts.total).toBe(9);
      expect(h.verdict!.counts.checked).toBe(8); // first 8 in row order
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exactly 8 rows → all 8 checked (cap boundary)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "verdict-cap8-"));
    try {
      for (let i = 0; i < 8; i++) writeFileSync(join(dir, `f${i}.ts`), `export const v${i} = ${i};\n`);
      const rows = Array.from({ length: 8 }, (_, i) => `| \`f${i}.ts\` | F${i}. |`).join("\n");
      const [h] = await enrichHits([hit({ body: `| File | Purpose |\n|------|---------|\n${rows}\n` })], { cwd: dir });
      expect(h.verdict!.counts.checked).toBe(8);
      expect(h.verdict!.counts.total).toBe(8);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a <File>.AGENTS.md sidecar row resolves as its own subject", async () => {
    const dir = mkdtempSync(join(tmpdir(), "verdict-sidecar-"));
    try {
      writeFileSync(join(dir, "big.spec.ts.AGENTS.md"), "# DOX — sidecar\n");
      const body = "| File | Purpose |\n|------|---------|\n| `big.spec.ts.AGENTS.md` | → see `big.spec.ts.AGENTS.md`. |\n";
      const [h] = await enrichHits([hit({ body })], { cwd: dir });
      expect(h.verdict!.counts.total).toBe(1);
      expect(h.verdict!.label).toBe("UNVERIFIED"); // exists, never acked
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a prose hit reports a null verdict (E9)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "verdict-prose-"));
    try {
      const [h] = await enrichHits([hit({ body: "Just prose, no DOX rows at all.", docType: "doc" })], { cwd: dir });
      expect(h.verdict).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("an unresolvable row yields no subject, never a guess", async () => {
    const dir = mkdtempSync(join(tmpdir(), "verdict-unres-"));
    try {
      // ../outside.ts anchors outside the indexed cwd — no subject, not GONE.
      const body = "| File | Purpose |\n|------|---------|\n| `../outside.ts` | Escapes the root. |\n";
      const [h] = await enrichHits([hit({ body })], { cwd: dir });
      expect(h.verdict).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a NON-DOX section (prose table) reports no verdict — no spurious GONE", async () => {
    const dir = mkdtempSync(join(tmpdir(), "verdict-prose-table-"));
    try {
      // Exactly the root-AGENTS.md shape: a prose table whose first cells are
      // not files. lint's inDox rule excludes it; verdicts must too.
      const body = "| You're about to… | Do this FIRST instead |\n|---|---|\n| `Explore` | Read-only search. |\n| `grep -rn Symbol` | use the lane. |\n";
      const [h] = await enrichHits([hit({ body, headingPath: "Subagent Routing" })], { cwd: dir });
      expect(h.verdict).toBeNull();
      expect(h.verdict).not.toMatchObject({ label: "GONE" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("verdict: the five labels (E1–E6, task 2.2)", () => {
  let repo: string;
  let v1: string;
  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), "verdict-labels-"));
    git(repo, "init", "-q");
    git(repo, "config", "user.email", "t@t.t");
    git(repo, "config", "user.name", "t");
    writeFileSync(join(repo, "fresh.ts"), "export const fresh = 1;\n");
    v1 = sha("export const stale = 1;\n");
    writeFileSync(join(repo, "stale.ts"), "export const stale = 1;\n");
    writeFileSync(join(repo, "moved.ts"), "export const moved = 1;\n");
    writeFileSync(join(repo, "gone.ts"), "export const gone = 1;\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-qm", "v1");
    // stale.ts edited after ack; moved.ts renamed (staged via git mv); gone.ts deleted (staged)
    writeFileSync(join(repo, "stale.ts"), "export const stale = 2;\n");
    git(repo, "mv", "moved.ts", "renamed.ts");
    git(repo, "rm", "-q", "gone.ts");
  });
  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  const body = "| File | Purpose |\n|------|---------|\n| `fresh.ts` | F. |\n| `stale.ts` | S. |\n| `moved.ts` | M. |\n| `gone.ts` | G. |\n| `unacked.ts` | U. |\n";

  it("FRESH: exists, hash matches acked (E1)", async () => {
    writeFileSync(join(repo, "unacked.ts"), "export const unacked = 1;\n");
    const acks = { "fresh.ts": { sha256: sha("export const fresh = 1;\n") } };
    const [h] = await enrichHits([hit({ body: "| File | Purpose |\n|------|---------|\n| `fresh.ts` | F. |\n" })], { cwd: repo, acks });
    expect(h.verdict!.label).toBe("FRESH");
  });

  it("STALE: exists, hash differs from acked (E2)", async () => {
    const acks = { "stale.ts": { sha256: v1 } };
    const [h] = await enrichHits([hit({ body: "| File | Purpose |\n|------|---------|\n| `stale.ts` | S. |\n" })], { cwd: repo, acks });
    expect(h.verdict!.label).toBe("STALE");
  });

  it("MOVED: absent subject with exactly one rename successor (E3)", async () => {
    const acks: Record<string, { sha256: string }> = {};
    const [h] = await enrichHits([hit({ body: "| File | Purpose |\n|------|---------|\n| `moved.ts` | M. |\n" })], { cwd: repo, acks });
    expect(h.verdict!.label).toBe("MOVED");
    expect(h.verdict!.movedTo).toEqual(["renamed.ts"]);
  });

  it("GONE: absent, no rename — and in a plain non-git dir (E4)", async () => {
    const [h] = await enrichHits([hit({ body: "| File | Purpose |\n|------|---------|\n| `gone.ts` | G. |\n" })], { cwd: repo });
    expect(h.verdict!.label).toBe("GONE");
    expect(h.verdict!.movedTo).toBeUndefined();
    const plain = mkdtempSync(join(tmpdir(), "verdict-plain-"));
    try {
      writeFileSync(join(plain, "a.ts"), "x");
      const [h2] = await enrichHits([hit({ body: "| File | Purpose |\n|------|---------|\n| `deleted.ts` | D. |\n" })], { cwd: plain });
      expect(h2.verdict!.label).toBe("GONE");
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });

  it("UNVERIFIED: exists but never acked — not STALE, not FRESH (E5)", async () => {
    writeFileSync(join(repo, "unacked.ts"), "export const unacked = 1;\n");
    const [h] = await enrichHits([hit({ body: "| File | Purpose |\n|------|---------|\n| `unacked.ts` | U. |\n" })], { cwd: repo });
    expect(h.verdict!.label).toBe("UNVERIFIED");
    expect(h.verdict!.label).not.toBe("STALE");
    expect(h.verdict!.label).not.toBe("FRESH");
  });

  it("existence precedes the hash gate: deleted AND never-acked = GONE, not UNVERIFIED (E6)", async () => {
    const [h] = await enrichHits([hit({ body: "| File | Purpose |\n|------|---------|\n| `gone.ts` | G. |\n" })], { cwd: repo });
    expect(h.verdict!.label).toBe("GONE");
  });
});

describe("verdict: worst-of aggregation + counts (E7, task 2.3)", () => {
  it("aggregates worst-of with per-label counts incl. total", async () => {
    const dir = mkdtempSync(join(tmpdir(), "verdict-agg-"));
    try {
      // 8 resolvable rows: 1 GONE (row acked, file deleted), 2 STALE, 5 FRESH
      const acks: Record<string, { sha256: string }> = {};
      const rows: string[] = [];
      const freshFiles = ["f1.ts", "f2.ts", "f3.ts", "f4.ts", "f5.ts"];
      for (const name of freshFiles) {
        const content = `export const ${name.slice(0, 1)}${name[1]} = 1;\n`;
        writeFileSync(join(dir, name), content);
        rows.push(`| \`${name}\` | ${name.slice(0, -3)}. |`);
        acks[name] = { sha256: sha(content) }; // hash matches → FRESH
      }
      for (const name of ["s1.ts", "s2.ts"]) {
        writeFileSync(join(dir, name), "edited after ack\n");
        rows.push(`| \`${name}\` | ${name.slice(0, -3)}. |`);
        acks[name] = { sha256: sha("original content\n") }; // ack predates edit → STALE
      }
      // g1.ts acked then deleted → GONE (row only, no file on disk)
      rows.unshift("| `g1.ts` | Gone. |");
      acks["g1.ts"] = { sha256: sha("once existed\n") };
      const body = `| File | Purpose |\n|------|---------|\n${rows.join("\n")}\n`;
      const [h] = await enrichHits([hit({ body })], { cwd: dir, acks });
      expect(h.verdict!.label).toBe("GONE");
      expect(h.verdict!.counts).toMatchObject({ gone: 1, stale: 2, fresh: 5, checked: 8, total: 8 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a section with zero resolvable rows reports no verdict", async () => {
    const dir = mkdtempSync(join(tmpdir(), "verdict-zero-"));
    try {
      const body = "| File | Purpose |\n|------|---------|\n| `../outside.ts` | Out. |\n";
      const [h] = await enrichHits([hit({ body })], { cwd: dir });
      expect(h.verdict).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("verdict: stat-baseline pre-filter (E11, task 2.4)", () => {
  const content = "export const baseline = 1;\n";
  const buf = Buffer.from(content);

  it("a matching stat baseline is never read (zero content reads) and reports FRESH", async () => {
    const dir = mkdtempSync(join(tmpdir(), "verdict-stat-"));
    try {
      const p = join(dir, "a.ts");
      writeFileSync(p, content);
      const fs = fakeFs({ [p]: buf });
      const acks = { "a.ts": { sha256: sha(content), size: buf.length, mtimeMs: 1000 } };
      const [h] = await enrichHits([hit({ body: "| File | Purpose |\n|------|---------|\n| `a.ts` | A. |\n" })], { cwd: dir, acks, fs });
      expect(fs.reads).toHaveLength(0);
      expect(h.verdict!.label).toBe("FRESH");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a mismatched baseline falls back to hashing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "verdict-stat2-"));
    try {
      const p = join(dir, "a.ts");
      const fs = fakeFs({ [p]: buf });
      const acks = { "a.ts": { sha256: sha(content), size: buf.length + 5, mtimeMs: 1000 } };
      const [h] = await enrichHits([hit({ body: "| File | Purpose |\n|------|---------|\n| `a.ts` | A. |\n" })], { cwd: dir, acks, fs });
      expect(fs.reads).toHaveLength(1); // hashed
      expect(h.verdict!.label).toBe("FRESH"); // hash matches acked sha
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("verdict: sidecar v2 (E12, task 2.7)", () => {
  it("acks persist {sha256, size, mtimeMs} with a version marker", async () => {
    const dir = mkdtempSync(join(tmpdir(), "verdict-v2-"));
    try {
      writeFileSync(join(dir, "a.ts"), "export const a = 1;\n");
      const sf = join(dir, "dox-staleness.json");
      expect(ackTargets({ cwd: dir, targets: ["a.ts"], stalenessFile: sf })).toBe(1);
      const raw = JSON.parse(readFileSync(sf, "utf8"));
      expect(raw.version).toBe(2);
      expect(raw.files["a.ts"]).toMatchObject({ sha256: sha("export const a = 1;\n"), size: 20, mtimeMs: expect.any(Number) });
      const recs = readStaleness(sf);
      expect(recs["a.ts"]!.sha256).toBe(sha("export const a = 1;\n"));
      expect(recs["a.ts"]!.size).toBe(20);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reads a v1 (sha-only) sidecar: stat fields unknown → hash runs, no crash", async () => {
    const dir = mkdtempSync(join(tmpdir(), "verdict-v1-"));
    try {
      const p = join(dir, "a.ts");
      const fs = fakeFs({ [p]: Buffer.from("export const a = 1;\n") });
      const sf = join(dir, "dox-staleness.json");
      writeFileSync(sf, JSON.stringify({ "a.ts": sha("export const a = 1;\n") })); // legacy v1
      const recs = readStaleness(sf);
      expect(recs["a.ts"]!.sha256).toBe(sha("export const a = 1;\n"));
      expect(recs["a.ts"]!.size).toBeUndefined();
      const [h] = await enrichHits([hit({ body: "| File | Purpose |\n|------|---------|\n| `a.ts` | A. |\n" })], { cwd: dir, acks: recs, fs });
      expect(fs.reads).toHaveLength(1); // unknown stat → hash fallback
      expect(h.verdict!.label).toBe("FRESH");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a future (v3) sidecar is not silently misread as v2", () => {
    const dir = mkdtempSync(join(tmpdir(), "verdict-v3-"));
    try {
      const sf = join(dir, "dox-staleness.json");
      writeFileSync(sf, JSON.stringify({ version: 3, files: { "a.ts": { sha256: "x", size: 1, mtimeMs: 2 } } }));
      expect(readStaleness(sf)).toEqual({});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("verdict: freshness caps (E10, task 2.8)", () => {
  const body = "| File | Purpose |\n|------|---------|\n| `big.ts` | B. |\n";

  it("1048576 bytes (1 MiB) is hashed; 1048577 is not (→ UNVERIFIED without baseline)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "verdict-cap-1mib-"));
    try {
      const exact = Buffer.alloc(1048576, 0x61);
      const p = join(dir, "big.ts");
      const fs = fakeFs({ [p]: exact });
      const acks = { "big.ts": { sha256: sha(exact) } };
      const [h] = await enrichHits([hit({ body })], { cwd: dir, acks, fs });
      expect(fs.reads).toHaveLength(1); // exactly 1 MiB → hashed
      expect(h.verdict!.label).toBe("FRESH");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    const dir2 = mkdtempSync(join(tmpdir(), "verdict-cap-1mib1-"));
    try {
      const over = Buffer.alloc(1048577, 0x61);
      const p = join(dir2, "big.ts");
      const fs = fakeFs({ [p]: over });
      const acks = { "big.ts": { sha256: sha(over) } };
      const [h] = await enrichHits([hit({ body })], { cwd: dir2, acks, fs });
      expect(fs.reads).toHaveLength(0); // never hashed
      expect(h.verdict!.label).toBe("UNVERIFIED");
    } finally {
      rmSync(dir2, { recursive: true, force: true });
    }
  });

  it("binary content is never hashed (→ UNVERIFIED without baseline)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "verdict-bin-"));
    try {
      const bin = Buffer.from([0x4e, 0x55, 0x4c, 0x00, 0x01, 0x02]);
      const p = join(dir, "big.ts");
      const fs = fakeFs({ [p]: bin });
      const acks = { "big.ts": { sha256: sha(bin) } };
      const [h] = await enrichHits([hit({ body })], { cwd: dir, acks, fs });
      expect(h.verdict!.label).toBe("UNVERIFIED");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("verdict: read-only enrichment (E15, task 2.9)", () => {
  it("performs no writes — no fs mutation, no sidecar write", async () => {
    const dir = mkdtempSync(join(tmpdir(), "verdict-ro-"));
    try {
      git(dir, "init", "-q");
      git(dir, "config", "user.email", "t@t.t");
      git(dir, "config", "user.name", "t");
      writeFileSync(join(dir, "stale.ts"), "v2\n");
      writeFileSync(join(dir, "gone.ts"), "v1\n");
      git(dir, "add", "-A");
      git(dir, "commit", "-qm", "v1");
      const body = "| File | Purpose |\n|------|---------|\n| `stale.ts` | S. |\n| `gone.ts` | G. |\n";
      const before = existsSync(join(dir, ".pi")) ? readFileSync(join(dir, ".pi", "dashboard", "kb", "dox-staleness.json"), "utf8") : "";
      const listingBefore = execFileSync("find", [dir, "-type", "f"], { encoding: "utf8" });
      await enrichHits([hit({ body })], { cwd: dir });
      const listingAfter = execFileSync("find", [dir, "-type", "f"], { encoding: "utf8" });
      expect(listingAfter).toBe(listingBefore); // zero files created/removed
      const after = existsSync(join(dir, ".pi")) ? readFileSync(join(dir, ".pi", "dashboard", "kb", "dox-staleness.json"), "utf8") : "";
      expect(after).toBe(before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("verdict: fault injection", () => {
  it("an unreadable subject (EACCES during hash) labels UNVERIFIED, no crash, no partial verdict (X2)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "verdict-eacces-"));
    try {
      const p = join(dir, "a.ts");
      const fs = fakeFs({ [p]: "secret" }, { failReads: [p] });
      const acks = { "a.ts": { sha256: sha("other") } };
      const [h] = await enrichHits([hit({ body: "| File | Purpose |\n|------|---------|\n| `a.ts` | A. |\n" })], { cwd: dir, acks, fs });
      expect(h.verdict!.label).toBe("UNVERIFIED");
      expect(h.verdict!.counts.unverified).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("git unavailable at rename-batch time: absent subject degrades to GONE, no throw, no guessed path (X3)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "verdict-nogit-"));
    try {
      const brokenGit = () => {
        throw new Error("git: command not found");
      };
      const [h] = await enrichHits([hit({ body: "| File | Purpose |\n|------|---------|\n| `deleted.ts` | D. |\n" })], { cwd: dir, git: brokenGit });
      expect(h.verdict!.label).toBe("GONE");
      expect(h.verdict!.movedTo).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("verdict: content coverage (E13, task 3.6 — default OFF)", () => {
  const content = "export function alpha() {}\nexport function beta() {}\n";
  const body = "| File | Purpose |\n|------|---------|\n| `a.ts` | A. |\n";

  it("off (default): no subject read for coverage, no coverage field", async () => {
    const dir = mkdtempSync(join(tmpdir(), "verdict-cov-off-"));
    try {
      const p = join(dir, "a.ts");
      writeFileSync(p, content);
      const fs = fakeFs({ [p]: Buffer.from(content) });
      const acks = { "a.ts": { sha256: sha(content), size: Buffer.byteLength(content), mtimeMs: 1000 } };
      const [h] = await enrichHits([hit({ body })], { cwd: dir, acks, fs });
      expect(fs.reads).toHaveLength(0); // stat short-circuit; no coverage read either
      expect(h.coverage).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("on: own coverage field; freshness verdict unchanged; read capped at 262144 bytes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "verdict-cov-on-"));
    try {
      const p = join(dir, "a.ts");
      writeFileSync(p, content);
      const fs = fakeFs({ [p]: Buffer.from(content) });
      const acks = { "a.ts": { sha256: sha(content), size: Buffer.byteLength(content), mtimeMs: 1000 } };
      const [h] = await enrichHits([hit({ body })], { cwd: dir, acks, fs, coverage: { query: "alpha beta" } });
      expect(h.verdict!.label).toBe("FRESH"); // unchanged by coverage
      expect(h.coverage).toBeDefined();
      expect(h.coverage).toBeGreaterThan(0);
      // Coverage reads are capped: the reader never asks for more than 262144 bytes.
      const big = Buffer.alloc(300 * 1024, 0x62);
      const fs2 = fakeFs({ [p]: big });
      const [h2] = await enrichHits([hit({ body })], { cwd: dir, acks: {}, fs: fs2, coverage: { query: "alpha" } });
      expect(h2.coverage).toBeDefined();
      expect(fs2.caps.every((c) => c <= 262144)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("verdict: disk-body default (store hits carry no body)", () => {
  it("resolves subjects from the source markdown ON DISK via headingPath match", async () => {
    const dir = mkdtempSync(join(tmpdir(), "verdict-disk-"));
    try {
      writeFileSync(join(dir, "a.ts"), "export const a = 1;\n");
      const md = [
        "# DOX — src",
        "",
        "| File | Purpose |",
        "|------|---------|",
        "| `a.ts` | A. |",
        "",
        "## Other section",
        "",
        "Prose without rows.",
      ].join("\n");
      writeFileSync(join(dir, "AGENTS.md"), md);
      // Store-shaped hit: NO inline body; disk is the only body source.
      const h = hit({ path: "AGENTS.md", headingPath: "DOX — src" });
      const [enriched] = await enrichHits([h], { cwd: dir });
      expect(enriched.verdict).not.toBeNull();
      expect(enriched.verdict!.counts.total).toBe(1);
      expect(enriched.verdict!.label).toBe("UNVERIFIED");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
