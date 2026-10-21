/**
 * Mode `augment` tests — exercise the renderer against a fixture pi-extension
 * package.json on disk, then assert the resulting in-memory tree.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as url from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextSteps } from "../next-steps.js";
import type { AugmentModeAnswers } from "../render.js";
import { FsSink, type InMemorySink, render, scaffoldHostApiRange } from "../render.js";
import { contractViolations, type PackageJson, unresolvedManifestPaths } from "./forward-compat-helpers.js";

// Pass-through spies: the one real build below spawns npm; every other test asserts the skill spawns nothing.
const cp = vi.hoisted(() => ({ spies: [] as Array<ReturnType<typeof vi.fn>> }));
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const wrap = <K extends keyof typeof actual>(k: K) => {
    const spy = vi.fn(actual[k] as (...a: unknown[]) => unknown);
    cp.spies.push(spy);
    return spy;
  };
  return { ...actual, spawn: wrap("spawn"), spawnSync: wrap("spawnSync"), exec: wrap("exec"), execSync: wrap("execSync"), execFile: wrap("execFile"), execFileSync: wrap("execFileSync"), fork: wrap("fork") };
});
const childProcess = await import("node:child_process");
const spawnCalls = (): number => cp.spies.reduce((n, spy) => n + spy.mock.calls.length, 0);

const BASE_PKG = {
  name: "@scope/sample-extension",
  version: "0.1.0",
  description: "Sample pi extension",
  type: "module",
  exports: { "./bridge": "./src/bridge.ts" },
  dependencies: {
    "lodash": "^4.0.0",
    "pi-coding-agent": "^0.70.0",
  },
};

let workdir: string;

beforeEach(() => {
  workdir = fs.mkdtempSync(path.join(os.tmpdir(), "augment-test-"));
  fs.writeFileSync(path.join(workdir, "package.json"), JSON.stringify(BASE_PKG, null, 2));
});

function answers(overrides: Partial<AugmentModeAnswers> = {}): AugmentModeAnswers {
  return {
    mode: "augment",
    outDir: workdir,
    confirmedProposals: [
      {
        file: "src/foo.ts",
        line: 42,
        callsite: "ctx.ui.custom<MyView>(...)",
        mappedSlot: "content-view",
        componentSuggestion: "MyView",
      },
      {
        file: "src/foo.ts",
        line: 80,
        callsite: 'pi.registerTool({ name: "Doit" })',
        mappedSlot: "tool-renderer",
      },
    ],
    addServer: false,
    ...overrides,
  };
}

describe("render augment — minimal", () => {
  it("injects pi-dashboard-plugin manifest at top level", () => {
    const sink = render(answers()) as InMemorySink;
    const pkg = JSON.parse(sink.files.get("package.json")!) as Record<string, unknown>;
    expect(pkg["pi-dashboard-plugin"]).toBeDefined();
    const m = pkg["pi-dashboard-plugin"] as Record<string, unknown>;
    expect(m.id).toBe("sample-extension");
    expect(m.requiredApi).toBe("^0.x");
    expect(m.client).toBe("./src/dashboard/client.tsx");
  });

  it("adds the pi-dashboard-plugin keyword (keeping the author's) and a derived hostApi", () => {
    fs.writeFileSync(path.join(workdir, "package.json"), JSON.stringify({ ...BASE_PKG, keywords: ["pi-package"] }, null, 2));
    const sink = render(answers()) as InMemorySink;
    const pkg = JSON.parse(sink.files.get("package.json")!) as { keywords: string[]; "pi-dashboard-plugin": { hostApi: string } };
    expect(pkg.keywords).toEqual(["pi-package", "pi-dashboard-plugin"]);
    expect(pkg["pi-dashboard-plugin"].hostApi).toBe(scaffoldHostApiRange());
    // idempotent: rendering again over the result does not duplicate the keyword
    fs.writeFileSync(path.join(workdir, "package.json"), JSON.stringify({ ...BASE_PKG, keywords: pkg.keywords }, null, 2));
    const again = JSON.parse((render(answers()) as InMemorySink).files.get("package.json")!) as { keywords: string[] };
    expect(again.keywords).toEqual(["pi-package", "pi-dashboard-plugin"]);
  });

  it("preserves existing dependencies and adds SDK deps in alpha order", () => {
    const sink = render(answers()) as InMemorySink;
    const pkg = JSON.parse(sink.files.get("package.json")!) as { dependencies: Record<string, string> };
    expect(pkg.dependencies["lodash"]).toBe("^4.0.0");
    expect(pkg.dependencies["pi-coding-agent"]).toBe("^0.70.0");
    expect(pkg.dependencies["@blackbelt-technology/dashboard-plugin-runtime"]).toBeDefined();
    expect(pkg.dependencies["@blackbelt-technology/pi-dashboard-shared"]).toBeDefined();
    expect(Object.keys(pkg.dependencies)).toEqual(Object.keys(pkg.dependencies).slice().sort());
  });

  it("preserves existing exports and adds ./client entry", () => {
    const sink = render(answers()) as InMemorySink;
    const pkg = JSON.parse(sink.files.get("package.json")!) as { exports: Record<string, string> };
    expect(pkg.exports["./bridge"]).toBe("./src/bridge.ts");
    expect(pkg.exports["./client"]).toBe("./src/dashboard/client.tsx");
  });

  it("scaffolds src/dashboard/client.tsx with stubs for confirmed claims only", () => {
    const sink = render(answers()) as InMemorySink;
    const client = sink.files.get("src/dashboard/client.tsx")!;
    expect(client).toContain("export function ContentView");
    expect(client).toContain("export function ToolRenderer");
    expect(client).not.toContain("export function FolderSection");
  });

  it("does NOT write src/dashboard/server.ts when addServer=false", () => {
    const sink = render(answers({ addServer: false })) as InMemorySink;
    expect(sink.files.has("src/dashboard/server.ts")).toBe(false);
  });

  it("writes src/dashboard/server.ts when addServer=true", () => {
    const sink = render(answers({ addServer: true })) as InMemorySink;
    expect(sink.files.has("src/dashboard/server.ts")).toBe(true);
    const pkg = JSON.parse(sink.files.get("package.json")!) as { "pi-dashboard-plugin": { server?: string } };
    expect(pkg["pi-dashboard-plugin"].server).toBe("./src/dashboard/server.ts");
  });

  it("does not write any pre-existing source file", () => {
    // Renderer only writes to the sink; we can also verify the only files are the additive ones.
    const sink = render(answers()) as InMemorySink;
    const written = Array.from(sink.files.keys()).sort();
    expect(written).toEqual(["package.json", "src/dashboard/client.tsx", "vite.dashboard.config.ts"]);
  });
});

describe("render augment — forward-compat contract (items 1-5)", () => {
  it("(1) manifest field at top level of package.json", () => {
    const sink = render(answers()) as InMemorySink;
    const pkg = JSON.parse(sink.files.get("package.json")!) as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(pkg, "pi-dashboard-plugin")).toBe(true);
    // Not nested under pi
    const piField = (pkg["pi"] as Record<string, unknown> | undefined) ?? {};
    expect(piField["pi-dashboard-plugin"]).toBeUndefined();
  });

  it("(2) all manifest paths are package-relative, no leading / or escaping ..", () => {
    const sink = render(answers({ addServer: true })) as InMemorySink;
    const pkg = JSON.parse(sink.files.get("package.json")!) as { "pi-dashboard-plugin": Record<string, unknown> };
    const m = pkg["pi-dashboard-plugin"];
    for (const key of ["client", "server", "bridge", "configSchema"]) {
      const value = m[key];
      if (value === undefined) continue;
      expect(typeof value).toBe("string");
      const v = value as string;
      expect(v.startsWith("/")).toBe(false);
      expect(v.includes("../")).toBe(false);
      expect(v.startsWith("./")).toBe(true);
    }
  });

  it("(3) does not introduce workspace:* deps", () => {
    const sink = render(answers()) as InMemorySink;
    const pkg = JSON.parse(sink.files.get("package.json")!) as { dependencies: Record<string, string> };
    for (const v of Object.values(pkg.dependencies)) {
      expect(v.startsWith("workspace:")).toBe(false);
    }
  });

  it("(4) exports declares a subpath matching every manifest path", () => {
    const sink = render(answers({ addServer: true })) as InMemorySink;
    const pkg = JSON.parse(sink.files.get("package.json")!) as {
      exports: Record<string, string>;
      "pi-dashboard-plugin": Record<string, string>;
    };
    expect(pkg.exports["./client"]).toBe(pkg["pi-dashboard-plugin"].client);
    expect(pkg.exports["./server"]).toBe(pkg["pi-dashboard-plugin"].server);
  });

  it("(5) manifest declares requiredApi as a non-empty string", () => {
    const sink = render(answers()) as InMemorySink;
    const pkg = JSON.parse(sink.files.get("package.json")!) as { "pi-dashboard-plugin": { requiredApi: string } };
    expect(typeof pkg["pi-dashboard-plugin"].requiredApi).toBe("string");
    expect(pkg["pi-dashboard-plugin"].requiredApi.length).toBeGreaterThan(0);
  });
});

describe("render new — forward-compat contract (mode new also satisfies 1-5)", () => {
  it("new-mode output also satisfies all 5 items", async () => {
    const { render: r, InMemorySink: Mem } = await import("../render.js");
    const sink = r({
      mode: "new",
      id: "fwd",
      displayName: "Forward",
      priority: 100,
      slots: ["session-card-badge"],
      server: true,
      bridge: true,
      configSchema: true,
      outDir: "/virtual",
    }) as InstanceType<typeof Mem>;
    const pkg = JSON.parse(sink.files.get("package.json")!) as {
      exports: Record<string, string>;
      dependencies: Record<string, string>;
      "pi-dashboard-plugin": Record<string, string>;
    };
    // (1)
    expect(pkg["pi-dashboard-plugin"].id).toBe("fwd");
    // (2)
    for (const k of ["client", "server", "bridge", "configSchema"]) {
      const v = pkg["pi-dashboard-plugin"][k];
      if (!v) continue;
      expect(v.startsWith("./")).toBe(true);
      expect(v.includes("../")).toBe(false);
    }
    // (3)
    for (const v of Object.values(pkg.dependencies)) expect(v.startsWith("workspace:")).toBe(false);
    // (4)
    expect(pkg.exports["./client"]).toBe(pkg["pi-dashboard-plugin"].client);
    expect(pkg.exports["./server"]).toBe(pkg["pi-dashboard-plugin"].server);
    expect(pkg.exports["./bridge"]).toBe(pkg["pi-dashboard-plugin"].bridge);
    // (5)
    expect(pkg["pi-dashboard-plugin"].requiredApi).toBeTruthy();
  });
});

describe("render augment — runtime-delivered manifest and build wiring (task 7.9)", () => {
  const manifestOf = (sink: InMemorySink) => (JSON.parse(sink.files.get("package.json")!) as PackageJson)["pi-dashboard-plugin"]!;

  it("emits clientBundle in a dedicated dir and no clientStyles by default", () => {
    const m = manifestOf(render(answers()) as InMemorySink);
    expect(m.clientBundle).toBe("./dist/client/index.js");
    expect(m.clientStyles).toBeUndefined();
    expect(m.hostApi).toBe(scaffoldHostApiRange());
  });

  it("emits clientStyles inside the bundle dir when the project has styles", () => {
    const sink = render(answers({ styles: true })) as InMemorySink;
    expect(manifestOf(sink).clientStyles).toBe("./dist/client/client.css");
    expect(sink.files.get("vite.dashboard.config.ts")).not.toContain("styles: false");
    const pkg = JSON.parse(sink.files.get("package.json")!) as PackageJson;
    expect(pkg.devDependencies).toMatchObject({ "@tailwindcss/vite": expect.any(String), tailwindcss: expect.any(String) });
  });

  it("keeps the server entry outside the bundle dir", () => {
    const sink = render(answers({ addServer: true, styles: true })) as InMemorySink;
    expect(manifestOf(sink).server).toBe("./src/dashboard/server.ts");
    expect(contractViolations(JSON.parse(sink.files.get("package.json")!) as PackageJson, { requireRuntime: true })).toEqual([]);
  });

  it("adds a build:dashboard script over the preset, with its toolchain as devDependencies", () => {
    const sink = render(answers()) as InMemorySink;
    const pkg = JSON.parse(sink.files.get("package.json")!) as PackageJson;
    expect(pkg.scripts?.["build:dashboard"]).toContain("vite.dashboard.config.ts");
    expect(pkg.devDependencies).toMatchObject({ vite: expect.any(String), react: expect.any(String) });
    expect(pkg.devDependencies?.tailwindcss).toBeUndefined();
    const cfg = sink.files.get("vite.dashboard.config.ts")!;
    expect(cfg).toContain('from "@blackbelt-technology/dashboard-plugin-runtime/vite-plugin"');
    expect(cfg).toContain("dashboardClientViteConfig");
    expect(cfg).toContain('entry: "src/dashboard/client.tsx"');
    expect(cfg).toContain('outDir: "dist/client"');
    expect(cfg).toContain("styles: false");
  });

  it("preserves the author's scripts, devDependencies and an explicit files allow-list (adding the bundle + entries)", () => {
    fs.writeFileSync(
      path.join(workdir, "package.json"),
      JSON.stringify({ ...BASE_PKG, scripts: { build: "tsc" }, devDependencies: { vite: "^6.2.0", typescript: "^5.0.0" }, files: ["src/"] }, null, 2),
    );
    const pkg = JSON.parse((render(answers()) as InMemorySink).files.get("package.json")!) as PackageJson & { files: string[] };
    expect(pkg.scripts?.build).toBe("tsc");
    expect(pkg.devDependencies?.vite).toBe("^6.2.0");
    expect(pkg.devDependencies?.typescript).toBe("^5.0.0");
    expect(pkg.files).toEqual(["src/", "dist/client/", "src/dashboard/"]);
  });
});

describe("render augment — refuses to run outside a pi extension (#X14)", () => {
  const listing = (dir: string): string =>
    fs
      .readdirSync(dir, { recursive: true, withFileTypes: true })
      .map((e) => path.join(e.parentPath, e.name))
      .sort()
      .map((f) => `${path.relative(dir, f)}:${fs.statSync(f).isFile() ? crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex") : "dir"}`)
      .join("\n");

  it.each([
    ["no pi-coding-agent anywhere", { ...BASE_PKG, dependencies: { lodash: "^4.0.0" } }],
    ["pi-coding-agent only in devDependencies", { ...BASE_PKG, dependencies: {}, devDependencies: { "pi-coding-agent": "*" } }],
  ])("aborts naming pi-coding-agent and writes nothing (%s)", (_label, pkg) => {
    fs.mkdirSync(path.join(workdir, "src"));
    fs.writeFileSync(path.join(workdir, "src/foo.ts"), "export const a = 1;\n");
    fs.writeFileSync(path.join(workdir, "package.json"), JSON.stringify(pkg, null, 2));
    const before = listing(workdir);
    const sink = new FsSink(workdir);
    expect(() => render(answers(), sink)).toThrow(/pi-coding-agent/);
    expect(listing(workdir)).toBe(before);
  });

  it("aborts when package.json is absent, writing nothing", () => {
    fs.rmSync(path.join(workdir, "package.json"));
    expect(() => render(answers(), new FsSink(workdir))).toThrow(/package\.json/);
    expect(fs.readdirSync(workdir)).toEqual([]);
  });

  it("accepts pi-coding-agent as a peerDependency, and a scoped fork of it", () => {
    fs.writeFileSync(path.join(workdir, "package.json"), JSON.stringify({ ...BASE_PKG, dependencies: {}, peerDependencies: { "@scope/pi-coding-agent": "*" } }, null, 2));
    expect(() => render(answers())).not.toThrow();
  });
});

describe("render augment — original sources untouched; runtime-deliverable (#E97)", () => {
  const REPO_ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "../../../..");
  const ALLOWED = [/^package\.json$/, /^src\/dashboard\/(client\.tsx|server\.ts)$/, /^dashboard\.config\.json$/, /^vite\.dashboard\.config\.ts$/, /^package-lock\.json$/, /^node_modules(\/|$)/, /^dist\/client\//];
  const SOURCES = { "src/foo.ts": "export const foo = 1;\n", "src/bar.ts": "export const bar = 2;\n", "README.md": "# sample\n" };
  const roots: string[] = [];
  afterEach(() => {
    for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
  });

  const hashTree = (dir: string): Map<string, string> => {
    const out = new Map<string, string>();
    const walk = (d: string): void => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const abs = path.join(d, e.name);
        if (e.name === "node_modules") out.set(path.relative(dir, abs), "node_modules");
        else if (e.isDirectory()) walk(abs);
        else out.set(path.relative(dir, abs), crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex"));
      }
    };
    walk(dir);
    return out;
  };

  /** A project dir wired like an installed dashboard toolchain: published SDK packages copied (not linked) into node_modules. */
  function project(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "augment-build-"));
    roots.push(dir);
    fs.mkdirSync(path.join(dir, "src"));
    for (const [f, c] of Object.entries(SOURCES)) fs.writeFileSync(path.join(dir, f), c);
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ ...BASE_PKG, name: "@scope/foo" }, null, 2));
    const nm = path.join(dir, "node_modules");
    for (const [name, pkgDir] of [["dashboard-plugin-runtime", "dashboard-plugin-runtime"], ["pi-dashboard-shared", "shared"], ["pi-dashboard-app-kit", "app-kit"]]) {
      fs.cpSync(path.join(REPO_ROOT, "packages", pkgDir), path.join(nm, "@blackbelt-technology", name), {
        recursive: true,
        filter: (src) => !/[\\/](node_modules|__tests__)([\\/]|$)/.test(src),
      });
    }
    for (const m of ["vite", "react", "react-dom", "wouter", "tailwindcss", "@tailwindcss/vite", "@tailwindcss/node", "@tailwindcss/oxide"]) {
      fs.mkdirSync(path.dirname(path.join(nm, m)), { recursive: true });
      fs.symlinkSync(path.join(REPO_ROOT, "node_modules", m), path.join(nm, m), "dir");
    }
    fs.mkdirSync(path.join(nm, ".bin"));
    fs.symlinkSync(path.join(REPO_ROOT, "node_modules/vite/bin/vite.js"), path.join(nm, ".bin/vite"));
    return dir;
  }

  it("leaves src/foo.ts, src/bar.ts, README.md hash-identical and touches only the allowed set", () => {
    const dir = project();
    const before = hashTree(dir);
    render(answers({ addServer: true }), new FsSink(dir));
    const after = hashTree(dir);
    for (const f of Object.keys(SOURCES)) expect(after.get(f), f).toBe(before.get(f));
    const changed = [...after].filter(([f, h]) => before.get(f) !== h).map(([f]) => f);
    expect(changed.length).toBeGreaterThan(0);
    for (const f of changed) expect(ALLOWED.some((re) => re.test(f)), f).toBe(true);
    expect([...before.keys()].filter((f) => !after.has(f))).toEqual([]); // nothing deleted
  });

  // The real build: the SDK preset over the rendered stubs, run exactly as the user would (`npm run build:dashboard`).
  it("`npm run build:dashboard` builds a React-free bundle whose manifest resolves from a node_modules copy", { timeout: 180_000 }, () => {
    const dir = project();
    render(answers({ styles: true }), new FsSink(dir));
    const before = hashTree(dir);
    const out = childProcess.execFileSync("npm", ["run", "build:dashboard"], { cwd: dir, encoding: "utf8", env: { ...process.env, NODE_ENV: "production" }, stdio: "pipe" });
    expect(out).toBeDefined();

    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as PackageJson;
    expect(contractViolations(pkg, { requireRuntime: true })).toEqual([]);
    expect(pkg["pi-dashboard-plugin"]?.hostApi).toBe(scaffoldHostApiRange());
    for (const f of ["dist/client/index.js", "dist/client/client.css"]) expect(fs.existsSync(path.join(dir, f)), f).toBe(true);

    // No copy of React in the bundle: it stays an import-map external.
    const bundle = fs.readdirSync(path.join(dir, "dist/client"), { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".js"))
      .map((e) => fs.readFileSync(path.join(e.parentPath, e.name), "utf8"))
      .join("\n");
    expect(bundle).not.toMatch(/__SECRET_INTERNALS_DO_NOT_USE|ReactCurrentOwner|react\.production|react-dom\.production/);
    expect(bundle).toMatch(/from\s*["']react\/jsx-runtime["']|from\s*["']react["']/);

    // The build touched nothing it should not have.
    const after = hashTree(dir);
    for (const f of Object.keys(SOURCES)) expect(after.get(f), f).toBe(before.get(f));
    for (const f of [...after.keys()].filter((k) => before.get(k) !== after.get(k))) expect(ALLOWED.some((re) => re.test(f)), f).toBe(true);

    // Published layout: copy into node_modules/@scope/foo/ — every manifest path resolves inside the copy.
    const consumer = fs.mkdtempSync(path.join(os.tmpdir(), "augment-consumer-"));
    roots.push(consumer);
    const installed = path.join(consumer, "node_modules/@scope/foo");
    fs.mkdirSync(path.dirname(installed), { recursive: true });
    fs.cpSync(dir, installed, { recursive: true, filter: (src) => path.basename(src) !== "node_modules" });
    expect(unresolvedManifestPaths(installed, JSON.parse(fs.readFileSync(path.join(installed, "package.json"), "utf8")) as PackageJson)).toEqual([]);
  });
});

describe("skill next-steps are printed, never auto-run (#E98)", () => {
  it("mode new prints the dashboard restart and reload commands; nothing is spawned", () => {
    const before = spawnCalls();
    const answersNew = { mode: "new" as const, id: "acme", displayName: "Acme", priority: 100, slots: ["session-card-badge" as const], server: true, bridge: false, configSchema: false, outDir: "/virtual" };
    render(answersNew);
    const text = nextSteps(answersNew);
    expect(text).toMatch(/curl -X POST http:\/\/localhost:8000\/api\/restart|pi-dashboard restart/);
    expect(text).toContain("npm run reload");
    expect(spawnCalls() - before).toBe(0);
  });

  it("mode augment prints build:dashboard, publish, global pi install, npm link and the trust note; nothing is spawned", () => {
    const before = spawnCalls();
    render(answers());
    const text = nextSteps(answers());
    expect(text).toContain("npm run build:dashboard");
    expect(text).toMatch(/npm publish/);
    expect(text).toContain("pi install npm:@scope/sample-extension");
    expect(text).toMatch(/after a dashboard restart/);
    expect(text).toMatch(/Packages tab[^.]*live/);
    expect(text).toContain("npm link");
    expect(text).toMatch(/trusts? its client bundle/);
    expect(text).toMatch(/on the dashboard host/);
    expect(text).toMatch(/^Next steps:\n {2}1\. /);
    expect(spawnCalls() - before).toBe(0);
  });

  it("falls back to <package> when the project's package.json is unreadable", () => {
    expect(nextSteps(answers({ outDir: path.join(workdir, "missing") }))).toContain("pi install npm:<package>");
  });
});
