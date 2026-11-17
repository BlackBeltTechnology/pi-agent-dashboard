import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cmdSwitch, detect, purge } from "../switch-source";

const NPM_NAME = "@blackbelt-technology/pi-dashboard-kb-extension";
const KB_PATH = "+packages/kb-extension/src/index.ts";
const BRIDGE_PATH = "+packages/extension/src/bridge.ts";

type Paths = { global: string; project: string; pkgs: string };

let REPO: string;
let HOME: string;
let paths: Paths;
let errSpy: ReturnType<typeof vi.spyOn>;

function writeJsonFile(p: string, obj: unknown) {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, `${JSON.stringify(obj, null, 2)}\n`);
}
const readJsonFile = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const backups = (p: string) => readdirSync(dirname(p)).filter((f) => f.startsWith("settings.json.bak-switch-"));

const KB = { dir: "kb-extension", npmName: NPM_NAME, hasExt: true, entry: "src/extension.ts" };

beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), "switch-source-"));
  REPO = join(root, "repo");
  HOME = join(root, "home");
  paths = {
    global: join(HOME, ".pi", "agent", "settings.json"),
    project: join(REPO, ".pi", "settings.json"),
    pkgs: join(REPO, "packages"),
  };
  writeJsonFile(join(paths.pkgs, "kb-extension", "package.json"), {
    name: NPM_NAME,
    pi: { extensions: ["src/extension.ts"] },
  });
  writeJsonFile(paths.global, { packages: [] });
  vi.spyOn(console, "log").mockImplementation(() => {});
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`process.exit(${code})`);
  }) as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Run purge for kb-extension on an in-memory project against the temp repo. */
function purgeProject(project: any) {
  purge({ packages: [] }, project, KB, paths.project);
  return project;
}

describe("purge — prune emptied project entries", () => {
  it("E1: repairs leftover repo-root residue on a switch", () => {
    writeJsonFile(paths.project, { packages: [{ source: "..", extensions: [] }], flows: { editFlow: true } });
    cmdSwitch("npm", "kb-extension", false, paths);
    expect(readJsonFile(paths.project)).toEqual({ flows: { editFlow: true } });
    expect(readJsonFile(paths.global).packages).toContain(`npm:${NPM_NAME}`);
  });

  it("E2: last overlay path removed drops the entry and the list", () => {
    writeJsonFile(paths.project, {
      packages: [{ source: "..", extensions: [KB_PATH] }],
      skills: ["-skills/x/SKILL.md"],
    });
    cmdSwitch("local", "kb-extension", false, paths);
    expect(readJsonFile(paths.project)).toEqual({ skills: ["-skills/x/SKILL.md"] });
    expect(readJsonFile(paths.global).packages).toContain(`${REPO}/packages/kb-extension`);
  });

  it("E3: remaining paths are kept", () => {
    const project = purgeProject({ packages: [{ source: "..", extensions: [KB_PATH, BRIDGE_PATH] }] });
    expect(project.packages).toHaveLength(1);
    expect(project.packages[0].extensions).toEqual([BRIDGE_PATH]);
  });

  it("E4: a non-empty sibling filter is kept", () => {
    const project = purgeProject({ packages: [{ source: "..", extensions: [KB_PATH], skills: ["some/skill"] }] });
    expect(project.packages).toEqual([{ source: "..", skills: ["some/skill"] }]);
  });

  it("E5: every empty array on the root entry is removed", () => {
    const project = purgeProject({ packages: [{ source: "..", extensions: [KB_PATH], skills: [] }] });
    expect(project).not.toHaveProperty("packages");
  });

  it("E6: non-candidates are untouched", () => {
    const input = [
      { source: "npm:x", autoload: false, extensions: [] },
      { source: "npm:other-pkg", extensions: [] },
      "npm:bare",
      { source: ".." },
      { source: "..", extensions: [BRIDGE_PATH] },
    ];
    const project = purgeProject({ packages: structuredClone(input) });
    expect(project.packages).toEqual(input);
  });

  it("E7: an empty packages list is removed", () => {
    const project = purgeProject({ packages: [] });
    expect(project).not.toHaveProperty("packages");
  });

  it("E8: the absolute root spelling counts as root", () => {
    const project = purgeProject({ packages: [{ source: REPO, extensions: [] }] });
    expect(project).not.toHaveProperty("packages");
  });

  it("E9: a non-root relative source is left alone", () => {
    const project = purgeProject({ packages: [{ source: "../..", extensions: [] }] });
    expect(project.packages).toEqual([{ source: "../..", extensions: [] }]);
  });

  it("E10: no repo-root entry ends with an empty filter", () => {
    const fixtures: any[] = [
      { packages: [{ source: "..", extensions: [] }], flows: { editFlow: true } },
      { packages: [{ source: "..", extensions: [KB_PATH] }] },
      { packages: [{ source: "..", extensions: [KB_PATH, BRIDGE_PATH] }] },
      { packages: [{ source: "..", extensions: [KB_PATH], skills: ["some/skill"] }] },
      { packages: [{ source: "..", extensions: [KB_PATH], skills: [] }] },
      {
        packages: [
          { source: "npm:x", autoload: false, extensions: [] },
          { source: "npm:other-pkg", extensions: [] },
          "npm:bare",
          { source: ".." },
          { source: "..", extensions: [BRIDGE_PATH] },
        ],
      },
      { packages: [] },
      { packages: [{ source: REPO, extensions: [] }] },
      { packages: [{ source: "../..", extensions: [] }] },
      { packages: [{ source: "..", prompts: [], themes: [], extensions: [KB_PATH] }] },
    ];
    const projectDir = dirname(paths.project);
    for (const f of fixtures) {
      const out = purgeProject(f);
      for (const e of out.packages ?? []) {
        if (!e || typeof e !== "object" || typeof e.source !== "string") continue;
        if (resolve(projectDir, e.source) !== REPO || e.autoload === false) continue;
        for (const key of ["extensions", "skills", "prompts", "themes"]) {
          expect(Array.isArray(e[key]) && e[key].length === 0, `${key} on ${JSON.stringify(e)}`).toBe(false);
        }
      }
    }
  });
});

describe("cmdSwitch — one source per package", () => {
  it("E11: local→npm leaves one source", () => {
    writeJsonFile(paths.global, {
      packages: ["npm:a", `${REPO}/packages/kb-extension`, `${REPO}/packages/kb-extension/src/extension.ts`],
    });
    cmdSwitch("npm", "kb-extension", false, paths);
    expect(readJsonFile(paths.global).packages).toEqual(["npm:a", `npm:${NPM_NAME}`]);
  });

  it("E12: npm→local leaves one source", () => {
    writeJsonFile(paths.global, { packages: [`npm:${NPM_NAME}`] });
    cmdSwitch("local", "kb-extension", false, paths);
    expect(readJsonFile(paths.global).packages).toEqual([`${REPO}/packages/kb-extension`]);
  });

  it("X3: object and malformed entries do not break a switch", () => {
    const objEntry = { source: "npm:other-pkg", skills: ["-x"] };
    writeJsonFile(paths.global, { packages: [objEntry] });
    writeJsonFile(paths.project, { packages: [null, { extensions: [] }] });
    expect(() => detect(readJsonFile(paths.global), readJsonFile(paths.project), KB, paths.project)).not.toThrow();
    cmdSwitch("npm", "kb-extension", false, paths);
    expect(readJsonFile(paths.global).packages).toEqual([objEntry, `npm:${NPM_NAME}`]);
    expect(readJsonFile(paths.project).packages).toEqual([null, { extensions: [] }]);
  });
});

describe("cmdSwitch — overlay removed, file handling", () => {
  it("X1: the overlay flag is rejected before any read or write", () => {
    writeJsonFile(paths.project, { packages: [{ source: "..", extensions: [BRIDGE_PATH] }] });
    const gBytes = readFileSync(paths.global, "utf8");
    const pBytes = readFileSync(paths.project, "utf8");
    expect(() => cmdSwitch("local", "kb-extension", true, paths)).toThrow("process.exit(1)");
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(errSpy.mock.calls.flat().join("\n")).toContain("local");
    expect(readFileSync(paths.global, "utf8")).toBe(gBytes);
    expect(readFileSync(paths.project, "utf8")).toBe(pBytes);
    expect(backups(paths.global)).toEqual([]);
    expect(backups(paths.project)).toEqual([]);
  });

  it("X2: a missing project file is handled", () => {
    cmdSwitch("local", "kb-extension", false, paths);
    expect(process.exit).not.toHaveBeenCalled();
    expect(readJsonFile(paths.global).packages).toEqual([`${REPO}/packages/kb-extension`]);
    expect(existsSync(paths.project)).toBe(false);
    expect(existsSync(dirname(paths.project)) ? backups(paths.project) : []).toEqual([]);
  });

  it("E14: an unchanged project file is not rewritten", () => {
    writeJsonFile(paths.project, { flows: { editFlow: true } });
    const pBytes = readFileSync(paths.project, "utf8");
    cmdSwitch("npm", "kb-extension", false, paths);
    expect(readFileSync(paths.project, "utf8")).toBe(pBytes);
    expect(backups(paths.project)).toEqual([]);
  });

  it("E13: leftover overlay entries still report and clean up", () => {
    writeJsonFile(paths.project, { packages: [{ source: "..", extensions: [KB_PATH] }] });
    expect(detect(readJsonFile(paths.global), readJsonFile(paths.project), KB, paths.project)).toBe(
      "local (project overlay)",
    );
    cmdSwitch("npm", "kb-extension", false, paths);
    expect(readJsonFile(paths.global).packages).toEqual([`npm:${NPM_NAME}`]);
    expect(readJsonFile(paths.project)).not.toHaveProperty("packages");
  });

  it("X5: an edited file is backed up and stays valid JSON", () => {
    writeJsonFile(paths.global, { packages: ["npm:a"], theme: "dark" });
    const prior = readFileSync(paths.global, "utf8");
    cmdSwitch("npm", "kb-extension", false, paths);
    const baks = backups(paths.global);
    expect(baks).toHaveLength(1);
    expect(baks[0]).toMatch(/^settings\.json\.bak-switch-\d+$/);
    expect(readFileSync(join(dirname(paths.global), baks[0]), "utf8")).toBe(prior);
    expect(() => JSON.parse(readFileSync(paths.global, "utf8"))).not.toThrow();
  });
});
