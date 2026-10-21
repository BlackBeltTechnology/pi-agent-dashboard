/**
 * Manifest forward-compatibility contract (spec `dashboard-plugin-skill`, items 1-6) against the output of BOTH
 * modes, plus the `node_modules` layout scenario. Contract helpers live in `forward-compat-helpers.ts`.
 * The built-bundle half (real `npm run build:dashboard`) is in `render-augment.test.ts`.
 * See change: decouple-plugins-from-core (tasks 7.9, 8.135; test-plan #E97).
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type AugmentModeAnswers, FsSink, type NewModeAnswers, render } from "../render.js";
import { contractViolations, manifestPaths, type PackageJson, unresolvedManifestPaths } from "./forward-compat-helpers.js";

const tmp: string[] = [];
const mkdtemp = (): string => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "fwd-compat-"));
  tmp.push(d);
  return d;
};
afterEach(() => {
  for (const d of tmp.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const PROPOSALS: AugmentModeAnswers["confirmedProposals"] = [
  { file: "src/foo.ts", line: 4, callsite: "ctx.ui.custom(...)", mappedSlot: "content-view", componentSuggestion: "MyView" },
];

/** Render augment onto a fresh pi-extension project dir; returns the dir and the parsed package.json. */
function augmented(extra: Partial<AugmentModeAnswers> = {}): { dir: string; pkg: PackageJson } {
  const dir = mkdtemp();
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "@scope/foo", version: "1.0.0", type: "module", peerDependencies: { "pi-coding-agent": "*" } }, null, 2),
  );
  render({ mode: "augment", outDir: dir, confirmedProposals: PROPOSALS, addServer: false, ...extra }, new FsSink(dir));
  return { dir, pkg: JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as PackageJson };
}

function scaffolded(extra: Partial<NewModeAnswers> = {}): { dir: string; pkg: PackageJson } {
  const dir = path.join(mkdtemp(), "out");
  render(
    { mode: "new", id: "fwd", displayName: "Forward", priority: 100, slots: ["session-card-badge"], server: true, bridge: true, configSchema: true, outDir: dir, ...extra },
    new FsSink(dir),
  );
  return { dir, pkg: JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as PackageJson };
}

describe("forward-compat contract (1)-(6)", () => {
  it.each([
    ["augment", () => augmented()],
    ["augment + server + styles", () => augmented({ addServer: true, styles: true })],
    ["new (all entries)", () => scaffolded()],
  ] as const)("%s output conforms", (_label, make) => {
    expect(contractViolations(make().pkg)).toEqual([]);
  });

  it("augment output also satisfies the runtime-delivery rules", () => {
    expect(contractViolations(augmented({ addServer: true, styles: true }).pkg, { requireRuntime: true })).toEqual([]);
  });

  it("flags each class of violation (the contract check is not vacuous)", () => {
    const { pkg } = augmented({ addServer: true });
    const m = pkg["pi-dashboard-plugin"]!;
    const bad = (mutate: (p: PackageJson) => void): string[] => {
      const copy = JSON.parse(JSON.stringify(pkg)) as PackageJson;
      mutate(copy);
      return contractViolations(copy, { requireRuntime: true });
    };
    expect(bad((p) => ((p["pi-dashboard-plugin"] as Record<string, unknown>).client = "/abs/client.tsx"))).toEqual(expect.arrayContaining([expect.stringContaining("(2)")]));
    expect(bad((p) => ((p["pi-dashboard-plugin"] as Record<string, unknown>).server = "./../x.ts"))).toEqual(expect.arrayContaining([expect.stringContaining("(2)")]));
    expect(bad((p) => (p.dependencies = { x: "workspace:*" }))).toEqual(expect.arrayContaining([expect.stringContaining("(3)")]));
    expect(bad((p) => delete p.exports?.["./server"])).toEqual(expect.arrayContaining([expect.stringContaining("(4)")]));
    expect(bad((p) => ((p["pi-dashboard-plugin"] as Record<string, unknown>).requiredApi = "latest"))).toEqual(expect.arrayContaining([expect.stringContaining("(5)")]));
    expect(bad((p) => ((p["pi-dashboard-plugin"] as Record<string, unknown>).hostApi = "^9.9.0"))).toEqual(expect.arrayContaining([expect.stringContaining("(6)")]));
    expect(bad((p) => (p.keywords = []))).toEqual(expect.arrayContaining([expect.stringContaining("(6)")]));
    expect(bad((p) => ((p["pi-dashboard-plugin"] as Record<string, unknown>).clientBundle = "./index.js"))).toEqual(expect.arrayContaining([expect.stringContaining("dedicated")]));
    expect(m.clientBundle).toBe("./dist/client/index.js");
  });
});

describe("node_modules layout", () => {
  it("every manifest path of the published package resolves to a file inside node_modules/@scope/foo/", () => {
    const { dir, pkg } = augmented({ addServer: true, styles: true });
    // Stand-in for `npm run build:dashboard` output (the real build is exercised in render-augment.test.ts).
    fs.mkdirSync(path.join(dir, "dist/client"), { recursive: true });
    fs.writeFileSync(path.join(dir, "dist/client/index.js"), "export {};\n");
    fs.writeFileSync(path.join(dir, "dist/client/client.css"), "");

    const consumer = mkdtemp();
    const installed = path.join(consumer, "node_modules/@scope/foo");
    fs.mkdirSync(path.dirname(installed), { recursive: true });
    fs.cpSync(dir, installed, { recursive: true });

    const copied = JSON.parse(fs.readFileSync(path.join(installed, "package.json"), "utf8")) as PackageJson;
    expect(manifestPaths(copied).map(([k]) => k).sort()).toEqual(["client", "clientBundle", "clientStyles", "server"]);
    expect(unresolvedManifestPaths(installed, copied)).toEqual([]);
    expect(pkg["pi-dashboard-plugin"]).toEqual(copied["pi-dashboard-plugin"]);
  });

  it("reports a manifest path that does not resolve", () => {
    const { dir, pkg } = augmented();
    expect(unresolvedManifestPaths(dir, pkg)).toEqual(["clientBundle: ./dist/client/index.js"]);
  });
});
