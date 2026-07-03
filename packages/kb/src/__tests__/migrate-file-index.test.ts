import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseFileIndex, planDirs, tier0Rows, renderAgentsMd, validateAuthored } from "../migrate-file-index.js";
import { areaFiles } from "../dox.js";

describe("migrate-file-index: parseFileIndex", () => {
  const text = [
    "# File Index — KB",
    "",
    "| File | Purpose |",
    "|------|---------|",
    "| `packages/kb/src/dox.ts` | DOX tree. Directory-level AGENTS.md scaffold. See change: migrate-file-index-to-agents-tree. |",
    "| `packages/kb/src/cli.ts` | kb CLI. Commands index|search. |", // pipe inside purpose
    "| not-a-row | ignored |",
  ].join("\n");

  it("parses rows into path → {purpose, seeChange}, preserving verbatim purpose", () => {
    const m = parseFileIndex(text);
    expect(m.size).toBe(2);
    const dox = m.get("packages/kb/src/dox.ts")!;
    expect(dox.purpose).toBe("DOX tree. Directory-level AGENTS.md scaffold. See change: migrate-file-index-to-agents-tree.");
    expect(dox.seeChange).toEqual(["migrate-file-index-to-agents-tree"]);
  });

  it("keeps a purpose that itself contains a pipe (code span) intact", () => {
    const m = parseFileIndex(text);
    expect(m.get("packages/kb/src/cli.ts")!.purpose).toBe("kb CLI. Commands index|search.");
  });
});

describe("migrate-file-index: planDirs (hit/miss + tiering)", () => {
  let dir: string;
  const setup = () => {
    dir = mkdtempSync(join(tmpdir(), "kb-mig-"));
    const w = (rel: string) => {
      const abs = join(dir, rel);
      mkdirSync(join(abs, ".."), { recursive: true });
      writeFileSync(abs, "export const x = 1;\n");
    };
    w("src/client/App.tsx");
    w("src/client/Missing.tsx"); // no index row → miss
    w("src/server/index.ts");
    return w;
  };

  it("classifies each file hit/miss and each dir tier-0/tier-1", () => {
    setup();
    const groups = areaFiles(dir);
    const index = new Map([
      ["src/client/App.tsx", { purpose: "App root.", seeChange: [] }],
      ["src/server/index.ts", { purpose: "Server entry.", seeChange: [] }],
    ]);
    const plans = planDirs(groups, index);
    const client = plans.find((p) => p.dir === "src/client")!;
    const server = plans.find((p) => p.dir === "src/server")!;
    expect(server.tier).toBe(0); // all hits
    expect(client.tier).toBe(1); // Missing.tsx is a miss
    expect(client.files.find((f) => f.base === "App.tsx")!.status).toBe("hit");
    expect(client.files.find((f) => f.base === "Missing.tsx")!.status).toBe("miss");
    // counts sum
    const total = plans.reduce((n, p) => n + p.files.length, 0);
    expect(total).toBe(3);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("migrate-file-index: tier0Rows + render (deterministic, verbatim)", () => {
  it("emits basename rows with verbatim purposes, path-alphabetical", () => {
    const plan = {
      dir: "src/server",
      tier: 0 as const,
      files: [
        { rel: "src/server/index.ts", base: "index.ts", status: "hit" as const, purpose: "Server entry." },
        { rel: "src/server/auth.ts", base: "auth.ts", status: "hit" as const, purpose: "Auth guard. See change: x." },
      ],
    };
    const rows = tier0Rows(plan);
    expect(rows[0]).toBe("| `auth.ts` | Auth guard. See change: x. |"); // alpha order
    expect(rows[1]).toBe("| `index.ts` | Server entry. |");
    const md = renderAgentsMd("src/server", rows);
    expect(md).toContain("| `auth.ts` | Auth guard. See change: x. |");
    expect(md).toMatch(/^# /); // has a heading
  });
});

describe("migrate-file-index: validateAuthored (structural gate)", () => {
  const plan = {
    dir: "src/client",
    tier: 1 as const,
    files: [
      { rel: "src/client/App.tsx", base: "App.tsx", status: "hit" as const, purpose: "App root." },
      { rel: "src/client/Missing.tsx", base: "Missing.tsx", status: "miss" as const },
    ],
  };

  it("passes when every file has exactly one non-empty row and hit purpose is byte-identical", () => {
    const r = validateAuthored(plan, [
      { base: "App.tsx", purpose: "App root." },
      { base: "Missing.tsx", purpose: "Lazy modal. Renders X." },
    ]);
    expect(r.ok).toBe(true);
  });

  it("fails on empty purpose, missing file, or drifted hit purpose", () => {
    expect(validateAuthored(plan, [{ base: "App.tsx", purpose: "App root." }]).ok).toBe(false); // missing Missing.tsx
    expect(validateAuthored(plan, [
      { base: "App.tsx", purpose: "App root." },
      { base: "Missing.tsx", purpose: "" },
    ]).ok).toBe(false); // empty miss
    expect(validateAuthored(plan, [
      { base: "App.tsx", purpose: "DRIFTED." },
      { base: "Missing.tsx", purpose: "ok." },
    ]).ok).toBe(false); // hit purpose changed
  });
});
