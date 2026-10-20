/**
 * Tests for the pure dependency parser, reader, inference, graph and waves.
 * See change: add-openspec-change-dependencies (test-plan #E1–#E13).
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import * as fsp from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  type ChangeInputs,
  computeDependencyGraph,
  type DeclaredState,
  parseDependenciesFile,
  readDependenciesFile,
  scanDelta,
  scanProposal,
  serializeDependencies,
} from "../openspec-dependencies.js";

const tmp: string[] = [];
afterEach(() => {
  for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true });
});
const mkTmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), "deps-"));
  tmp.push(d);
  return d;
};

// ── helpers ────────────────────────────────────────────────────────
function change(name: string, over: Partial<ChangeInputs> = {}): ChangeInputs {
  return { name, declared: { state: "absent" }, proposal: null, deltas: {}, ...over };
}
function declaredYaml(text: string): DeclaredState {
  const r = parseDependenciesFile(text);
  return r.ok ? { state: "ok", value: r.value } : { state: "invalid", error: r.error };
}
function withProposal(name: string, text: string, over: Partial<ChangeInputs> = {}): ChangeInputs {
  return change(name, { proposal: scanProposal(text), ...over });
}
const graph = (changes: ChangeInputs[], archived: string[] = [], mainSpecs: string[] = []) =>
  computeDependencyGraph({ changes, archived, mainSpecs });

// ── E1 / E2 ────────────────────────────────────────────────────────
describe("parseDependenciesFile", () => {
  it("E1: shorthand and long form are equivalent", () => {
    const a = parseDependenciesFile("blocked_by: [add-x]\n");
    const b = parseDependenciesFile("blocked_by:\n  - change: add-x\n    reason: api\n");
    expect(a).toEqual({ ok: true, value: { blockedBy: [{ change: "add-x" }], notBlockedBy: [], related: [] } });
    expect(b).toEqual({
      ok: true,
      value: { blockedBy: [{ change: "add-x", reason: "api" }], notBlockedBy: [], related: [] },
    });
    const g = graph([change("foo", { declared: declaredYaml("blocked_by: [add-x]") }), change("add-x")]);
    expect(g.foo.blockedBy).toEqual([{ change: "add-x", source: "declared", state: "open" }]);
    const g2 = graph([
      change("foo", { declared: declaredYaml("blocked_by: [{change: add-x, reason: api}]") }),
      change("add-x"),
    ]);
    expect(g2.foo.blockedBy).toEqual([{ change: "add-x", source: "declared", reason: "api", state: "open" }]);
  });

  it("E2: shape decision table", () => {
    const ok = parseDependenciesFile("blocked_by: [100-add-feature, 123]");
    expect(ok.ok && ok.value.blockedBy.map((b) => b.change)).toEqual(["100-add-feature", "123"]);
    expect(parseDependenciesFile("blocked_by: [Bad_Name]").ok).toBe(false);
    for (const empty of ["", "# only comment\n", "blocked_by:\n", "blocked_by:\nnot_blocked_by:\nrelated:\n"]) {
      expect(parseDependenciesFile(empty)).toEqual({
        ok: true,
        value: { blockedBy: [], notBlockedBy: [], related: [] },
      });
    }
    expect(parseDependenciesFile("blocks: [x]\n").ok).toBe(false);
    expect(parseDependenciesFile(`blocked_by:\n  - change: a\n    reason: ${"x".repeat(501)}\n`).ok).toBe(false);
    expect(parseDependenciesFile(`blocked_by:\n  - change: a\n    reason: ${"x".repeat(500)}\n`).ok).toBe(true);
    expect(parseDependenciesFile("blocked_by: {a: b}").ok).toBe(false);
    expect(parseDependenciesFile("- a\n- b").ok).toBe(false);
    expect(parseDependenciesFile("blocked_by: [a\n").ok).toBe(false);
  });

  it("serializer output cannot inject keys through a reason", () => {
    const text = serializeDependencies({
      blockedBy: [{ change: "a", reason: "x\nnot_blocked_by: [a]" }],
      notBlockedBy: [],
      related: [],
    });
    const back = parseDependenciesFile(text);
    expect(back).toEqual({
      ok: true,
      value: { blockedBy: [{ change: "a", reason: "x\nnot_blocked_by: [a]" }], notBlockedBy: [], related: [] },
    });
  });
});

// ── E3 ─────────────────────────────────────────────────────────────
describe("readDependenciesFile", () => {
  const body = (bytes: number) => `blocked_by: [a]\n#${"x".repeat(bytes - 18)}\n`;

  it("E3: size boundary, alias, symlink and FIFO", async () => {
    const dir = mkTmp();
    const opened: string[] = [];
    const spy = {
      ...fsp,
      open: (async (p: string, ...rest: unknown[]) => {
        opened.push(p);
        return (fsp.open as (...a: unknown[]) => unknown)(p, ...rest);
      }) as typeof fsp.open,
    };
    const f64 = path.join(dir, "64k.yaml");
    writeFileSync(f64, body(64 * 1024));
    const f64p = path.join(dir, "64k1.yaml");
    writeFileSync(f64p, body(64 * 1024 + 1));
    const alias = path.join(dir, "alias.yaml");
    writeFileSync(alias, "blocked_by: &x [a]\nrelated: *x\n");
    const link = path.join(dir, "zero.yaml");
    symlinkSync("/dev/zero", link);
    const fifo = path.join(dir, "fifo.yaml");
    execFileSync("mkfifo", [fifo]);

    const t0 = Date.now();
    expect((await readDependenciesFile(f64, spy)).kind).toBe("ok");
    expect((await readDependenciesFile(f64p, spy)).kind).toBe("invalid");
    expect((await readDependenciesFile(alias, spy)).kind).toBe("invalid");
    opened.length = 0;
    expect((await readDependenciesFile(link, spy)).kind).toBe("invalid");
    expect((await readDependenciesFile(fifo, spy)).kind).toBe("invalid");
    expect(opened).toEqual([]);
    expect((await readDependenciesFile(path.join(dir, "missing.yaml"), spy)).kind).toBe("absent");
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it("returns mtime and size for a valid file", async () => {
    const dir = mkTmp();
    const f = path.join(dir, "d.yaml");
    writeFileSync(f, "related: [x]\n");
    const r = await readDependenciesFile(f);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.stat.size).toBe(13);
      expect(r.value.related).toEqual(["x"]);
    }
  });
});

// ── E4 / E5 ────────────────────────────────────────────────────────
describe("L1 labelled proposal lines", () => {
  const blocked = (text: string, extra: ChangeInputs[] = [change("a")], archived: string[] = []) =>
    graph([withProposal("me", text), ...extra], archived).me;

  it("E4: label variants make the change blocked by a", () => {
    for (const text of [
      "Depends on: `a`\n",
      "**Depends on** `a` (must ship first)\n",
      "1. Builds on `a`\n",
      "- **Depends on (land first):** `a`\n",
      "- Blocked by `a`\n",
      "- **Blocked by:** `a`\n",
      "* **Depends on**: `a`\n",
    ]) {
      const me = blocked(text);
      expect(me.blockedBy.map((e) => [e.change, e.source]), text).toEqual([["a", "inferred-text"]]);
    }
  });

  it("E4: Blocks blocks the other direction; `Blocks on` is no label", () => {
    const g = graph([withProposal("me", "**Blocks:** `a`\n"), change("a")]);
    expect(g.a.blockedBy.map((e) => e.change)).toEqual(["me"]);
    expect(g.me.blockedBy).toEqual([]);
    const g2 = graph([withProposal("me", "Blocks on: `a`\n"), change("a")]);
    expect(g2.a.blockedBy).toEqual([]);
    expect(g2.me.related).toEqual(["a"]);
  });

  it("E4: fenced, self, archived-under-Blocks and unknown tokens produce nothing", () => {
    const fenced = blocked("```\nDepends on: `a`\n```\n");
    expect(fenced.blockedBy).toEqual([]);
    expect(fenced.related).toEqual([]);
    expect(blocked("Depends on: `me`\n").blockedBy).toEqual([]);
    expect(blocked("Depends on: `me`\n").issues).toEqual([]);
    const g = graph([withProposal("me", "Blocks: `old`\n")], ["old"]);
    expect(g.me.blockedBy).toEqual([]);
    expect(blocked("Depends on: `pi-core-version-ui`\n")).toMatchObject({ blockedBy: [], issues: [] });
  });

  it("continuation lines and nested items belong to the label", () => {
    const me = blocked("- Depends on:\n  - `a`\n  - `b`\n", [change("a"), change("b")]);
    expect(me.blockedBy.map((e) => e.change)).toEqual(["a", "b"]);
    const lazy = blocked("Depends on: `a`,\nand `b`\n\nprose `c`\n", [change("a"), change("b"), change("c")]);
    expect(lazy.blockedBy.map((e) => e.change)).toEqual(["a", "b"]);
    expect(lazy.related).toEqual(["c"]);
  });

  it("archived blocker is satisfied", () => {
    const me = blocked("Depends on: `old`\n", [], ["old"]);
    expect(me.blockedBy).toEqual([
      { change: "old", source: "inferred-text", reason: "Depends on: `old`", state: "satisfied" },
    ]);
  });

  it("E5: prose mentions are related, never blocking, and cause no cycle", () => {
    const g = graph([
      withProposal("add-acme-dns01-certs", "## Dependencies\n\n- **Depends on**: `add-tailscale-cert-tls` for TLS\n"),
      withProposal("add-tailscale-cert-tls", "Follow-up: `add-acme-dns01-certs` builds on this listener.\n"),
      withProposal("third", "`add-tailscale-cert-tls` depends on this change.\n"),
      change("x"),
    ]);
    expect(g["add-acme-dns01-certs"].blockedBy.map((e) => e.change)).toEqual(["add-tailscale-cert-tls"]);
    expect(g["add-tailscale-cert-tls"].blockedBy).toEqual([]);
    expect(g["add-tailscale-cert-tls"].related).toEqual(["add-acme-dns01-certs"]);
    expect(g.third.blockedBy).toEqual([]);
    expect(g.third.related).toEqual(["add-tailscale-cert-tls"]);
    for (const c of Object.values(g)) expect(c.issues.filter((i) => i.code === "cycle")).toEqual([]);
  });

  it("scanProposal reports the matched line, whitespace-normalised and capped", () => {
    const long = `- Depends on:   \`a\` ${"y ".repeat(200)}\r\n`;
    const g = graph([withProposal("me", long), change("a")]);
    const reason = g.me.blockedBy[0].reason as string;
    expect(reason.length).toBeLessThanOrEqual(200);
    expect(reason).not.toContain("\r");
    expect(reason).not.toMatch(/\s{2}/);
  });
});

// ── E6 / E7 / E8 ───────────────────────────────────────────────────
describe("L2 capability birth and L3 overlap", () => {
  const delta = (text: string) => scanDelta(text);
  const ADD = "## ADDED Requirements\n### Requirement: x\n";
  const MOD = "## MODIFIED Requirements\n### Requirement: x\n";

  it("scanDelta flags headers case-insensitively and outside fences", () => {
    expect(delta(ADD)).toEqual({ added: true, modifies: false, anyHeader: true });
    expect(delta(ADD + MOD)).toEqual({ added: true, modifies: true, anyHeader: true });
    expect(delta("## modified requirements\n")).toMatchObject({ modifies: true, anyHeader: true });
    expect(delta("```\n## ADDED Requirements\n```\n")).toEqual({ added: false, modifies: false, anyHeader: false });
    expect(delta("## REMOVED Requirements\n").modifies).toBe(true);
    expect(delta("## RENAMED Requirements\n").modifies).toBe(true);
    expect(delta("no headers")).toEqual({ added: false, modifies: false, anyHeader: false });
  });

  it("E6: sole birther blocks every other change with a header", () => {
    const cap = "push-notifications";
    const g = graph([
      change("add-push", { deltas: { [cap]: delta(ADD) } }),
      change("r1", { deltas: { [cap]: delta(MOD) } }),
      change("r2", { deltas: { [cap]: delta(ADD + MOD) } }),
      change("r3", { deltas: { [cap]: delta("## modified requirements\n") } }),
      change("r4", { deltas: { [cap]: delta("```\n## MODIFIED Requirements\n```\n") } }),
      change("r5", { deltas: { [cap]: delta("nothing\n") } }),
    ]);
    for (const n of ["r1", "r2", "r3"]) {
      expect(g[n].blockedBy, n).toEqual([
        { change: "add-push", source: "inferred-capability", reason: cap, state: "open" },
      ]);
    }
    expect(g.r4.blockedBy).toEqual([]);
    expect(g.r5.blockedBy).toEqual([]);
    expect(g["add-push"].issues).toEqual([]);
  });

  it("E6: nested capability id respects main-spec existence", () => {
    const cap = "area/feature";
    const inputs = () => [
      change("birth", { deltas: { [cap]: delta(ADD) } }),
      change("follow", { deltas: { [cap]: delta(MOD) } }),
    ];
    expect(graph(inputs(), [], []).follow.blockedBy.map((e) => e.change)).toEqual(["birth"]);
    expect(graph(inputs(), [], [cap]).follow.blockedBy).toEqual([]);
  });

  it("E7: two birthers get duplicate-capability and no L2 edge", () => {
    const cap = "dedicated-agent-browser";
    const g = graph([
      change("add-dedicated-agent-browser", { deltas: { [cap]: delta(ADD) } }),
      change("add-gmail-auto-setup", { deltas: { [cap]: delta(ADD) } }),
    ]);
    expect(g["add-dedicated-agent-browser"].blockedBy).toEqual([]);
    expect(g["add-gmail-auto-setup"].blockedBy).toEqual([]);
    expect(g["add-dedicated-agent-browser"].issues).toMatchObject([
      { severity: "warning", code: "duplicate-capability", with: ["add-gmail-auto-setup"] },
    ]);
    expect(g["add-gmail-auto-setup"].issues).toMatchObject([
      { code: "duplicate-capability", with: ["add-dedicated-agent-browser"] },
    ]);
  });

  it("E8: overlaps are undirected and never block", () => {
    const g = graph(
      [
        change("a", { deltas: { cap: delta(MOD) } }),
        change("b", { deltas: { cap: delta(MOD) } }),
        change("c", { deltas: { other: delta(MOD) } }),
      ],
      [],
      ["cap"],
    );
    expect(g.a.overlaps).toEqual(["b"]);
    expect(g.b.overlaps).toEqual(["a"]);
    expect(g.c.overlaps).toEqual([]);
    expect([g.a.wave, g.b.wave, g.c.wave]).toEqual([1, 1, 1]);
  });
});

// ── E9 / E10 ───────────────────────────────────────────────────────
describe("merge and resolution", () => {
  it("E9: declared beats inferred; not_blocked_by suppresses; both lists conflict", () => {
    const g1 = graph([
      withProposal("foo", "- Depends on: `bar`\n", {
        declared: declaredYaml("blocked_by:\n  - change: bar\n    reason: why\n"),
      }),
      change("bar"),
    ]);
    expect(g1.foo.blockedBy).toEqual([{ change: "bar", source: "declared", reason: "why", state: "open" }]);

    const g2 = graph([
      change("foo", { declared: declaredYaml("not_blocked_by: [bar]") }),
      withProposal("bar", "**Blocks:** `foo`\n"),
    ]);
    expect(g2.foo.blockedBy).toEqual([]);
    expect(g2.foo.issues).toEqual([]);

    const g3 = graph([change("foo", { declared: declaredYaml("blocked_by: [bar]\nnot_blocked_by: [bar]") }), change("bar")]);
    expect(g3.foo.blockedBy).toEqual([]);
    expect(g3.foo.issues).toMatchObject([{ severity: "warning", code: "conflicting-entry", with: ["bar"] }]);
  });

  it("E10: resolution against active and archived names", () => {
    const g = graph(
      [
        change("foo", {
          declared: declaredYaml("blocked_by: [bar, baz, qux, nope]\nrelated: [nope2]\nnot_blocked_by: [nope3]"),
        }),
        change("bar"),
      ],
      ["baz", "SHELVED-qux"],
    );
    expect(g.foo.blockedBy.map((e) => [e.change, e.state])).toEqual([
      ["bar", "open"],
      ["baz", "satisfied"],
    ]);
    expect(g.foo.issues.map((i) => [i.code, i.severity, i.with])).toEqual([
      ["unknown-change", "warning", ["nope"]],
      ["unknown-change", "warning", ["qux"]],
    ]);
    expect(g.foo.related).toEqual([]);
    const bad = graph([change("foo", { declared: declaredYaml("blocked_by: [.hidden]") })]);
    expect(bad.foo.issues).toMatchObject([{ severity: "error", code: "invalid-file" }]);
    expect(bad.foo.blockedBy).toEqual([]);
  });

  it("an invalid file yields an error and no declared edges; hasFile is true", () => {
    const g = graph([change("foo", { declared: { state: "invalid", error: "too big" } })]);
    expect(g.foo.hasFile).toBe(true);
    expect(g.foo.issues).toMatchObject([{ severity: "error", code: "invalid-file", message: "too big" }]);
  });
});

// ── E11 / E12 / E13 ────────────────────────────────────────────────
describe("validation, waves and determinism", () => {
  it("E11: declared cycle is an error with a canonical path; downstream is blocked-by-cycle", () => {
    const g = graph([
      change("a", { declared: declaredYaml("blocked_by: [b]") }),
      change("b", { declared: declaredYaml("blocked_by: [a]") }),
      change("d", { declared: declaredYaml("blocked_by: [b]") }),
    ]);
    for (const n of ["a", "b"]) {
      expect(g[n].issues).toMatchObject([{ severity: "error", code: "cycle", path: ["a", "b", "a"] }]);
      expect(g[n].wave).toBeNull();
    }
    expect(g.d.issues).toMatchObject([{ severity: "warning", code: "blocked-by-cycle" }]);
    expect(g.d.wave).toBeNull();
  });

  it("E11: cycle through an inferred edge is a warning", () => {
    const g = graph([
      change("a", { declared: declaredYaml("blocked_by: [b]") }),
      withProposal("b", "- Depends on: `a`\n"),
    ]);
    for (const n of ["a", "b"]) {
      expect(g[n].issues).toMatchObject([{ severity: "warning", code: "cycle", path: ["a", "b", "a"] }]);
    }
  });

  it("E11: 3-cycle path starts at the smallest member and follows blocked-by arrows", () => {
    const g = graph([
      change("c", { declared: declaredYaml("blocked_by: [a]") }),
      change("a", { declared: declaredYaml("blocked_by: [b]") }),
      change("b", { declared: declaredYaml("blocked_by: [c]") }),
    ]);
    expect(g.b.issues[0].path).toEqual(["a", "b", "c", "a"]);
    expect(g.a.issues[0].severity).toBe("error");
  });

  it("E11: self-reference is an error and the entry is ignored", () => {
    const g = graph([change("a", { declared: declaredYaml("blocked_by: [a]") })]);
    expect(g.a.issues).toMatchObject([{ severity: "error", code: "self-reference" }]);
    expect(g.a.blockedBy).toEqual([]);
    expect(g.a.wave).toBe(1);
  });

  it("E12: waves, blocks, and archiving advances the chain", () => {
    const decl = (n: string, b?: string) => change(n, { declared: declaredYaml(b ? `blocked_by: [${b}]` : "") });
    const g = graph([decl("c", "b"), decl("b", "a"), decl("a")]);
    expect([g.a.wave, g.b.wave, g.c.wave]).toEqual([1, 2, 3]);
    expect(g.a.blocks).toEqual(["b"]);
    const g2 = graph([decl("c", "b"), decl("b", "a")], ["a"]);
    expect([g2.b.wave, g2.c.wave]).toEqual([1, 2]);
    expect(g2.b.blockedBy).toMatchObject([{ change: "a", state: "satisfied" }]);
    expect(g2.b.blocks).toEqual(["c"]);
  });

  it("E13: output is byte-identical across line endings and input order", () => {
    const fixture = (eol: string, reverse: boolean) => {
      const props = [
        `# P${eol}${eol}- Depends on: \`b\`  with\t\ttabs and  spaces${eol}`,
        `**Blocks:** \`c\`${eol}`,
        `\`a\` is mentioned${eol}`,
      ];
      const cs = [
        withProposal("a", props[0], { deltas: { cap: scanDelta(`## MODIFIED Requirements${eol}`) } }),
        withProposal("b", props[1], {
          declared: declaredYaml(`blocked_by:${eol}  - change: c${eol}    reason: "x  y\\t z"${eol}`),
          deltas: { cap: scanDelta(`## MODIFIED Requirements${eol}`) },
        }),
        withProposal("c", props[2]),
      ];
      if (reverse) cs.reverse();
      return JSON.stringify(graph(cs));
    };
    expect(fixture("\r\n", true)).toBe(fixture("\n", false));
  });
});
