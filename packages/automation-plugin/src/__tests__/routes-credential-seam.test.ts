/**
 * The automation `result` / `definition` routes read file CONTENT only through the host's `readFileGuarded` seam
 * and fail closed when it answers `null` or is absent (an older host): each read takes its existing failed-read
 * branch and plain `fs` is never used as a fallback.
 *
 * The seam stand-in decides on the REAL path (a symlink inside the cwd to a credential file is refused); the real
 * guard is covered in the server package (`agent-credential-guard.test.ts`).
 *
 * See change: close-security-map-high-findings (D1, H1; test-plan #E30, #E32).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type AutomationRouteHooks, mountAutomationRoutes } from "../server/routes.js";
import { finishRun, startRun } from "../server/run-store.js";

const MARK = "AUTOMATION-CRED-MARKER-31c0";
const YAML = `on: { kind: schedule, cron: "* * * * *" }
action: { kind: prompt, prompt: ./prompt.md }
model: "@fast"
`;

let tmp: string;
let cwd: string;
let cred: string;

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "auto-seam-")));
  cwd = path.join(tmp, "repo");
  fs.mkdirSync(path.join(tmp, "agent"), { recursive: true });
  cred = path.join(tmp, "agent", "auth.json");
  fs.writeFileSync(cred, MARK);
  const dir = path.join(cwd, ".pi", "automation", "nightly");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "automation.yaml"), YAML);
  fs.writeFileSync(path.join(dir, "prompt.md"), "ordinary prompt");
  startRun(cwd, "nightly", { runId: "r1" });
  finishRun(cwd, "r1", { status: "done", result: "- ordinary result" });
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmp, { recursive: true, force: true });
});

type Guard = AutomationRouteHooks["readFileGuarded"];
/** Refuses a path whose REAL path is a credential file, otherwise reads it. */
const realPathGuard: Guard = async (p) => (fs.realpathSync(p).endsWith(`${path.sep}auth.json`) ? null : fs.promises.readFile(p, "utf-8"));
const okGuard: Guard = (p) => fs.promises.readFile(p, "utf-8");

async function appWith(guard: Guard): Promise<FastifyInstance> {
  const app = Fastify();
  mountAutomationRoutes(app, { knownCwds: () => [cwd], readFileGuarded: guard });
  await app.ready();
  return app;
}
const q = (o: Record<string, string>) => new URLSearchParams(o).toString();
const definition = (app: FastifyInstance) =>
  app.inject({ method: "GET", url: `/api/plugins/automation/definition?${q({ cwd, scope: "folder", name: "nightly" })}` });
const result = (app: FastifyInstance) =>
  app.inject({ method: "GET", url: `/api/plugins/automation/result?${q({ cwd, scope: "folder", runId: "r1" })}` });

describe("E30 — the seam present+ok / null / absent", () => {
  it("present+ok: unchanged content", async () => {
    const app = await appWith(okGuard);
    expect((await definition(app)).json().promptBody).toBe("ordinary prompt");
    expect((await result(app)).json()).toEqual({ result: "- ordinary result\n" });
    await app.close();
  });

  it.each([
    ["null", async () => null],
    ["absent (older host)", undefined],
  ] as Array<[string, Guard]>)("%s: each read takes its failed-read branch and plain fs is never used", async (_label, guard) => {
    const readSpy = vi.spyOn(fs, "readFileSync");
    const promisesSpy = vi.spyOn(fs.promises, "readFile");
    const app = await appWith(guard);
    const def = await definition(app);
    expect(def.statusCode).toBe(404);
    expect(def.json()).toEqual({ error: "automation not found" });
    const res = await result(app);
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "result not found" });
    const credReads = [...readSpy.mock.calls, ...promisesSpy.mock.calls].filter(([p]) => String(p).includes(`${path.sep}.pi${path.sep}automation${path.sep}`));
    expect(credReads).toEqual([]); // no route-side read of automation.yaml / prompt.md / result.md
    await app.close();
  });
});

describe("E32 — symlinked definition / result files are refused", () => {
  it("result.md → 404 'result not found'; automation.yaml → 404 'automation not found'; prompt.md → 200 with an empty promptBody; no credential bytes", async () => {
    const dir = path.join(cwd, ".pi", "automation", "nightly");
    const runDir = path.join(cwd, ".pi", "automation", "runs", "r1");
    const resultFile = fs.existsSync(path.join(runDir, "result.md")) ? path.join(runDir, "result.md") : undefined;
    const app = await appWith(realPathGuard);

    // controls: ordinary files unchanged
    expect((await definition(app)).json().promptBody).toBe("ordinary prompt");
    expect((await result(app)).json()).toEqual({ result: "- ordinary result\n" });

    // prompt.md → credential: the definition still parses (200) with an EMPTY prompt body
    fs.rmSync(path.join(dir, "prompt.md"));
    fs.symlinkSync(cred, path.join(dir, "prompt.md"));
    const promptLink = await definition(app);
    expect(promptLink.statusCode).toBe(200);
    expect(promptLink.json().promptBody).toBe("");
    expect(promptLink.body).not.toContain(MARK);

    // automation.yaml → credential
    fs.rmSync(path.join(dir, "automation.yaml"));
    fs.symlinkSync(cred, path.join(dir, "automation.yaml"));
    const yamlLink = await definition(app);
    expect(yamlLink.statusCode).toBe(404);
    expect(yamlLink.json()).toEqual({ error: "automation not found" });
    expect(yamlLink.body).not.toContain(MARK);

    // result.md → credential (wherever the run store keeps it)
    const found = findResultFile(cwd);
    const target = resultFile ?? found;
    expect(target, "run result.md exists").toBeTruthy();
    fs.rmSync(target as string);
    fs.symlinkSync(cred, target as string);
    const resLink = await result(app);
    expect(resLink.statusCode).toBe(404);
    expect(resLink.json()).toEqual({ error: "result not found" });
    expect(resLink.body).not.toContain(MARK);
    await app.close();
  });
});

function findResultFile(base: string): string | undefined {
  const stack = [base];
  while (stack.length > 0) {
    const d = stack.pop() as string;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.name === "result.md") return p;
    }
  }
  return undefined;
}
