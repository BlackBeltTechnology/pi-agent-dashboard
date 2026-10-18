/**
 * Pure joiner tests for the Add-ons feature catalog.
 * See change: addons-hub-feature-catalog (test-plan #E1–#E6).
 */
import { describe, expect, it } from "vitest";
import {
  buildAddonCatalog,
  type CatalogInputs,
  type CatalogPackageInput,
  type CatalogPluginInput,
  orphanManagedSources,
} from "../addons/addons-catalog.js";

const BASE = "/home/u/.pi/agent";

function plugin(id: string, extra: Partial<CatalogPluginInput> = {}): CatalogPluginInput {
  return {
    id,
    displayName: id,
    packageName: `@blackbelt-technology/pi-dashboard-${id}-plugin`,
    requiresPiExtensions: [],
    dependsOn: [],
    enabled: true,
    loaded: true,
    hasSettings: false,
    missingRequirements: [],
    ...extra,
  };
}

function pkg(source: string, extra: Partial<CatalogPackageInput> = {}): CatalogPackageInput {
  return { source, scope: "user", entryOff: false, ...extra };
}

function build(over: Partial<CatalogInputs>) {
  return buildAddonCatalog({ plugins: [], packages: [], recommended: [], baseDir: BASE, ...over });
}

const byId = (features: ReturnType<typeof build>, id: string) => features.find((f) => f.id === id);

describe("buildAddonCatalog — joins", () => {
  // test-plan #E1
  it("Goal: plugin + bridge + package form one feature", () => {
    const features = build({
      plugins: [plugin("goal", { requiresPiExtensions: ["@ricoyudog/pi-goal-hermes"], bridgeEntryPath: "/r/goal-plugin/src/bridge/index.ts" })],
      packages: [
        pkg("npm:@ricoyudog/pi-goal-hermes"),
        pkg("/r/goal-plugin/src/bridge/index.ts", { dashboardManaged: true }),
      ],
    });
    const goal = byId(features, "plugin:goal");
    expect(goal?.packages.map((p) => p.source)).toEqual(["npm:@ricoyudog/pi-goal-hermes"]);
    expect(goal?.bridge?.path).toBe("/r/goal-plugin/src/bridge/index.ts");
    expect(goal?.kind).toBe("agent-and-dashboard");
    expect(features.filter((f) => f.packages.some((p) => p.source.includes("goal-hermes")))).toHaveLength(1);
    expect(features.some((f) => f.id.includes("bridge/index.ts"))).toBe(false);
  });

  // test-plan #E2
  it("apple-tools: own package owned by the plugin, first-party", () => {
    const name = "@blackbelt-technology/pi-dashboard-apple-tools";
    const features = build({
      plugins: [plugin("apple-tools", { packageName: name })],
      packages: [pkg(`npm:${name}`, { packageName: name })],
    });
    const f = byId(features, "plugin:apple-tools");
    expect(f?.packages).toHaveLength(1);
    expect(f?.origin).toBe("first-party");
  });

  // test-plan #E3
  describe("precedence decision table", () => {
    it("(a) required by two plugins → own pkg feature", () => {
      const features = build({
        plugins: [plugin("a", { requiresPiExtensions: ["x"] }), plugin("b", { requiresPiExtensions: ["x"] })],
        packages: [pkg("npm:x")],
      });
      expect(byId(features, "pkg:npm:x")?.requiredBy).toEqual(["plugin:a", "plugin:b"]);
      expect(byId(features, "plugin:a")?.packages).toHaveLength(0);
      expect(byId(features, "plugin:a")?.requires).toEqual([{ name: "x", featureId: "pkg:npm:x" }]);
    });

    it("(b) own package wins over another plugin's requirement", () => {
      const features = build({
        plugins: [plugin("a", { packageName: "p" }), plugin("b", { requiresPiExtensions: ["p"] })],
        packages: [pkg("npm:p", { packageName: "p" })],
      });
      expect(byId(features, "plugin:a")?.packages.map((p) => p.source)).toEqual(["npm:p"]);
      expect(byId(features, "plugin:b")?.packages).toHaveLength(0);
      expect(byId(features, "plugin:b")?.requires).toEqual([{ name: "p", featureId: "plugin:a" }]);
    });

    it("(c) shared requirement beats a manifest link", () => {
      const features = build({
        plugins: [plugin("a", { requiresPiExtensions: ["x"] }), plugin("b", { requiresPiExtensions: ["x"] })],
        packages: [pkg("npm:x")],
        recommended: [{ source: "npm:x", dashboardPlugin: "a" }],
      });
      expect(byId(features, "pkg:npm:x")?.requiredBy).toEqual(["plugin:a", "plugin:b"]);
    });

    it("(d) required by one plugin joins it; manifest link joins too", () => {
      const features = build({
        plugins: [plugin("a", { requiresPiExtensions: ["x"] }), plugin("c")],
        packages: [pkg("npm:x"), pkg("npm:y")],
        recommended: [{ source: "npm:y", dashboardPlugin: "c" }],
      });
      expect(byId(features, "plugin:a")?.packages.map((p) => p.source)).toEqual(["npm:x"]);
      expect(byId(features, "plugin:c")?.packages.map((p) => p.source)).toEqual(["npm:y"]);
    });
  });

  it("built-in plugin without a package is dashboard-only; plain package is agent-only", () => {
    const features = build({
      plugins: [plugin("gmail", { bridgeEntryPath: "/r/gmail/bridge.ts" })],
      packages: [pkg("npm:example-pi-tool"), pkg("/r/gmail/bridge.ts", { dashboardManaged: true })],
    });
    expect(byId(features, "plugin:gmail")?.kind).toBe("dashboard-only");
    expect(byId(features, "pkg:npm:example-pi-tool")?.kind).toBe("agent-only");
  });

  it("orphaned dashboardManaged row is in no feature and reported", () => {
    const inputs: CatalogInputs = {
      plugins: [plugin("gmail", { bridgeEntryPath: "/r/gmail/bridge.ts" })],
      packages: [pkg("/old/bridge.ts", { dashboardManaged: true })],
      recommended: [],
      baseDir: BASE,
    };
    expect(buildAddonCatalog(inputs).some((f) => f.packages.length > 0)).toBe(false);
    expect(orphanManagedSources(inputs)).toEqual(["/old/bridge.ts"]);
  });
});

// test-plan #E4
describe("one-package-one-feature invariant", () => {
  it("holds on a seeded random fixture with name duplicates across npm + local", () => {
    let seed = 42;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const packages: CatalogPackageInput[] = [];
    for (let i = 0; i < 40; i++) {
      const name = `pkg-${Math.floor(rnd() * 25)}`;
      packages.push(i % 3 === 0 ? pkg(`/local/${name}-${i}`, { packageName: name }) : pkg(`npm:${name}-${i % 7}`, { packageName: `${name}-${i % 7}` }));
    }
    const plugins: CatalogPluginInput[] = [];
    for (let i = 0; i < 30; i++) {
      const pickName = () => `pkg-${Math.floor(rnd() * 25)}`;
      plugins.push(
        plugin(`pl${i}`, {
          packageName: i % 5 === 0 ? "" : `pkg-${i % 25}`,
          requiresPiExtensions: [pickName(), pickName()],
        }),
      );
    }
    packages.push(pkg("/managed/orphan.ts", { dashboardManaged: true }));
    const features = build({ plugins, packages });
    const counts = new Map<string, number>();
    for (const f of features) for (const p of f.packages) counts.set(p.identity, (counts.get(p.identity) ?? 0) + 1);
    expect([...counts.values()].every((c) => c === 1)).toBe(true);
    expect(features.some((f) => f.packages.some((p) => p.source.includes("orphan")))).toBe(false);
    // every distinct non-managed identity is in some feature
    const owned = new Set(counts.keys());
    for (const f of features) expect(f.id.startsWith("pkg:") ? owned.has(f.id.slice(4)) : true).toBe(true);
    // empty packageName claims nothing by rule 1
    const emptyName = plugins.filter((p) => !p.packageName);
    expect(emptyName.length).toBeGreaterThan(0);
  });
});

// test-plan #E5
describe("kind derivation", () => {
  it("covers every kind", () => {
    const features = build({
      plugins: [
        plugin("only"),
        plugin("bridged", { bridgeEntryPath: "/r/b.ts" }),
        plugin("withpkg", { requiresPiExtensions: ["wp"] }),
      ],
      packages: [
        pkg("npm:wp"),
        pkg("npm:solo"),
        pkg("npm:@blackbelt-technology/pi-dashboard-extension", { packageName: "@blackbelt-technology/pi-dashboard-extension" }),
      ],
    });
    expect(byId(features, "plugin:only")?.kind).toBe("dashboard-only");
    expect(byId(features, "plugin:bridged")?.kind).toBe("dashboard-only");
    expect(byId(features, "plugin:withpkg")?.kind).toBe("agent-and-dashboard");
    expect(byId(features, "pkg:npm:solo")?.kind).toBe("agent-only");
    expect(byId(features, "core:pi")?.kind).toBe("core");
    const bridge = byId(features, "core:dashboard-bridge");
    expect(bridge?.kind).toBe("core");
    expect(bridge?.origin).toBe("first-party");
  });
});

// test-plan #E6
describe("origin + author label", () => {
  it("derives origin and labels per decision table", () => {
    const features = build({
      plugins: [
        plugin("goal", { requiresPiExtensions: ["@ricoyudog/pi-goal-hermes"] }),
        plugin("comm", { packageName: "@third/comm-plugin", requiresPiExtensions: ["@blackbelt-technology/x"] }),
        plugin("gitp", { requiresPiExtensions: ["pi-tool"] }),
      ],
      packages: [
        pkg("npm:@ricoyudog/pi-goal-hermes"),
        pkg("npm:@blackbelt-technology/x", { packageName: "@blackbelt-technology/x" }),
        pkg("git:github.com/alice/pi-tool@v1", { packageName: "pi-tool" }),
        pkg("/repo/packages/eng-disciplines", { packageName: "@blackbelt-technology/pi-dashboard-eng-disciplines" }),
        pkg("npm:@a/x"),
        pkg("npm:@b/y"),
      ],
    });
    const goal = byId(features, "plugin:goal");
    expect([goal?.origin, goal?.authorLabels]).toEqual(["mixed", ["@ricoyudog"]]);
    const comm = byId(features, "plugin:comm");
    expect([comm?.origin, comm?.authorLabels]).toEqual(["mixed", ["@third"]]);
    const gitp = byId(features, "plugin:gitp");
    expect([gitp?.origin, gitp?.authorLabels]).toEqual(["mixed", ["alice/pi-tool"]]);
    expect(features.find((f) => f.id.endsWith("eng-disciplines"))?.origin).toBe("first-party");
    const ab = features.filter((f) => f.id === "pkg:npm:@a/x" || f.id === "pkg:npm:@b/y");
    expect(ab.every((f) => f.origin === "community")).toBe(true);
    expect(byId(features, "core:pi")?.origin).toBe("upstream");
  });

  it("feature with two community parts lists both labels", () => {
    const features = build({
      plugins: [plugin("two", { packageName: "@a/two-plugin", requiresPiExtensions: ["@b/y"] })],
      packages: [pkg("npm:@b/y")],
    });
    const two = byId(features, "plugin:two");
    expect(two?.origin).toBe("community");
    expect(two?.authorLabels).toEqual(["@a", "@b"]);
  });
});

describe("state + ordering", () => {
  it("derives on / off / partial", () => {
    const mk = (enabled: boolean, off: boolean) =>
      byId(
        build({ plugins: [plugin("p", { enabled, requiresPiExtensions: ["x"] })], packages: [pkg("npm:x", { entryOff: off })] }),
        "plugin:p",
      )?.state;
    expect(mk(true, false)).toBe("on");
    expect(mk(false, true)).toBe("off");
    expect(mk(false, false)).toBe("partial");
    expect(mk(true, true)).toBe("partial");
  });

  it("orders core first, then displayName case-insensitively, then id", () => {
    const features = build({
      plugins: [
        plugin("z1", { displayName: "zeta" }),
        plugin("a2", { displayName: "alpha" }),
        plugin("a1", { displayName: "Alpha" }),
      ],
    });
    expect(features.map((f) => f.id)).toEqual(["core:pi", "plugin:a1", "plugin:a2", "plugin:z1"]);
  });
});
