/**
 * Advisory-triage checker (change: harden-cors-and-csp-reporting, B26r, D11;
 * test-plan WE37–WE39, WE57–WE59, scenario-gap W-G23/W-G24).
 *
 * L1: drives `scripts/check-advisory-triage.mjs` with fixtures built in-test.
 * No network, no pnpm/npm process: the checker only reads the snapshot and the
 * triage file (WE57), plus package.json + pnpm-lock.yaml for the xlsx pin (WE38).
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const spawnSpies = vi.hoisted(() => ({
  spawn: vi.fn(),
  spawnSync: vi.fn(),
  exec: vi.fn(),
  execSync: vi.fn(),
  execFile: vi.fn(),
  execFileSync: vi.fn(),
  fork: vi.fn(),
}));
vi.mock("node:child_process", () => ({ ...spawnSpies, default: spawnSpies }));

import { checkTriage, checkXlsxPin, runCli } from "../../../../scripts/check-advisory-triage.mjs";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..", "..");
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), "utf-8");
/** The change dir, wherever it lives: active, or archived as `<date>-harden-cors-and-csp-reporting`. */
const CHANGE = (() => {
  const active = "openspec/changes/harden-cors-and-csp-reporting";
  if (fs.existsSync(path.join(repoRoot, active))) return active;
  const archive = path.join(repoRoot, "openspec/changes/archive");
  const hit = fs.existsSync(archive) ? fs.readdirSync(archive).find((d) => d.endsWith("-harden-cors-and-csp-reporting")) : undefined;
  return hit ? `openspec/changes/archive/${hit}` : active;
})();
const SCRIPT = "scripts/check-advisory-triage.mjs";
const OWNER = "bump-runtime-security-advisories";

/** Deterministic fake GHSA id: 1 → GHSA-aaaa-aaaa-aaa1 style (valid shape). */
const ghsa = (n: number) => `GHSA-${"a".repeat(4)}-${"b".repeat(4)}-${String(n).padStart(4, "0")}`;
const A1 = ghsa(1);
const A2 = ghsa(2);

const snapshot = (ids: string[]) =>
  JSON.stringify({
    advisories: Object.fromEntries(
      ids.map((id, i) => [String(1000 + i), { id: 1000 + i, github_advisory_id: id, module_name: `pkg-${i}`, severity: "high", findings: [] }]),
    ),
    metadata: {},
  });

const link = (id: string) => `https://github.com/advisories/${id}`;
interface RowOpts { id: string; cls?: string; reason?: string; owner?: string; withLink?: boolean }
const row = ({ id, cls = "build-only", reason = "dev tooling, never ships", owner = "n/a", withLink = true }: RowOpts) =>
  `| pkg@1.0.0 | ${id}${withLink ? ` ${link(id)}` : ""} | root>pkg | ${cls} | ${reason} | ${owner} |`;
const HEADER = "| package@version | advisory | path | class | reason | owner |\n|---|---|---|---|---|---|";
const triage = (rows: string[], extra = "") => `# Triage\n\n${HEADER}\n${rows.join("\n")}\n${extra}`;

/** Run the CLI body in-process on in-memory files. */
function run(snap: string, tri: string) {
  const err: string[] = [];
  const out: string[] = [];
  const reads: string[] = [];
  const files: Record<string, string> = { "snap.json": snap, "tri.md": tri };
  const code = runCli(["--snapshot", "snap.json", "--triage", "tri.md"], {
    readFile: (p: string) => {
      reads.push(p);
      return files[p];
    },
    stdout: (s: string) => out.push(s),
    stderr: (s: string) => err.push(s),
  });
  return { code, err, out, reads };
}

beforeEach(() => {
  for (const spy of Object.values(spawnSpies)) spy.mockClear();
});

describe("advisory-triage checker", () => {
  it("WE37 completeness: each broken fixture exits 1 naming the id and rule; A1 passes", () => {
    const ok = run(snapshot([A1]), triage([row({ id: A1 })]));
    expect(ok.code, ok.err.join("\n")).toBe(0);

    const A3 = ghsa(3);
    const A4 = ghsa(4);
    const A5 = ghsa(5);
    const A6 = ghsa(6);
    const cases: Array<[string, string, string, string]> = [
      [A2, "missing", snapshot([A1, A2]), triage([row({ id: A1 })])],
      [A3, "class", snapshot([A1, A3]), triage([row({ id: A1 }), row({ id: A3, cls: "maybe" })])],
      [A4, "reason", snapshot([A1, A4]), triage([row({ id: A1 }), row({ id: A4, reason: "" })])],
      [A5, "link", snapshot([A1, A5]), triage([row({ id: A1 }), row({ id: A5, withLink: false })])],
      [A6, "duplicate", snapshot([A1, A6]), triage([row({ id: A1 }), row({ id: A6 }), row({ id: A6 })])],
    ];
    for (const [id, rule, snap, tri] of cases) {
      const r = run(snap, tri);
      expect(r.code, `${rule}`).toBe(1);
      const line = r.err.find((l) => l.startsWith("error:") && l.includes(id));
      expect(line, `${rule}: error line naming ${id}`).toBeDefined();
      expect(line).toContain(rule);
      expect(r.err.some((l) => l.includes(A1) && l.startsWith("error:"))).toBe(false);
    }
  });

  it("WE37 a link for a different id does not satisfy the row", () => {
    const wrong = `| pkg@1.0.0 | ${A1} ${link(A2)} | p | build-only | dev tool | n/a |`;
    const r = run(snapshot([A1]), triage([wrong]));
    expect(r.code).toBe(1);
    expect(r.err.join("\n")).toMatch(new RegExp(`${A1}.*link`));
  });

  it("WE57 snapshot diff: untriaged A2 fails; spawns no pnpm/npm and reads only snapshot+triage", () => {
    const bad = run(snapshot([A1, A2]), triage([row({ id: A1 })]));
    expect(bad.code).toBe(1);
    expect(bad.err.some((l) => l.includes(A2) && l.includes("missing"))).toBe(true);
    expect(bad.err.some((l) => l.startsWith("error:") && l.includes(A1))).toBe(false);

    const good = run(snapshot([A1, A2]), triage([row({ id: A1 }), row({ id: A2 })]));
    expect(good.code, good.err.join("\n")).toBe(0);

    expect(good.reads.sort()).toEqual(["snap.json", "tri.md"]);
    for (const [name, spy] of Object.entries(spawnSpies)) expect(spy, name).not.toHaveBeenCalled();
    const source = read(SCRIPT);
    expect(source).not.toMatch(/child_process|execSync|spawn\(|fetch\(|https?\.request/);
  });

  it("WE58 stale row warns once and exits 0; an untriaged snapshot id still exits 1", () => {
    const A9 = ghsa(9);
    const stale = run(snapshot([A1]), triage([row({ id: A1 }), row({ id: A9 })]));
    expect(stale.code, stale.err.join("\n")).toBe(0);
    const warnings = stale.err.filter((l) => l.startsWith("warning:"));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(A9);
    expect(warnings[0]).toContain("stale: not in the audit snapshot");
    expect(stale.err.filter((l) => l.startsWith("error:"))).toEqual([]);

    const control = run(snapshot([A1, A2]), triage([row({ id: A1 }), row({ id: A9 })]));
    expect(control.code).toBe(1);
    expect(control.err.some((l) => l.startsWith("error:") && l.includes(A2))).toBe(true);
    expect(control.err.filter((l) => l.startsWith("warning:"))).toHaveLength(1);
  });

  it("WE59 reachable rows must name an owning change; build-only/accepted need only a reason", () => {
    const ids = [ghsa(11), ghsa(12), ghsa(13), ghsa(14), ghsa(15)];
    const [withOwner, emptyOwner, naOwner, build, accepted] = ids;
    const tri = triage([
      row({ id: withOwner, cls: "reachable", owner: OWNER }),
      row({ id: emptyOwner, cls: "reachable", owner: "" }),
      row({ id: naOwner, cls: "reachable", owner: "n/a" }),
      row({ id: build, cls: "build-only", owner: "" }),
      row({ id: accepted, cls: "accepted", owner: "" }),
    ]);
    const r = run(snapshot(ids), tri);
    expect(r.code).toBe(1);
    const errors = r.err.filter((l) => l.startsWith("error:"));
    expect(errors).toHaveLength(2);
    expect(errors.some((l) => l.includes(emptyOwner) && l.includes("owner"))).toBe(true);
    expect(errors.some((l) => l.includes(naOwner) && l.includes("owner"))).toBe(true);
    for (const ok of [withOwner, build, accepted]) expect(errors.some((l) => l.includes(ok))).toBe(false);

    // empty reason is still rejected for every class
    const emptyReason = run(snapshot([build]), triage([row({ id: build, cls: "build-only", reason: "" })]));
    expect(emptyReason.code).toBe(1);
  });

  it("WE39 every GHSA row carries its advisory link; URL-tarball rows are link-checked but not diffed", () => {
    const X1 = "GHSA-4r6h-8v6p-xvw6";
    const X2 = "GHSA-5pgg-2g8v-p4x9";
    const F = "GHSA-p68q-wchp-6fh7";
    const urlSection = (rows: string[]) =>
      `\n## URL-tarball (not covered by pnpm audit)\n\n| package@version | advisory | fixed in | verified |\n|---|---|---|---|\n${rows.join("\n")}\n`;
    const xlsxRows = [
      `| xlsx@0.20.3 | ${X1} ${link(X1)} | 0.19.3 | 2026-10-23 |`,
      `| xlsx@0.20.3 | ${X2} ${link(X2)} | 0.20.2 | 2026-10-23 |`,
    ];
    const fastify = row({ id: F, cls: "reachable", owner: OWNER }).replace("pkg@1.0.0", "fastify@5.12.1");
    const good = checkTriage({ snapshotText: snapshot([F]), triageText: triage([fastify], urlSection(xlsxRows)) });
    expect(good.errors).toEqual([]);
    expect(good.warnings).toEqual([]); // URL-tarball ids are not "stale"

    const noLink = `| xlsx@0.20.3 | ${X2} | 0.20.2 | 2026-10-23 |`;
    const bad = checkTriage({ snapshotText: snapshot([F]), triageText: triage([fastify], urlSection([xlsxRows[0], noLink])) });
    expect(bad.errors.map((e) => e.id)).toEqual([X2]);
    expect(bad.errors[0].rule).toBe("link");

    const linkless = run(snapshot([F]), triage([row({ id: F, cls: "reachable", owner: OWNER, withLink: false })]));
    expect(linkless.code).toBe(1);
  });

  it("WE39 committed triage: carve-out rows (fastify, nodemailer, linkify-it) name bump-runtime-security-advisories", () => {
    const triageText = read(`${CHANGE}/advisory-triage.md`);
    const rows = triageText.split("\n").filter((l) => l.startsWith("|") && l.includes("GHSA-"));
    for (const pkg of ["fastify@", "nodemailer@", "linkify-it@"]) {
      const mine = rows.filter((l) => l.split("|")[1].trim().startsWith(pkg));
      expect(mine.length, pkg).toBeGreaterThan(0);
      for (const l of mine) expect(l.split("|")[6].trim(), l).toContain(OWNER);
    }
    expect(triageText).toContain("GHSA-p68q-wchp-6fh7");
    for (const [id, fixed] of [["GHSA-4r6h-8v6p-xvw6", "0.19.3"], ["GHSA-5pgg-2g8v-p4x9", "0.20.2"]] as const) {
      const line = triageText.split("\n").find((l) => l.startsWith("|") && l.includes(id));
      expect(line, id).toBeDefined();
      expect(line).toContain(link(id));
      expect(line).toContain(fixed);
    }
  });

  it("the committed snapshot and triage agree (no unclassified advisory, no violations)", () => {
    const r = checkTriage({
      snapshotText: read(`${CHANGE}/advisory-audit-snapshot.json`),
      triageText: read(`${CHANGE}/advisory-triage.md`),
    });
    expect(r.errors.map((e) => e.message)).toEqual([]);
  });
});

describe("xlsx CDN pin integrity (WE38)", () => {
  const URL_PIN = "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz";
  const INTEGRITY = `sha512-${"A".repeat(86)}==`;
  const pkgJson = (u = URL_PIN) => JSON.stringify({ dependencies: { xlsx: u } });
  const lock = (resolution: string, extra = "") =>
    `packages:\n\n  other@1.0.0:\n    resolution: {integrity: sha512-x}\n\n  xlsx@${URL_PIN}:\n    resolution: {${resolution}}${extra}\n\nsnapshots:\n\n  xlsx@${URL_PIN}: {}\n`;

  it("the repo pin has an 88-char sha512 integrity and a version equal to the URL segment", () => {
    const r = checkXlsxPin({ packageJsonText: read("packages/server/package.json"), lockText: read("pnpm-lock.yaml") });
    expect(r.errors).toEqual([]);
    expect(r.version).toBe("0.20.3");
    expect(r.url).toMatch(/\/xlsx-0\.20\.3\/xlsx-0\.20\.3\.tgz$/);
    const entry = read("pnpm-lock.yaml").split("\n").find((l) => l.startsWith(`  xlsx@${r.url}:`));
    expect(entry).toBeDefined();
    expect(read("pnpm-lock.yaml")).toMatch(/integrity: sha512-[A-Za-z0-9+/]{86}==, tarball: https:\/\/cdn\.sheetjs\.com\/xlsx-0\.20\.3\/xlsx-0\.20\.3\.tgz/);
  });

  it("passes a fixture with integrity", () => {
    expect(checkXlsxPin({ packageJsonText: pkgJson(), lockText: lock(`integrity: ${INTEGRITY}, tarball: ${URL_PIN}`) }).errors).toEqual([]);
  });

  it("a fixture lock lacking integrity fails", () => {
    const r = checkXlsxPin({ packageJsonText: pkgJson(), lockText: lock(`tarball: ${URL_PIN}`) });
    expect(r.errors.join("\n")).toContain("no `integrity`");
  });

  it("a malformed / wrong-length integrity fails", () => {
    const r = checkXlsxPin({ packageJsonText: pkgJson(), lockText: lock(`integrity: sha512-${"A".repeat(40)}==, tarball: ${URL_PIN}`) });
    expect(r.errors.join("\n")).toContain("not sha512");
  });

  it("a lock entry for a different version / an explicit version mismatch fails", () => {
    const other = "https://cdn.sheetjs.com/xlsx-0.20.2/xlsx-0.20.2.tgz";
    const missing = checkXlsxPin({ packageJsonText: pkgJson(other), lockText: lock(`integrity: ${INTEGRITY}, tarball: ${URL_PIN}`) });
    expect(missing.errors.join("\n")).toContain("no packages entry for exactly");
    const mismatch = checkXlsxPin({
      packageJsonText: pkgJson(),
      lockText: lock(`integrity: ${INTEGRITY}, tarball: ${URL_PIN}`, "\n    version: 0.19.3"),
    });
    expect(mismatch.errors.join("\n")).toContain('lock version "0.19.3"');
  });

  it("runCli --xlsx fails on a lock without integrity and passes on the repo files", () => {
    const files: Record<string, string> = {
      "snap.json": snapshot([A1]),
      "tri.md": triage([row({ id: A1 })]),
      "packages/server/package.json": pkgJson(),
      "pnpm-lock.yaml": lock(`tarball: ${URL_PIN}`),
    };
    const err: string[] = [];
    const io = { readFile: (p: string) => files[p], stdout: () => {}, stderr: (s: string) => err.push(s) };
    expect(runCli(["--snapshot", "snap.json", "--triage", "tri.md", "--xlsx"], io)).toBe(1);
    expect(err.join("\n")).toContain("no `integrity`");
  });
});
