/**
 * Config layering, project-override limits, prototype-pollution hygiene and
 * shape handling. Tasks 2.1–2.5 (test-plan E12–E16).
 * Exemplar: packages/kb/src/__tests__/config-doctrine.test.ts.
 * See change: add-system-one-registry.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig, userConfigPath } from "../config.js";
import { predict } from "../predict.js";
import type { ConsumerDeclaration } from "../types.js";
import { freshState } from "./helpers/config.js";
import { type FakeBackend, interceptOffMachine, startFakeBackend } from "./helpers/fake-backend.js";

let warn: { mock: { calls: unknown[][] }; mockRestore(): void };
beforeEach(() => {
  freshState();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
});
const warnings = (): string[] => warn.mock.calls.map((c: unknown[]) => String(c[0])).filter((m: string) => m.startsWith("[system-one]"));

function writeUser(v: unknown | string): void {
  mkdirSync(join(homedir(), ".pi", "agent"), { recursive: true });
  writeFileSync(userConfigPath(), typeof v === "string" ? v : JSON.stringify(v));
}
function projectDir(v?: unknown | string): string {
  const cwd = mkdtempSync(join(tmpdir(), "s1-proj-"));
  if (v !== undefined) {
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    writeFileSync(join(cwd, ".pi", "system-one.json"), typeof v === "string" ? v : JSON.stringify(v));
  }
  return cwd;
}

const USER = {
  version: 1,
  allowOffMachine: false,
  backends: { "local-von": { kind: "managed", engine: "von", port: 18401 } },
  presets: { p: { chain: ["local-von"], consumers: { c: { chain: ["local-von"] } } } },
  activePreset: "p",
  calibration: {},
};
const PROJ = { version: 1, presets: { p: { consumers: { c: { chain: [] } } } } };

describe("E12 layering (2.1)", () => {
  type U = "valid" | "invalid" | "absent" | "v2";
  type Pj = "valid" | "invalid" | "absent";
  const users: U[] = ["valid", "invalid", "absent", "v2"];
  const projects: Pj[] = ["valid", "invalid", "absent"];
  const args = ["none", "untrusted", "trusted"] as const;

  const USER_TEXT: Record<U, unknown | string | undefined> = { valid: USER, invalid: "{nope", absent: undefined, v2: { ...USER, version: 2 } };
  const PROJ_TEXT: Record<Pj, unknown | string | undefined> = { valid: PROJ, invalid: "{nope", absent: undefined };

  /** Spec'd chain for consumer `c`: the project applies only over a valid user layer with a trusted, valid project. */
  function expectedChain(u: U, pj: Pj, a: (typeof args)[number]): string[] | undefined {
    if (u !== "valid") return undefined;
    return pj === "valid" && a === "trusted" ? [] : ["local-von"];
  }
  /** One warning per bad layer. A trusted, valid project over an absent user layer names a non-active preset → one. */
  function expectedProjectWarnings(u: U, pj: Pj, a: (typeof args)[number]): number {
    if (a !== "trusted") return 0;
    return pj === "invalid" || (pj === "valid" && u !== "valid") ? 1 : 0;
  }
  const expected = (u: U, pj: Pj, a: (typeof args)[number]) => ({
    activePreset: u === "valid" ? "p" : "",
    chain: expectedChain(u, pj, a),
    userWarnings: u === "invalid" || u === "v2" ? 1 : 0,
    projectWarnings: expectedProjectWarnings(u, pj, a),
  });

  const cells = users.flatMap((u) => projects.flatMap((pj) => args.map((a) => [u, pj, a] as const)));
  for (const [u, pj, a] of cells) {
    it(`user=${u} project=${pj} arg=${a}`, () => {
      if (USER_TEXT[u] !== undefined) writeUser(USER_TEXT[u]);
      const cwd = projectDir(PROJ_TEXT[pj]);
      const project = a === "none" ? undefined : { cwd, trusted: a === "trusted" };

      const cfg = loadConfig({ project });
      loadConfig({ project }); // a second load must not re-warn

      const want = expected(u, pj, a);
      expect(cfg.activePreset).toBe(want.activePreset);
      expect(cfg.presets.p?.consumers?.c?.chain).toEqual(want.chain);
      const w = warnings();
      expect(w.filter((m) => m.includes(userConfigPath()))).toHaveLength(want.userWarnings);
      expect(w.filter((m) => m.includes(join(cwd, ".pi", "system-one.json")))).toHaveLength(want.projectWarnings);
    });
  }
});

describe("E13 project override limits (2.2)", () => {
  it("applies only the consumer chain; warns once per ignored key", () => {
    writeUser(USER);
    const cwd = projectDir({
      version: 1,
      allowOffMachine: true,
      backends: { evil: { kind: "http", url: "https://attacker.example/v1/systemone", model: "x" } },
      activePreset: "other",
      calibration: { x: { mode: "enforce", thresholds: {}, model: "m", measuredAt: "t" } },
      presets: { p: { consumers: { c: { chain: ["local-von"] } } } },
    });
    const cfg = loadConfig({ project: { cwd, trusted: true } });
    expect(cfg.allowOffMachine).toBe(false);
    expect(cfg.backends.evil).toBeUndefined();
    expect(cfg.activePreset).toBe("p");
    expect(cfg.calibration.x).toBeUndefined();
    expect(cfg.presets.p.consumers?.c.chain).toEqual(["local-von"]);
    expect(warnings()).toHaveLength(4);
  });
});

describe("E14 project cannot retarget to hosted (2.3)", () => {
  let jev: FakeBackend;
  afterEach(async () => jev?.close());

  it("drops the off-machine id; the hosted backend sees no request", async () => {
    const icpt = interceptOffMachine();
    try {
      const von = await startFakeBackend();
      jev = von;
      writeUser({
        ...USER,
        allowOffMachine: true,
        backends: {
          jev: { kind: "http", url: "https://api.typesafe.ai/v1/systemone", model: "jev-1.13.0" },
          von: { kind: "http", url: von.url, model: "von-1.2" },
        },
        presets: { p: { chain: ["von"] } },
      });
      const cwd = projectDir({ version: 1, presets: { p: { consumers: { c: { chain: ["jev", "von"] } } } } });
      const cfg = loadConfig({ project: { cwd, trusted: true } });
      expect(cfg.presets.p.consumers?.c.chain).toEqual(["von"]);
      expect(warnings().filter((m) => m.includes("jev"))).toHaveLength(1);

      const consumer: ConsumerDeclaration = { id: "c", failurePolicy: "fail-open" };
      const r = await predict({ consumer, state: "s", questions: { q: { type: "noul", instructions: "i" } }, project: { cwd, trusted: true } });
      expect(r.ok && r.backendId).toBe("von");
      expect(icpt.offMachine).toHaveLength(0);
    } finally {
      icpt.restore();
    }
  });
});

describe("E15 prototype pollution (2.4)", () => {
  it("drops __proto__/constructor/prototype at any depth", () => {
    writeUser(USER);
    const text = `{"version":1,"constructor":{"x":1},"presets":{"p":{"consumers":{
      "__proto__":{"allowOffMachine":true},
      "c":{"chain":["local-von"],"a":{"b":{"prototype":{"polluted":true}}}}}}}}`;
    const cwd = projectDir(text);
    const cfg = loadConfig({ project: { cwd, trusted: true } });
    expect(cfg.allowOffMachine).toBe(false);
    expect(({} as any).allowOffMachine).toBeUndefined();
    expect(({} as any).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(cfg.presets)).toBeNull();
    const dropped = warnings().filter((m) => /__proto__|constructor|prototype/.test(m));
    expect(dropped).toHaveLength(3);
  });
});

describe("E16 shape handling (2.5)", () => {
  let f: FakeBackend;
  afterEach(async () => f?.close());
  const q = { q: { type: "noul" as const, instructions: "i" } };
  const consumer: ConsumerDeclaration = { id: "c", failurePolicy: "fail-closed" };

  it("resolves a managed port to its loopback URL", async () => {
    f = await startFakeBackend();
    writeUser({ ...USER, backends: { m: { kind: "managed", engine: "von", port: f.port } }, presets: { p: { chain: ["m"] } } });
    const r = await predict({ consumer, state: "s", questions: q });
    expect(r.ok).toBe(true);
    expect(f.requests[0].path).toBe("/v1/systemone");
  });

  it("a portless managed backend is no-backend", async () => {
    writeUser({ ...USER, backends: { m: { kind: "managed", engine: "von" } }, presets: { p: { chain: ["m"] } } });
    const r = await predict({ consumer, state: "s", questions: q });
    expect(r).toMatchObject({ ok: false, reason: "no-backend" });
  });

  it("uses llm capabilities from config", async () => {
    writeUser({ ...USER, backends: { l: { kind: "llm", role: "@fast", capabilities: { maxOptions: 2 } } }, presets: { p: { chain: ["l"] } } });
    const call = vi.fn();
    const r = await predict({
      consumer,
      state: "s",
      questions: { q: { type: "choice", instructions: "i", criteria: { a: "", b: "", c: "" } } },
      llmCaller: { call, isLocal: () => true },
    });
    expect(r).toMatchObject({ ok: false, reason: "capability" });
    expect(call).not.toHaveBeenCalled();
  });

  it("ignores key-like fields on a backend with a warning", async () => {
    f = await startFakeBackend();
    writeUser({ ...USER, backends: { h: { kind: "http", url: f.url, model: "x", apiKey: "sk-LEAK", token: "t" } }, presets: { p: { chain: ["h"] } } });
    const r = await predict({ consumer, state: "s", questions: q });
    expect(r.ok).toBe(true);
    expect(f.requests[0].headers.authorization).toBeUndefined();
    expect(warnings().some((m) => m.includes("key-like"))).toBe(true);
  });
});
