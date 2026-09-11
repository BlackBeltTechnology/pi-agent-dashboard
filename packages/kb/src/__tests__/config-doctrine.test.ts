// Layered `doctrine` config group (change: inject-dox-doctrine-and-describe,
// test-plan #E1–#E8). The `doctrine` group governs per-turn READ/WRITE
// injection by the kb extension; `doctrineSource` distinguishes an explicit
// choice from defaults (KEY-presence, not file-presence).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";

let home: string;
let project: string;
let prevHome: string | undefined;

/** Write the global config into the isolated HOME. */
function writeGlobal(cfg: unknown): void {
  mkdirSync(join(home, ".pi", "dashboard"), { recursive: true });
  writeFileSync(join(home, ".pi", "dashboard", "knowledge_base.json"), JSON.stringify(cfg));
}
/** Write the project config into the temp project cwd. */
function writeProject(cfg: unknown): void {
  mkdirSync(join(project, ".pi", "dashboard"), { recursive: true });
  writeFileSync(join(project, ".pi", "dashboard", "knowledge_base.json"), JSON.stringify(cfg));
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "kb-doctrine-home-"));
  project = mkdtempSync(join(tmpdir(), "kb-doctrine-proj-"));
  prevHome = process.env.HOME;
  process.env.HOME = home;
});
afterEach(() => {
  if (prevHome === undefined) delete process.env.HOME;
  else process.env.HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
  rmSync(project, { recursive: true, force: true });
});

describe("doctrine config resolution (E1–E5)", () => {
  it("E1: no files → defaults {kb,false} and doctrineSource none", () => {
    const cfg = loadConfig(project);
    expect(cfg.doctrine).toEqual({ inject: "kb", write: false });
    expect(cfg.doctrineSource).toBe("none");
  });

  it("E2: global {inject:off} only → inject off, doctrineSource global", () => {
    writeGlobal({ doctrine: { inject: "off" } });
    const cfg = loadConfig(project);
    expect(cfg.doctrine.inject).toBe("off");
    expect(cfg.doctrine.write).toBe(false); // default filled
    expect(cfg.doctrineSource).toBe("global");
  });

  it("E3: project key-presence, not file-presence — project without doctrine → origin project, doctrineSource none", () => {
    writeProject({ readDiscipline: { guard: { mode: "warn" } } });
    const cfg = loadConfig(project);
    expect(cfg.origin).toBe("project");
    expect(cfg.doctrineSource).toBe("none");
  });

  it("E4: one-level deep merge across layers — global inject kb + project write true → {kb,true}, doctrineSource project", () => {
    writeGlobal({ doctrine: { inject: "kb" } });
    writeProject({ doctrine: { write: true } });
    const cfg = loadConfig(project);
    expect(cfg.doctrine).toEqual({ inject: "kb", write: true });
    expect(cfg.doctrineSource).toBe("project");
  });

  it("E5: empty doctrine object counts as a recorded choice → doctrineSource project, defaults", () => {
    writeProject({ doctrine: {} });
    const cfg = loadConfig(project);
    expect(cfg.doctrineSource).toBe("project");
    expect(cfg.doctrine).toEqual({ inject: "kb", write: false });
  });
});

describe("doctrine config validation (E6–E8)", () => {
  it("E6: doctrine:null throws naming doctrine", () => {
    writeProject({ doctrine: null });
    expect(() => loadConfig(project)).toThrow(/doctrine/);
  });

  it("E6b: array-valued doctrine throws naming doctrine", () => {
    // An array is `typeof object` but not a DoctrineConfig. If accepted, the
    // merged `doctrine` keeps `inject`/`write` undefined while doctrineSource is
    // "project" — a configured-but-inert hook. Validation must reject it.
    writeProject({ doctrine: [] });
    expect(() => loadConfig(project)).toThrow(/doctrine/);
  });

  it("E7: unknown inject mode throws the offending value", () => {
    writeProject({ doctrine: { inject: "manual" } });
    expect(() => loadConfig(project)).toThrow(/manual/);
  });

  it("E8: non-boolean write throws naming doctrine.write", () => {
    writeProject({ doctrine: { write: "yes" } });
    expect(() => loadConfig(project)).toThrow(/doctrine\.write/);
  });
});
