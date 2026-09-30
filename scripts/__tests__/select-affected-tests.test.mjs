/**
 * Affected-test selector — pure decision logic (change: speed-up-ci-affected-tests).
 *
 * Every case drives `decide()` / `assignShards()` / `extractLocations()` over a
 * SYNTHETIC test index, so each layer is pinned independently of whatever the
 * real tree holds. The failure mode that matters is a false negative — a test
 * deselected that the diff breaks — and it is invisible in a green run, so the
 * negative cases ("T2 not selected") are as load-bearing as the positive ones.
 *
 * Style: `check-pi-settings-paths.test.mjs` (pure fn, no shell-out).
 * test-plan rows E1–E19, E22–E27.
 */
import { describe, expect, it } from "vitest";

import {
  assignShards,
  decide,
  extractLocations,
  isGatedSource,
  SHARD_COUNT,
} from "../test-selection/decide.mjs";

const TOP = ["openspec", "docs", ".github", "packages", "scripts", "AGENTS.md", "tests"];

/** Build a test index entry. */
const t = (deps = [], extra = {}) => ({ deps, phase: "parallel", locations: [], gated: false, ...extra });

const EMPTY_DATA = { triggers: {}, coveredElsewhere: ["docs", "openspec", ".github", "AGENTS.md"], slowTier: [] };

function run({ changed, tests, openModules = [], globalInputs = [], data = {}, forceFull = null, timings = {} }) {
  return decide({
    changed,
    forceFull,
    index: { tests, openModules, globalInputs, leafErrors: [] },
    data: { ...EMPTY_DATA, ...data },
    timings,
  });
}

const selectedFiles = (sel) => Object.keys(sel.selected).sort();

describe("global inputs force full (E1–E3)", () => {
  const tests = { "packages/p/src/__tests__/a.test.ts": t(["packages/p/src/a.ts"]) };

  it("E1: the lockfile forces full and the reason names it", () => {
    const sel = run({ changed: ["pnpm-lock.yaml"], tests });
    expect(sel.mode).toBe("full");
    expect(sel.reason).toContain("pnpm-lock.yaml");
  });

  it("E1b: root package.json, any vitest config, the worker module and any tsconfig force full", () => {
    for (const f of [
      "package.json",
      "vitest.config.ts",
      "packages/client/vitest.config.ts",
      "packages/server/vitest.real-process.config.ts",
      "vitest.workers.ts",
      "tsconfig.base.json",
      "packages/p/tsconfig.json",
      "scripts/select-affected-tests.mjs",
      "scripts/test-selection/decide.mjs",
      "scripts/test-selection/triggers.json",
      "scripts/test-selection/covered-elsewhere.json",
      "scripts/test-selection/slow-tier.json",
    ]) {
      expect(run({ changed: [f], tests }).mode, f).toBe("full");
    }
  });

  it("E2: a project setupFiles entry forces full", () => {
    const sel = run({ changed: ["packages/p/setup.ts"], tests, globalInputs: ["packages/p/setup.ts"] });
    expect(sel.mode).toBe("full");
    expect(sel.reason).toContain("packages/p/setup.ts");
  });

  it("E3: the shard timing data is NOT a global input", () => {
    const sel = run({ changed: ["scripts/test-selection/timings.json"], tests });
    expect(sel.mode).toBe("affected");
  });

  it("a forced-full request (dispatch / ci:full) is full with its reason", () => {
    const sel = run({ changed: [], tests, forceFull: "workflow_dispatch" });
    expect(sel.mode).toBe("full");
    expect(sel.reason).toContain("workflow_dispatch");
  });

  it("full mode selects every test file", () => {
    const all = {
      "packages/p/src/__tests__/a.test.ts": t(["packages/p/src/a.ts"]),
      "packages/q/src/__tests__/b.test.ts": t(["packages/q/src/b.ts"]),
    };
    expect(selectedFiles(run({ changed: ["pnpm-lock.yaml"], tests: all }))).toEqual(Object.keys(all).sort());
  });
});

describe("graph layer (E4–E6)", () => {
  const T1 = "packages/p/src/__tests__/t1.test.ts";
  const T2 = "packages/p/src/__tests__/t2.test.ts";
  const tests = { [T1]: t(["packages/p/src/a.ts"]), [T2]: t(["packages/p/src/b.ts"]) };

  it("E4: a direct dependency hit selects T1 and not T2", () => {
    const sel = run({ changed: ["packages/p/src/a.ts"], tests });
    expect(sel.mode).toBe("affected");
    expect(sel.selected[T1]).toBe("graph");
    expect(sel.selected[T2]).toBeUndefined();
  });

  it("E5: a cross-package dependency hit selects the importer, layer graph", () => {
    const clientT = "packages/client/src/__tests__/x.test.tsx";
    const sel = run({
      changed: ["packages/shared/src/y.ts"],
      tests: { ...tests, [clientT]: t(["packages/client/src/x.tsx", "packages/shared/src/y.ts"]) },
    });
    expect(sel.selected[clientT]).toBe("graph");
    expect(sel.selected[T1]).toBeUndefined();
  });

  it("E6: a changed test file selects itself", () => {
    const sel = run({ changed: [T2], tests });
    expect(sel.selected[T2]).toBeDefined();
    expect(sel.selected[T1]).toBeUndefined();
  });
});

describe("always-run set (E7)", () => {
  it("E7: an OpenSpec-only diff selects zero-dep tests, not dep-bearing ones, and no packaging scenarios", () => {
    const Z1 = "packages/client/src/__tests__/mdi-chunk-size.test.ts";
    const T1 = "packages/p/src/__tests__/t1.test.ts";
    const sel = run({ changed: ["openspec/changes/x/proposal.md"], tests: { [Z1]: t([]), [T1]: t(["packages/p/src/a.ts"]) } });
    expect(sel.mode).toBe("affected");
    expect(sel.selected[Z1]).toBe("always");
    expect(sel.selected[T1]).toBeUndefined();
    expect(sel.ciScenarios).toBe(false);
  });

  it("zero-dep tests run on an unrelated package change too", () => {
    const Z1 = "packages/client/src/__tests__/mdi-chunk-size.test.ts";
    const sel = run({
      changed: ["packages/quota-plugin/src/client.tsx"],
      tests: { [Z1]: t([]), "packages/quota-plugin/src/__tests__/q.test.tsx": t(["packages/quota-plugin/src/client.tsx"]) },
    });
    expect(sel.selected[Z1]).toBe("always");
  });
});

describe("open edges (E8)", () => {
  it("E8: a test whose graph holds an open module is selected on any change in that package", () => {
    const T1 = "packages/x/src/__tests__/t1.test.ts";
    const T2 = "packages/x/src/__tests__/t2.test.ts";
    const sel = run({
      changed: ["packages/p/src/other.json"],
      tests: { [T1]: t(["packages/p/src/loader.ts"]), [T2]: t(["packages/x/src/b.ts"]) },
      openModules: ["packages/p/src/loader.ts"],
    });
    expect(sel.selected[T1]).toBe("open-edge");
    expect(sel.selected[T2]).toBeUndefined();
    expect(sel.openEdges).toContain("packages/p/src/loader.ts");
  });
});

describe("open edge on the test file itself", () => {
  it("a test that itself holds a computed import() is selected on any change in its own location", () => {
    const T = "scripts/__tests__/vitest-workers.test.mjs";
    const sel = run({
      changed: ["scripts/lib/other.mjs"],
      tests: { [T]: t(["scripts/lib/x.mjs"]), "scripts/lib/__tests__/o.test.mjs": t(["scripts/lib/other.mjs"]) },
      openModules: [T],
    });
    expect(sel.selected[T]).toBe("open-edge");
  });
});

describe("path-literal readers (E9, E10)", () => {
  it("E9: a cross-package literal reader is selected, layer path-literal", () => {
    const clientT = "packages/client/src/__tests__/reads-server.test.ts";
    const sel = run({
      changed: ["packages/server/src/cli.ts"],
      tests: {
        [clientT]: t(["packages/client/src/a.ts"], { locations: ["packages/server"] }),
        "packages/server/src/__tests__/cli.test.ts": t(["packages/server/src/cli.ts"]),
      },
    });
    expect(sel.selected[clientT]).toBe("path-literal");
  });

  it("E10: a path.join segment equal to a top-level name counts as naming that location", () => {
    const src = `const d = path.join(root, "openspec", "specs");`;
    const locs = extractLocations(src, TOP);
    expect(locs).toContain("openspec");
    const T = "scripts/__tests__/check-conventions.test.mjs";
    const sel = run({ changed: ["openspec/specs/a/spec.md"], tests: { [T]: t(["scripts/check-conventions.mjs"], { locations: locs }) } });
    expect(sel.selected[T]).toBe("path-literal");
  });

  it("extractLocations maps packages/<p>/... literals to the package and strips leading ../", () => {
    const src = [
      `readFileSync("packages/server/src/cli.ts")`,
      `path.resolve(here, "../../../../.github/workflows/ci.yml")`,
      "const x = `docs/${name}.md`;",
      `const y = "src/local.ts";`,
      `const z = 'AGENTS.md';`,
    ].join("\n");
    expect(extractLocations(src, TOP).sort()).toEqual([".github", "AGENTS.md", "docs", "packages/server"].sort());
  });

  it("a literal `packages` names the whole packages location", () => {
    expect(extractLocations(`path.join(ROOT, "packages", "server")`, TOP)).toContain("packages");
  });
});

describe("package fallback (E11–E13)", () => {
  const client1 = "packages/client/src/__tests__/a.test.tsx";
  const client2 = "packages/client/src/components/__tests__/b.test.tsx";
  const ext = "packages/extension/src/__tests__/e.test.ts";
  const entering = "packages/quota-plugin/src/__tests__/q.test.tsx";
  const roles = "packages/roles-plugin/src/__tests__/r.test.ts";
  const tests = {
    [client1]: t(["packages/client/src/a.tsx"]),
    [client2]: t(["packages/client/src/b.tsx"]),
    [ext]: t(["packages/extension/src/e.ts"]),
    [entering]: t(["packages/quota-plugin/src/q.tsx", "packages/roles-plugin/src/api.ts"]),
    [roles]: t(["packages/roles-plugin/src/api.ts"]),
  };

  it("E11: an unreached stylesheet selects every test of its package", () => {
    const sel = run({ changed: ["packages/client/src/index.css"], tests });
    expect(sel.mode).toBe("affected");
    expect(sel.selected[client1]).toBe("package-fallback");
    expect(sel.selected[client2]).toBe("package-fallback");
    expect(sel.selected[ext]).toBeUndefined();
  });

  it("E12: unreached Markdown inside a package selects that package's tests", () => {
    const sel = run({ changed: ["packages/extension/.pi/skills/x/SKILL.md"], tests });
    expect(sel.selected[ext]).toBe("package-fallback");
    expect(sel.selected[client1]).toBeUndefined();
  });

  it("E13: a package manifest is scoped — affected, own tests plus graphs entering it, packaging scenarios on", () => {
    const sel = run({ changed: ["packages/roles-plugin/package.json"], tests });
    expect(sel.mode).toBe("affected");
    expect(sel.selected[roles]).toBe("package-fallback");
    expect(sel.selected[entering]).toBe("package-fallback");
    expect(sel.selected[client1]).toBeUndefined();
    expect(sel.ciScenarios).toBe(true);
  });

  it("a reached package file does not trigger the fallback", () => {
    const sel = run({ changed: ["packages/client/src/a.tsx"], tests });
    expect(sel.selected[client1]).toBe("graph");
    expect(sel.selected[client2]).toBeUndefined();
  });
});

describe("outside packages: trigger map, covered-elsewhere, unknown (E14–E16)", () => {
  const Z = "packages/shared/src/__tests__/zero.test.ts";
  const zl = "scripts/__tests__/z-layer-audit.test.mjs";
  const docsReader = "packages/shared/src/__tests__/docs-reader.test.ts";
  const plain = "packages/p/src/__tests__/p.test.ts";
  const tests = {
    [Z]: t([]),
    [zl]: t(["scripts/z-layer.mjs"]),
    [docsReader]: t(["packages/shared/src/x.ts"], { locations: ["docs"] }),
    [plain]: t(["packages/p/src/p.ts"]),
  };

  it("E14: an unknown root file forces full and the reason names it", () => {
    const sel = run({ changed: ["some-root-data.json"], tests });
    expect(sel.mode).toBe("full");
    expect(sel.reason).toContain("some-root-data.json");
    expect(sel.unmapped).toEqual(["some-root-data.json"]);
  });

  it("E15: a trigger-map hit selects the mapped tests and stays affected", () => {
    const sel = run({
      changed: ["scripts/z-layer-baseline.json"],
      tests,
      data: { triggers: { "scripts/z-layer-baseline.json": ["scripts/__tests__/z-layer*.test.mjs"] } },
    });
    expect(sel.mode).toBe("affected");
    expect(sel.selected[zl]).toBe("trigger-map");
    expect(sel.selected[plain]).toBeUndefined();
  });

  it("E16: a covered-elsewhere file adds nothing beyond always-run + literal readers", () => {
    const sel = run({ changed: ["docs/faq.md"], tests });
    expect(sel.mode).toBe("affected");
    expect(sel.selected).toEqual({ [Z]: "always", [docsReader]: "path-literal" });
  });

  it("an unreached file under a top-level location that holds tests is not auto-covered", () => {
    const sel = run({ changed: ["scripts/build.sh"], tests });
    expect(sel.mode).toBe("full");
  });

  it("a file reached by a graph outside packages/ is a graph hit, not unmapped", () => {
    const sel = run({ changed: ["scripts/z-layer.mjs"], tests });
    expect(sel.mode).toBe("affected");
    expect(sel.selected[zl]).toBe("graph");
  });
});

describe("slow tier (E17–E19)", () => {
  const S = "scripts/__tests__/async-semantics-mutation.test.mjs";
  const data = {
    slowTier: [S],
    triggers: { "scripts/mutation-target.json": ["scripts/__tests__/async-semantics-mutation.test.mjs"] },
  };
  const tests = { [S]: t(["packages/server/src/x.ts"], { locations: ["packages/server"] }) };

  it("E17: applied last — deselected even when graph, literal and trigger layers all hit, and logged", () => {
    const sel = run({ changed: ["packages/server/src/x.ts", "scripts/mutation-target.json"], tests, data });
    expect(sel.mode).toBe("affected");
    expect(sel.selected[S]).toBeUndefined();
    expect(sel.slowTierDeselected).toEqual([S]);
    expect(sel.counts.slowTierDeselected).toBe(1);
  });

  it("E18: re-included when the slow-tier file itself is edited", () => {
    const sel = run({ changed: [S], tests, data });
    expect(sel.selected[S]).toBeDefined();
    expect(sel.slowTierDeselected).toEqual([]);
  });

  it("E19: selected in full mode", () => {
    const sel = run({ changed: [], tests, data, forceFull: "--full" });
    expect(sel.selected[S]).toBeDefined();
  });
});

describe("packaging scenarios and routing (E22–E24)", () => {
  const gated = "scripts/__tests__/root-packaging.test.mjs";
  const keeper = "packages/server/src/rpc-keeper/__tests__/keeper.test.ts";
  const app = "packages/client/src/__tests__/App.test.tsx";
  const tests = {
    [gated]: t(["scripts/lib/pack.mjs"], { gated: true, locations: ["AGENTS.md"] }),
    [keeper]: t(["packages/server/src/rpc-keeper/keeper.ts"], { phase: "real-process" }),
    [app]: t(["packages/client/src/App.tsx"]),
  };

  it("E22: the packaging flag is false only for an OpenSpec-only diff", () => {
    expect(run({ changed: ["openspec/x.md"], tests }).ciScenarios).toBe(false);
    expect(run({ changed: ["AGENTS.md"], tests }).ciScenarios).toBe(true);
    expect(run({ changed: ["packages/client/src/App.tsx"], tests }).ciScenarios).toBe(true);
    expect(run({ changed: ["pnpm-lock.yaml"], tests }).ciScenarios).toBe(true);
  });

  it("E23: a gated file selected by another layer lands only in the packaging-scenarios job", () => {
    const sel = run({ changed: ["AGENTS.md"], tests });
    expect(sel.selected[gated]).toBe("path-literal");
    for (const shard of sel.shards) expect(shard).not.toContain(gated);
    expect(sel.realProcess).not.toContain(gated);
    expect(sel.ciScenariosFiles).toContain(gated);
  });

  it("gated files never land in a shard in full mode either", () => {
    const sel = run({ changed: ["pnpm-lock.yaml"], tests });
    for (const shard of sel.shards) expect(shard).not.toContain(gated);
    expect(sel.ciScenariosFiles).toEqual([gated]);
  });

  it("E24: a real-process test is routed to realProcess and never to a shard", () => {
    const sel = run({ changed: ["packages/server/src/rpc-keeper/keeper.ts"], tests });
    expect(sel.realProcess).toEqual([keeper]);
    for (const shard of sel.shards) expect(shard).not.toContain(keeper);
  });

  it("the shard count is exported and the output always has that many shards", () => {
    expect(SHARD_COUNT).toBe(4);
    expect(run({ changed: ["openspec/x.md"], tests }).shards).toHaveLength(SHARD_COUNT);
  });

  it("isGatedSource detects a READ of the packaging env gate, not a mention", () => {
    // Assembled from pieces so this test file is not itself detected as gated.
    const name = ["RUN", "CI", "SCENARIOS"].join("_");
    expect(isGatedSource(`const on = process.env.${name} === "1";`)).toBe(true);
    expect(isGatedSource(`const on = process.env["${name}"];`)).toBe(true);
    expect(isGatedSource(`// behind ${name}=1 in ci.yml`)).toBe(false);
    expect(isGatedSource(`const on = process.env.CI;`)).toBe(false);
  });
});

describe("rename and deletion as decide() inputs (E20/E21 decide half)", () => {
  it("a deleted package fixture fires the package fallback", () => {
    const pt = "packages/p/src/__tests__/p.test.ts";
    const sel = run({ changed: ["packages/p/fixtures/f.json"], tests: { [pt]: t(["packages/p/src/p.ts"]) } });
    expect(sel.mode).toBe("affected");
    expect(sel.selected[pt]).toBe("package-fallback");
  });
});

describe("shard assignment (E25, E26)", () => {
  const files = Array.from({ length: 10 }, (_, i) => `f${String(i).padStart(2, "0")}.test.ts`);
  const weights = [500, 60, 50, 40, 30, 20, 10, 5, 1, 1];
  const timings = Object.fromEntries(files.map((f, i) => [f, weights[i]]));

  it("E25: deterministic and within optimum + the largest single file", () => {
    const a = assignShards(files, timings, 4);
    const b = assignShards([...files].reverse(), timings, 4);
    expect(a).toEqual(b);
    expect(a.shards).toHaveLength(4);
    expect(a.shards.flat().sort()).toEqual([...files].sort());
    const sum = weights.reduce((x, y) => x + y, 0);
    const lowerBound = Math.max(sum / 4, 500); // ≤ the optimum
    expect(Math.max(...a.loads)).toBeLessThanOrEqual(lowerBound + 500);
  });

  it("E26: a file with no timing data is weighted at the median of the known timings", () => {
    const r = assignShards(["a", "b", "c"], { a: 10, b: 30, zzz: 20 }, 2);
    expect(r.weights.c).toBe(20);
    expect(r.unknownTimingShare).toBeCloseTo(1 / 3);
  });

  it("E26b: the selection reports the unknown-timing share", () => {
    const sel = run({
      changed: ["pnpm-lock.yaml"],
      tests: { a: t(["x"]), b: t(["y"]), c: t(["z"]) },
      timings: { a: 10, b: 30 },
    });
    expect(sel.unknownTimingShare).toBeCloseTo(1 / 3);
  });
});

describe("determinism (E27)", () => {
  it("E27: the same inputs give deep-equal outputs", () => {
    const tests = {
      "packages/p/src/__tests__/a.test.ts": t(["packages/p/src/a.ts"]),
      "packages/p/src/__tests__/b.test.ts": t([]),
      "packages/q/src/__tests__/c.test.ts": t(["packages/p/src/a.ts"], { locations: ["docs"] }),
    };
    const input = { changed: ["packages/p/src/a.ts", "docs/x.md"], tests };
    expect(run(input)).toEqual(run(input));
  });

  it("the union of layers: every layer contributes in one affected run", () => {
    const tests = {
      g: t(["packages/a/src/a.ts"]),
      o: t(["packages/b/src/open.ts"]),
      z: t([]),
      l: t(["packages/x/src/x.ts"], { locations: ["docs"] }),
      pf: t(["packages/c/src/c.ts"]),
      tm: t(["scripts/tm.mjs"]),
      none: t(["packages/n/src/n.ts"]),
    };
    const sel = run({
      changed: ["packages/a/src/a.ts", "packages/b/src/data.json", "docs/x.md", "packages/c/src/style.css", "biome.json"],
      tests,
      openModules: ["packages/b/src/open.ts"],
      data: { triggers: { "biome.json": ["tm"] } },
    });
    expect(sel.mode).toBe("affected");
    expect(sel.selected).toEqual({
      g: "graph",
      o: "open-edge",
      z: "always",
      l: "path-literal",
      pf: "package-fallback",
      tm: "trigger-map",
    });
    expect(sel.counts).toMatchObject({ graph: 1, openEdge: 1, always: 1, pathLiteral: 1, packageFallback: 1, triggerMap: 1 });
  });
});
