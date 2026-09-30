// spec-collateral scan (change: add-spec-collateral-scan, test-plan E1–E26,
// P1–P2, X1–X5). Pure functions are driven directly (exemplar:
// check-pi-settings-paths.test.mjs); the CLI runs as a child process over
// synthetic fixture corpora in a temp dir (exemplar: check-kb-dist-fresh).
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { extractIdentifiers, renderMarkdown, scanCollateral } from "../spec-collateral.mjs";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "..", "spec-collateral.mjs");

const spec = (...reqs) =>
  `# Spec\n\n## Purpose\n\nx\n\n## Requirements\n\n${reqs
    .map(([name, body]) => `### Requirement: ${name}\n\n${body}\n\n#### Scenario: s\n- **WHEN** a\n- **THEN** b\n`)
    .join("\n")}`;
const keys = (text) => [...extractIdentifiers(text).keys()];
const filler = (count, prefix = "filler-cap") =>
  Array.from({ length: count }, (_, i) => ({ capability: `${prefix}-${String(i).padStart(4, "0")}`, text: spec(["Plain", "nothing here"]) }));

describe("extractIdentifiers", () => {
  it("E1 plain capitalised words are ignored", () => {
    const k = keys("Use `Tasks`, `Popover` and `Apply` here.");
    for (const w of ["Tasks", "Popover", "Apply"]) expect(k).not.toContain(w);
  });

  it("E2 code identifiers are kept (path reduces to basename + code-shaped stem)", () => {
    const k = keys(
      "Touches `SessionOpenSpecActions`, `CORE_PACKAGE_NAMES`, `@earendil-works/pi-ai`, `stats_update` and `packages/server/src/pi-core-checker.ts`.",
    );
    for (const w of ["SessionOpenSpecActions", "CORE_PACKAGE_NAMES", "@earendil-works/pi-ai", "stats_update", "pi-core-checker.ts", "pi-core-checker"])
      expect(k).toContain(w);
  });

  it("E3 OpenSpec keywords and bare flags are ignored", () => {
    const k = keys("`MODIFIED` and `RENAMED` sections; usage `[--json]` `--top`.");
    for (const w of ["MODIFIED", "RENAMED", "--json", "--top", "[--json]"]) expect(k).not.toContain(w);
  });

  it("E4 packages, routes and CSS variables survive; paths reduce", () => {
    const k = keys("`@earendil-works/pi-ai` calls `/api/pi-core/update`; `--accent-green` in `packages/client/src/index.css`.");
    for (const w of ["@earendil-works/pi-ai", "/api/pi-core/update", "--accent-green", "index.css"]) expect(k).toContain(w);
    expect(k).not.toContain("index");
  });

  it("E5 citation suffixes are stripped", () => {
    const k = keys("See `packages/server/src/pi-core-checker.ts:42` and review-gate.ts:17-73 for details.");
    expect(k).toContain("pi-core-checker.ts");
    expect(k).toContain("review-gate.ts");
    expect(k.some((x) => x.includes(":42") || x.includes(":17-73"))).toBe(false);
  });

  it("E7 bare code-shaped tokens are kept without backticks", () => {
    expect(keys("the helper calls resolveReviewer first")).toContain("resolveReviewer");
  });

  it("E8 intent sentences triple the multiplier", () => {
    const ids = extractIdentifiers("Remove `fooBarAlpha`.\nKeep `fooBarBeta`.");
    expect(ids.get("fooBarAlpha")).toBe(3);
    expect(ids.get("fooBarBeta")).toBe(1);
  });

  it("tokens adjacent to table pipes, commas and semicolons are still extracted", () => {
    const k = keys("|fooBarAlpha|fooBarBeta| and fooBarGamma,fooBarDelta;fooBarEps");
    for (const w of ["fooBarAlpha", "fooBarBeta", "fooBarGamma", "fooBarDelta", "fooBarEps"]) expect(k).toContain(w);
  });

  it("intent needs a real verb form: a word merely starting with a verb stem is neutral", () => {
    expect(extractIdentifiers("The dropdown uses fooBarAlpha.").get("fooBarAlpha")).toBe(1);
    expect(extractIdentifiers("Retirement party for fooBarBeta, a hidden gem.").get("fooBarBeta")).toBe(3);
    for (const s of ["removes", "replaced", "renaming", "dropped", "retires", "hides", "narrowed", "forbidden"])
      expect(extractIdentifiers(`This ${s} fooBarGamma.`).get("fooBarGamma")).toBe(3);
  });

  it("E9 multiplier is the max over occurrences; bullets are separate sentences", () => {
    const ids = extractIdentifiers("- neutral mention of `fooBarAlpha`\n- drop `fooBarAlpha`\n- keeps `fooBarGamma`");
    expect(ids.get("fooBarAlpha")).toBe(3);
    expect(ids.get("fooBarGamma")).toBe(1);
  });
});

describe("scanCollateral", () => {
  it("E6 capability names (corpus + delta-only) are excluded", () => {
    const r = scanCollateral({
      identifiers: extractIdentifiers("Changes `plan-proposal-orchestrator` and adds `spec-collateral-scan`."),
      mainSpecs: [{ capability: "plan-proposal-orchestrator", text: spec(["R", "mentions spec-collateral-scan and plan-proposal-orchestrator"]) }, ...filler(3)],
      deltaTexts: { "spec-collateral-scan": "## ADDED Requirements\n" },
    });
    const ids = r.identifiers.map((i) => i.id);
    expect(ids).not.toContain("plan-proposal-orchestrator");
    expect(ids).not.toContain("spec-collateral-scan");
  });

  it("E8 a removed identifier outranks an equally rare kept one", () => {
    const r = scanCollateral({
      identifiers: extractIdentifiers("Remove `fooBarAlpha`.\nKeep `fooBarBeta`."),
      mainSpecs: [
        { capability: "cap-alpha", text: spec(["Ra", "uses fooBarAlpha"]) },
        { capability: "cap-beta", text: spec(["Rb", "uses fooBarBeta"]) },
        ...filler(8),
      ],
    });
    expect(r.t1.entries.map((e) => e.capability)).toEqual(["cap-alpha", "cap-beta"]);
    expect(r.t1.entries[0].score).toBeGreaterThan(r.t1.entries[1].score);
  });

  it("E10 df cap on N=657: 26 contributes, 27 is dropped", () => {
    const mainSpecs = filler(657).map((s, i) => ({
      capability: s.capability,
      text: spec(["R", `${i < 26 ? "idTwentySix" : ""} ${i < 27 ? "idTwentySeven" : ""}`]),
    }));
    const r = scanCollateral({ identifiers: extractIdentifiers("`idTwentySix` `idTwentySeven`"), mainSpecs });
    const ids = r.identifiers.map((i) => i.id);
    expect(ids).toContain("idTwentySix");
    expect(ids).not.toContain("idTwentySeven");
    const all = [...r.t1.entries, ...r.t2.entries].flatMap((e) => e.identifiers);
    expect(all).not.toContain("idTwentySeven");
    expect(r.t1.entries[0].identifiers).toEqual(["idTwentySix"]);
  });

  it("E11 small corpus floor of two: 2 contributes, 3 is dropped", () => {
    const mainSpecs = filler(20).map((s, i) => ({
      capability: s.capability,
      text: spec(["R", `${i < 2 ? "idInTwo" : ""} ${i < 3 ? "idInThree" : ""}`]),
    }));
    const r = scanCollateral({ identifiers: extractIdentifiers("`idInTwo` `idInThree`"), mainSpecs });
    const ids = r.identifiers.map((i) => i.id);
    expect(ids).toContain("idInTwo");
    expect(ids).not.toContain("idInThree");
  });

  it("E12 df = 0 matches nothing and yields no Infinity/NaN", () => {
    const r = scanCollateral({
      identifiers: extractIdentifiers("`nowhereToken` and `somewhereToken`"),
      mainSpecs: [{ capability: "cap-x", text: spec(["R", "somewhereToken"]) }, ...filler(5)],
    });
    const all = [...r.t1.entries, ...r.t2.entries];
    expect(all.flatMap((e) => e.identifiers)).not.toContain("nowhereToken");
    expect(r.identifiers.map((i) => i.id)).not.toContain("nowhereToken");
    for (const n of [...r.identifiers.map((i) => i.weight), ...all.map((e) => e.score)]) expect(Number.isFinite(n)).toBe(true);
  });

  it("E13 occurrences are token-bounded", () => {
    const r = scanCollateral({
      identifiers: extractIdentifiers("`pi-core-version`"),
      mainSpecs: [
        { capability: "cap-a", text: spec(["A", "only pi-core-version-check here"]) },
        { capability: "cap-b", text: spec(["B", "file pi-core-version.ts here"]) },
        { capability: "cap-c", text: spec(["C", "see (pi-core-version) here"]) },
        ...filler(60),
      ],
    });
    expect(r.t1.entries.map((e) => e.capability).sort()).toEqual(["cap-b", "cap-c"]);
  });

  it("E14 best single requirement outranks many weak matches", () => {
    const common = ["idCommonA", "idCommonB", "idCommonC", "idCommonD", "idCommonE"];
    const mainSpecs = filler(100);
    // each common id also appears in 3 filler specs (df 4, under the cap of 4)
    common.forEach((id, k) => {
      for (let j = 0; j < 3; j++) mainSpecs[k * 3 + j] = { ...mainSpecs[k * 3 + j], text: spec(["F", id]) };
    });
    mainSpecs.push({ capability: "cap-a", text: spec(["Rare", "rareRemovedId"]) });
    mainSpecs.push({ capability: "cap-b", text: spec(...common.map((id, i) => [`R${i}`, id])) });
    const r = scanCollateral({
      identifiers: extractIdentifiers(`Remove \`rareRemovedId\`.\n\n${common.map((c) => `\`${c}\``).join(" ")}`),
      mainSpecs,
      top: 200,
    });
    const order = r.t1.entries.map((e) => e.capability);
    expect(order.indexOf("cap-a")).toBeLessThan(order.indexOf("cap-b"));
  });

  it("E15/E16/E17 T2 lists unmodified requirements only", () => {
    const main = spec(["Kept", "names touchedId"], ["Changed", "names touchedId"], ["Gone", "touchedId"], ["Old name", "touchedId"]);
    const r = scanCollateral({
      identifiers: extractIdentifiers("`touchedId`"),
      mainSpecs: [{ capability: "cap-c", text: main }, ...filler(30)],
      deltaTexts: {
        "cap-c": [
          "## ADDED Requirements\n### Requirement: Brand new\nx",
          "## MODIFIED Requirements\n### Requirement: Changed\nx",
          "## REMOVED Requirements\n### Requirement: Gone\nx",
          "## RENAMED Requirements\n- FROM: `### Requirement: Old name`\n- TO: `### Requirement: New name`",
        ].join("\n\n"),
      },
    });
    expect(r.t2.entries.map((e) => [e.capability, e.requirement])).toEqual([["cap-c", "Kept"]]);
  });

  it("RENAMED FROM names with embedded backticks are excluded from T2", () => {
    const r = scanCollateral({
      identifiers: extractIdentifiers("`touchedId`"),
      mainSpecs: [{ capability: "cap-c", text: spec(["In-process `@fast` title generation", "touchedId"], ["Kept", "touchedId"]) }, ...filler(30)],
      deltaTexts: {
        "cap-c": "## RENAMED Requirements\n- FROM: `### Requirement: In-process `@fast` title generation`\n- TO: `### Requirement: New`\n",
      },
    });
    expect(r.t2.entries.map((e) => e.requirement)).toEqual(["Kept"]);
  });

  it("E18 delta capabilities are not in T1", () => {
    const r = scanCollateral({
      identifiers: extractIdentifiers("Remove `strongId`."),
      mainSpecs: [{ capability: "cap-c", text: spec(["R", "strongId"]) }, ...filler(10)],
      deltaTexts: { "cap-c": "## ADDED Requirements\n" },
    });
    expect(r.t1.entries.map((e) => e.capability)).not.toContain("cap-c");
  });

  it("E19 T1 is empty when nothing outside the delta matches", () => {
    const r = scanCollateral({ identifiers: extractIdentifiers("`unmatchedId`"), mainSpecs: filler(10) });
    expect(r.t1).toEqual({ entries: [], omitted: 0 });
  });

  it("E20 T2 limit is global across delta capabilities and announced", () => {
    const ids = Array.from({ length: 14 }, (_, i) => `rankId${String.fromCharCode(65 + i)}x`);
    const counts = [5, 5, 4];
    let k = 0;
    const mainSpecs = [];
    const deltaTexts = {};
    counts.forEach((c, ci) => {
      const reqs = [];
      for (let j = 0; j < c; j++, k++) reqs.push([`Req ${String(k).padStart(2, "0")}`, ids.slice(0, k + 1).join(" ")]);
      mainSpecs.push({ capability: `delta-cap-${ci}`, text: spec(...reqs) });
      deltaTexts[`delta-cap-${ci}`] = "## ADDED Requirements\n";
    });
    mainSpecs.push(...filler(400));
    const r = scanCollateral({ identifiers: extractIdentifiers(ids.map((i) => `\`${i}\``).join(" ")), mainSpecs, deltaTexts, top: 10 });
    expect(r.t2.entries).toHaveLength(10);
    expect(r.t2.omitted).toBe(4);
    // highest-scoring overall = the requirements naming the most identifiers (k = 4..13)
    expect(r.t2.entries.map((e) => e.requirement).sort()).toEqual(Array.from({ length: 10 }, (_, i) => `Req ${String(i + 4).padStart(2, "0")}`));
    expect(renderMarkdown(r)).toContain("4 omitted");
  });

  it("markdown cells escape backslashes before pipes, so a cell cannot break the table", () => {
    const md = renderMarkdown({
      t1: { entries: [{ capability: "cap-x", requirement: "ends with \\|and pipe", score: 1, identifiers: ["someIdent"] }], omitted: 0 },
      t2: { entries: [], omitted: 0 },
      identifiers: [],
    });
    const row = md.split("\n").find((l) => l.startsWith("| 1 |"));
    expect(row).toContain("ends with \\\\\\|and pipe");
    // exactly 6 unescaped pipes = 5 columns; an escape bug would add a column
    expect(row.match(/(?<!\\)(?:\\\\)*\|/g)).toHaveLength(6);
  });

  it("E21 deterministic tie-break: capability then requirement name ascending", () => {
    const r = scanCollateral({
      identifiers: extractIdentifiers("`tieIdOne` `tieIdTwo`"),
      mainSpecs: [
        { capability: "beta-cap-y", text: spec(["R", "tieIdOne"]) },
        { capability: "alpha-cap-x", text: spec(["R", "tieIdTwo"]) },
        // `Mod` lifts tieIdTwo's df to 2 (equal weights) but is MODIFIED, so it is not in T2
        { capability: "delta-cap", text: spec(["Zeta", "tieIdOne"], ["Alpha", "tieIdOne"], ["Mod", "tieIdTwo"]) },
        ...filler(47),
      ],
      deltaTexts: { "delta-cap": "## MODIFIED Requirements\n### Requirement: Mod\nx\n" },
    });
    expect(r.t1.entries.map((e) => e.capability)).toEqual(["alpha-cap-x", "beta-cap-y"]);
    expect(r.t2.entries.map((e) => e.requirement)).toEqual(["Alpha", "Zeta"]);
  });

  it("P1 each main spec is read exactly once", () => {
    const reads = new Map();
    const mainSpecs = Array.from({ length: 700 }, (_, i) => ({ capability: `cap-${i}`, path: `/virtual/${i}/spec.md` }));
    scanCollateral({
      identifiers: extractIdentifiers("`someIdent` `otherIdent`"),
      mainSpecs,
      readFile: (p) => {
        reads.set(p, (reads.get(p) ?? 0) + 1);
        return spec(["R", p.endsWith("/3/spec.md") ? "someIdent" : "x"]);
      },
    });
    expect(reads.size).toBe(700);
    expect([...reads.values()].every((n) => n === 1)).toBe(true);
  });
});

// ── CLI over fixture corpora ─────────────────────────────────────────────────

let root;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "spec-collateral-"));
});
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Write a fixture repo: `specs` = { cap: specText }, `change` = { file: text } (paths relative to the change dir). */
function fixture(name, { specs, change }) {
  const dir = join(root, name);
  for (const [cap, text] of Object.entries(specs)) {
    mkdirSync(join(dir, "openspec", "specs", cap), { recursive: true });
    writeFileSync(join(dir, "openspec", "specs", cap, "spec.md"), text);
  }
  for (const [file, text] of Object.entries(change)) {
    const p = join(dir, "openspec", "changes", "the-change", file);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text);
  }
  return dir;
}
const run = (cwd, ...args) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: "utf8" });
const fillerSpecs = (count) => Object.fromEntries(filler(count).map((s) => [s.capability, s.text]));

/** ≥ 5 candidates in each list. */
function richFixture(name) {
  const ids = ["richIdA", "richIdB", "richIdC", "richIdD", "richIdE", "richIdF"];
  const specs = fillerSpecs(100);
  ids.forEach((id, i) => {
    specs[`outside-cap-${i}`] = spec(["R", id]);
  });
  specs["delta-cap"] = spec(...ids.map((id, i) => [`Req ${i}`, id]));
  return fixture(name, {
    specs,
    change: {
      "proposal.md": `Remove ${ids.map((i) => `\`${i}\``).join(", ")}.\n`,
      "tasks.md": "- [ ] 1.1 do it\n",
      "specs/delta-cap/spec.md": "## ADDED Requirements\n### Requirement: New\nx\n",
    },
  });
}

describe("CLI", () => {
  it("E22 output is byte-identical across runs, per format", () => {
    const dir = richFixture("determinism");
    expect(run(dir, "--change", "the-change").stdout).toBe(run(dir, "--change", "the-change").stdout);
    expect(run(dir, "--change", "the-change", "--json").stdout).toBe(run(dir, "--change", "the-change", "--json").stdout);
  });

  it("E23/X4 JSON shape; non-empty findings still exit 0", () => {
    const r = run(richFixture("shape"), "--change", "the-change", "--json");
    expect(r.status).toBe(0);
    const j = JSON.parse(r.stdout);
    expect(Array.isArray(j.t1.entries)).toBe(true);
    expect(typeof j.t1.omitted).toBe("number");
    expect(Array.isArray(j.t2.entries)).toBe(true);
    expect(typeof j.t2.omitted).toBe("number");
    expect(j.t1.entries.length).toBeGreaterThan(0);
    expect(j.t2.entries.length).toBeGreaterThan(0);
    expect(Array.isArray(j.identifiers)).toBe(true);
    expect(j.identifiers.length).toBeGreaterThan(0);
    for (const i of j.identifiers) expect(Object.keys(i).sort()).toEqual(["id", "weight"]);
  });

  it("E24 identifiers are reported after stoplist and frequency cap", () => {
    const specs = fillerSpecs(657);
    Object.keys(specs).forEach((cap, i) => {
      specs[cap] = spec(["R", `${i < 26 ? "idTwentySix" : ""} ${i < 27 ? "idTwentySeven" : ""} MODIFIED`]);
    });
    const dir = fixture("cap", { specs, change: { "proposal.md": "Touch `idTwentySix`, `idTwentySeven`, `MODIFIED`.\n" } });
    const ids = JSON.parse(run(dir, "--change", "the-change", "--json").stdout).identifiers.map((i) => i.id);
    expect(ids).toContain("idTwentySix");
    expect(ids).not.toContain("idTwentySeven");
    expect(ids).not.toContain("MODIFIED");
  });

  it("E25 a missing design.md reads as empty", () => {
    const dir = fixture("no-design", {
      specs: { ...fillerSpecs(5), "cap-x": spec(["R", "presentId"]) },
      change: { "proposal.md": "Uses `presentId`.\n", "tasks.md": "- [ ] 1.1 x\n" },
    });
    const r = run(dir, "--change", "the-change");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("cap-x");
  });

  it("E26 --top caps each list and reports the rest as omitted", () => {
    const j = JSON.parse(run(richFixture("top"), "--change", "the-change", "--top", "3", "--json").stdout);
    const full = JSON.parse(run(richFixture("top-full"), "--change", "the-change", "--top", "100", "--json").stdout);
    for (const t of ["t1", "t2"]) {
      expect(full[t].entries.length).toBeGreaterThanOrEqual(5);
      expect(j[t].entries.length).toBeLessThanOrEqual(3);
      expect(j[t].omitted).toBe(full[t].entries.length - 3);
    }
  });

  it("P2 700 specs × 8 requirements with 60 identifiers completes in < 10 s", () => {
    const ids = Array.from({ length: 60 }, (_, i) => `perfIdent${i}x`);
    const specs = {};
    for (let s = 0; s < 700; s++) {
      specs[`perf-cap-${s}`] = spec(...Array.from({ length: 8 }, (_, r) => [`Req ${r}`, `mentions ${ids[(s * 8 + r) % 60]} and more prose here`]));
    }
    const dir = fixture("perf", { specs, change: { "proposal.md": ids.map((i) => `\`${i}\``).join(" ") } });
    const t0 = Date.now();
    const r = run(dir, "--change", "the-change", "--json");
    expect(r.status).toBe(0);
    expect(Date.now() - t0).toBeLessThan(10_000);
  });

  const codes = [];
  it("X1 unknown change → exit 2 naming it", () => {
    const r = run(richFixture("x1"), "--change", "does-not-exist");
    codes.push(r.status);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("does-not-exist");
  });

  it("X2 missing specs dir → exit 2 naming it", () => {
    const r = run(richFixture("x2"), "--change", "the-change", "--specs", "/nonexistent-dir");
    codes.push(r.status);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("/nonexistent-dir");
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)("X3 unreadable spec → exit 2 naming the file", () => {
    const dir = richFixture("x3");
    const bad = join(dir, "openspec", "specs", "outside-cap-0", "spec.md");
    chmodSync(bad, 0o000);
    try {
      const r = run(dir, "--change", "the-change");
      codes.push(r.status);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain(bad);
    } finally {
      chmodSync(bad, 0o644);
    }
  });

  it("X4 findings → exit 0", () => {
    const r = run(richFixture("x4"), "--change", "the-change");
    codes.push(r.status);
    expect(r.status).toBe(0);
  });

  it("X5 exit codes are only 0 or 2, never 1", () => {
    expect(codes.length).toBeGreaterThanOrEqual(3);
    for (const c of codes) expect([0, 2]).toContain(c);
    expect(codes).not.toContain(1);
  });
});
