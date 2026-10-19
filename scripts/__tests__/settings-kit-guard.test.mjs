import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  countKinds,
  EXEMPT_FILES,
  loadBaseline,
  main,
  ratchet,
  scan,
  settingsClosure,
  settingsRoots,
  total,
} from "../settings-kit-guard.mjs";

/**
 * Settings-kit ratchet (test-plan #E33 fixture counts, #E34 real tree).
 * See change: retro-ux-plugin-settings-wave-2 (design D7).
 */

const VIOLATIONS = [
  ['<input type="checkbox" />', "checkbox"],
  ["<select value={v}>", "select"],
  ['const c = "#fbbf24";', "hex"],
  ['const c = "rgba(1,2,3,.5)";', "rgb"],
  ['<p className="text-red-400" />', "palette"],
  ['<p className="text-[10px]" />', "small-text"],
  ['<p className="text-[var(--text-muted)]" />', "muted-text"],
  ["<h3>Provider Quota</h3>", "identity"],
];

/** A throwaway monorepo with one settings-section plugin. */
function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), "settings-kit-guard-"));
  const pkg = join(root, "packages", "quota-plugin");
  mkdirSync(join(pkg, "src"), { recursive: true });
  writeFileSync(
    join(pkg, "package.json"),
    JSON.stringify({
      name: "quota-plugin",
      "pi-dashboard-plugin": {
        id: "quota",
        displayName: "Provider Quota",
        claims: [{ slot: "settings-section", component: "QuotaSettings", module: "./src/QuotaSettings.tsx" }],
      },
    }),
  );
  for (const [rel, src] of Object.entries(files)) {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), src);
  }
  return root;
}

const FILE = "packages/quota-plugin/src/QuotaSettings.tsx";

describe("settings-kit-guard counts (#E33)", () => {
  it.each(VIOLATIONS)("counts %s once as %s", (src, kind) => {
    expect(countKinds(src, ["Provider Quota", "quota"])).toEqual({ [kind]: 1 });
  });

  it("does not count token classes, text-white, 11/12 px text, -text accents or comments", () => {
    const clean = [
      'const a = "bg-[var(--accent-solid)] text-white text-[11px] text-[12px] text-[var(--text-secondary)]";',
      "// test-plan #E12 #fbbf24 text-red-400",
      "/* <select> type=\"checkbox\" */",
      '<a href="https://example.com/x">link</a>',
      "<span>Quota usage</span>",
    ].join("\n");
    expect(countKinds(clean, ["Provider Quota", "quota"])).toEqual({});
  });

  it("scans every .tsx under the claimed directory and skips exempt files and tests", () => {
    const root = fixture({
      [FILE]: VIOLATIONS.map(([s]) => s).join("\n"),
      "packages/quota-plugin/src/Widget.tsx": '<p className="text-[10px]" />',
      "packages/quota-plugin/src/__tests__/x.test.tsx": '<input type="checkbox" />',
    });
    const found = scan({ root, exempt: ["packages/quota-plugin/src/Widget.tsx"] });
    for (const [, kind] of VIOLATIONS) expect(found[`${FILE}::${kind}`]).toBe(1);
    expect(Object.keys(found).some((k) => k.includes("Widget.tsx"))).toBe(false);
    expect(Object.keys(found).some((k) => k.includes("__tests__"))).toBe(false);
  });

  it("exempts the MCP server editor modal", () => {
    expect(EXEMPT_FILES).toEqual(["packages/mcp-client-plugin/src/client/ServerEditor.tsx"]);
  });

  it("fails above the baseline naming the file, passes equal/below and lists repairs", () => {
    const found = { [`${FILE}::checkbox`]: 2 };
    const over = ratchet(found, { [`${FILE}::checkbox`]: 1 });
    expect(over.ok).toBe(false);
    expect(over.added[0].key).toBe(`${FILE}::checkbox`);
    expect(ratchet(found, { [`${FILE}::checkbox`]: 2 }).ok).toBe(true);
    const below = ratchet({}, { [`${FILE}::checkbox`]: 2 });
    expect(below.ok).toBe(true);
    expect(below.repaired).toEqual([`${FILE}::checkbox`]);
  });

  it("main exits 1 on a new native checkbox and names the file; --write refuses to grow", () => {
    const root = fixture({ [FILE]: '<input type="checkbox" />' });
    const baselinePath = join(root, "baseline.json");
    writeFileSync(baselinePath, JSON.stringify({ counts: {} }));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(main([], { root, baselinePath })).toBe(1);
      expect(err.mock.calls.flat().join("\n")).toContain(FILE);
      expect(main(["--write"], { root, baselinePath })).toBe(1);
      expect(JSON.parse(readFileSync(baselinePath, "utf8")).counts).toEqual({});
    } finally {
      err.mockRestore();
      log.mockRestore();
    }
  });

  it("settingsClosure follows package-local imports from the claimed module", () => {
    const root = fixture({
      [FILE]: 'import { Row } from "./Row.js";\n',
      "packages/quota-plugin/src/Row.tsx": "export const Row = 1;\n",
      "packages/quota-plugin/src/Widget.tsx": "export const W = 1;\n",
    });
    const closure = settingsClosure(root);
    expect(closure.has(FILE)).toBe(true);
    expect(closure.has("packages/quota-plugin/src/Row.tsx")).toBe(true);
    expect(closure.has("packages/quota-plugin/src/Widget.tsx")).toBe(false);
  });
});

const FIFTEEN = [
  "apple-tools",
  "automation-plugin",
  "blackhole-plugin",
  "browser-plugin",
  "chat-gateway",
  "cost-estimator",
  "flows-anthropic-bridge-plugin",
  "grammar-plugin",
  "quota-plugin",
  "mcp-client-plugin",
  "system-one-plugin",
  "obs-studio-plugin",
  "goal-plugin",
  "flows-plugin",
  "subagents-plugin",
];

describe("settings-kit-guard against the real tree (#E34)", () => {
  const found = scan();
  const baseline = loadBaseline();
  const closure = settingsClosure();

  it("covers the claimed directories of all fifteen plugins", () => {
    const dirs = settingsRoots().map((r) => r.dir);
    for (const pkg of FIFTEEN) expect(dirs.some((d) => d.startsWith(`packages/${pkg}/`))).toBe(true);
  });

  it("passes on the repository as it stands", () => {
    expect(ratchet(found, baseline).added).toEqual([]);
  });

  it("holds no baseline entry for any file in the fifteen plugins' settings render closures", () => {
    const inScope = [...closure].filter((f) => FIFTEEN.some((pkg) => f.startsWith(`packages/${pkg}/`)));
    expect(inScope.length).toBeGreaterThan(15);
    expect(inScope).toContain("packages/obs-studio-plugin/src/client/ObsSettingsCard.tsx");
    expect(inScope).not.toContain("packages/obs-studio-plugin/src/client/ObsPanel.tsx");
    const set = new Set(inScope);
    expect(Object.keys(baseline).filter((k) => set.has(k.split("::")[0]))).toEqual([]);
  });

  it("baseline entries are positive counts (a zero entry is a deleted one)", () => {
    for (const n of Object.values(baseline)) expect(n).toBeGreaterThan(0);
    expect(total(baseline)).toBeGreaterThanOrEqual(total(found));
  });
});
