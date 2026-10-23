/**
 * `GET /api/plugins/flows/flow-inputs` admits the request cwd and refuses traversal-shaped flow ids (S1r).
 *
 * See change: harden-git-terminal-plugin-boundaries (test-plan #SE30, #SE31, #SE39, #SP3, #SX4).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as guard from "@blackbelt-technology/pi-dashboard-shared/cwd-guard.js";
import { type GitProbeRunner, realpathAsync } from "@blackbelt-technology/pi-dashboard-shared/platform/git.js";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { flowYamlPath, mountFlowInputsRoute } from "../server/flow-inputs.js";

const URL_BASE = "/api/plugins/flows/flow-inputs";
const mkTmp = (prefix: string) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));

let R: string; // admitted cwd
let U: string; // existing, unadmitted cwd
let D: string; // decoy under process.cwd()
let readSpy: MockInstance<typeof fs.readFileSync>;
let admitSpy: MockInstance<typeof guard.admitCwd>;
let realAdmitCwd: typeof guard.admitCwd;

function writeFlow(cwd: string, ns: string, name: string): void {
  const dir = path.join(cwd, ".pi", "flows", "flows", ns, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "flow.yaml"), "name: x\ninputs:\n  a: { type: string }\n");
}

beforeEach(() => {
  R = mkTmp("flowin-admitted-");
  U = mkTmp("flowin-unknown-");
  D = mkTmp("flowin-decoy-");
  writeFlow(R, "ns", "ok");
  writeFlow(U, "ns", "ok");
  writeFlow(D, "ns", "ok");
  vi.spyOn(process, "cwd").mockReturnValue(D);
  realAdmitCwd = guard.admitCwd; // before the spy replaces it
  admitSpy = vi.spyOn(guard, "admitCwd");
  readSpy = vi.spyOn(fs, "readFileSync");
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const d of [R, U, D]) fs.rmSync(d, { recursive: true, force: true });
});

async function appWith(admitOptions?: NonNullable<Parameters<typeof mountFlowInputsRoute>[1]>["admitOptions"]): Promise<FastifyInstance> {
  const app = Fastify();
  mountFlowInputsRoute(app, { knownCwds: () => [R], ...(admitOptions ? { admitOptions } : {}) });
  await app.ready();
  return app;
}
const get = (app: FastifyInstance, query: string) => app.inject({ method: "GET", url: `${URL_BASE}?${query}` });
const enc = encodeURIComponent;
/** Flow-file reads attempted (any `flow.yaml` path), whichever cwd. */
const flowReads = () => readSpy.mock.calls.filter((c) => String(c[0]).endsWith("flow.yaml"));

describe("SE30 — flow ids cannot traverse", () => {
  const REFUSED = [".", "..", "../x", "a/b", "a\\b", "%2e%2e"];
  const ACCEPTED = ["team.review", "a..b", "...", ".hidden", "x."];
  // A flow id is `<ns>:<name>`; a refused token must also be refused as either segment.
  const forms = (id: string) => [id, `${id}:x`, `x:${id}`];

  for (const raw of REFUSED) {
    it(`refuses ${JSON.stringify(raw)} (raw and as ns / name segment) with 0 file reads`, async () => {
      const app = await appWith();
      for (const flow of forms(raw)) {
        readSpy.mockClear();
        // `%2e%2e` is sent percent-encoded so the server decodes it to `..`; the others are encoded verbatim.
        const flowParam = raw === "%2e%2e" ? flow : enc(flow);
        const res = await get(app, `cwd=${enc(R)}&flow=${flowParam}`);
        expect(res.statusCode, flow).toBe(400);
        expect(res.json().error).toBe("invalid_flow_id");
        expect(flowReads(), flow).toEqual([]);
      }
      await app.close();
    });
  }

  for (const id of ACCEPTED) {
    it(`accepts ${JSON.stringify(id)} (a read is attempted for the ns:name form)`, async () => {
      const app = await appWith();
      const bare = await get(app, `cwd=${enc(R)}&flow=${enc(id)}`);
      expect(bare.statusCode).toBe(200);
      for (const flow of [`${id}:x`, `x:${id}`]) {
        readSpy.mockClear();
        const res = await get(app, `cwd=${enc(R)}&flow=${enc(flow)}`);
        expect(res.statusCode, flow).toBe(200);
        expect(res.json()).toEqual({ inputs: [] });
        expect(flowReads(), flow).toHaveLength(1);
      }
      await app.close();
    });
  }

  it("flowYamlPath itself returns null for a dot-segment (defence in depth)", () => {
    expect(flowYamlPath(R, "..:x")).toBeNull();
    expect(flowYamlPath(R, "x:..")).toBeNull();
    expect(flowYamlPath(R, ".:x")).toBeNull();
    expect(flowYamlPath(R, "a..b:c")).not.toBeNull();
  });
});

describe("SE31 — flow-inputs cwd: absent, empty, unadmitted, admitted, indeterminate", () => {
  it("absent or empty cwd → 400 cwd_required, before admission, never the server cwd", async () => {
    const app = await appWith();
    for (const q of ["flow=ns:ok", `cwd=&flow=${enc("ns:ok")}`]) {
      const res = await get(app, q);
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("cwd_required");
    }
    expect(admitSpy).not.toHaveBeenCalled();
    expect(flowReads()).toEqual([]);
    await app.close();
  });

  it("unadmitted cwd → 403 and 0 flow-file reads", async () => {
    const app = await appWith();
    const res = await get(app, `cwd=${enc(U)}&flow=${enc("ns:ok")}`);
    expect(res.statusCode).toBe(403);
    expect(flowReads()).toEqual([]);
    await app.close();
  });

  it("admitted cwd → 200 with the declared inputs", async () => {
    const app = await appWith();
    const res = await get(app, `cwd=${enc(R)}&flow=${enc("ns:ok")}`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ inputs: [{ name: "a", type: "string", required: false }] });
    await app.close();
  });

  it("indeterminate admission → 503 cwd-admission-unavailable with Retry-After, 0 reads", async () => {
    const app = await appWith({ realpath: async () => ({ kind: "error", code: "EACCES" }) });
    const res = await get(app, `cwd=${enc(R)}&flow=${enc("ns:ok")}`);
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: "cwd-admission-unavailable", retryAfterMs: 1000 });
    expect(res.headers["retry-after"]).toBe("1");
    expect(flowReads()).toEqual([]);
    await app.close();
  });
});

describe("SE39 — a non-string cwd is invalid_cwd", () => {
  it("a repeated ?cwd= (array) → 400 invalid_cwd, admission never called, 0 reads", async () => {
    const app = await appWith();
    const res = await get(app, `cwd=a&cwd=b&flow=${enc("ns:ok")}`);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_cwd");
    expect(admitSpy).not.toHaveBeenCalled();
    expect(flowReads()).toEqual([]);
    await app.close();
  });
});

describe("SP3 — every admission token is released, no request is left pending", () => {
  it("500 mixed admit / refuse / indeterminate requests", async () => {
    const missing = path.join(os.tmpdir(), "flowin-does-not-exist-sp3");
    const flaky = mkTmp("flowin-flaky-");
    const tokens: guard.AdmissionToken[] = [];
    admitSpy.mockImplementation(async (...args) => {
      const result = await realAdmitCwd(...args);
      if (result.kind === "admit") tokens.push(result.token);
      return result;
    });
    const app = await appWith({ realpath: async (p) => (p === flaky ? { kind: "error", code: "EACCES" } : realpathAsync(p)) });
    const cwds = [R, missing, flaky] as const;
    const expected = { [R]: 200, [missing]: 403, [flaky]: 503 } as Record<string, number>;
    const jobs = Array.from({ length: 500 }, (_, i) => cwds[i % 3]!);
    const statuses: number[] = [];
    for (let i = 0; i < jobs.length; i += 50) {
      const settled = await Promise.allSettled(jobs.slice(i, i + 50).map(async (cwd) => (await get(app, `cwd=${enc(cwd)}&flow=${enc("ns:ok")}`)).statusCode));
      for (const r of settled) {
        expect(r.status).toBe("fulfilled");
        if (r.status === "fulfilled") statuses.push(r.value);
      }
    }
    await app.close();
    expect(statuses).toEqual(jobs.map((c) => expected[c]));
    expect(tokens.length).toBe(jobs.filter((c) => c === R).length);
    expect(tokens.filter((t) => guard.isAdmissionLive(t))).toEqual([]);
    fs.rmSync(flaky, { recursive: true, force: true });
  }, 60_000);
});

describe("SX4 — admission runner failure → 503 with Retry-After, recovery admits", () => {
  const failingRunner: GitProbeRunner = async () => ({ ok: false, error: { kind: "spawn-failure", message: "EAGAIN" } });
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", ["-c", "user.email=t@t.com", "-c", "user.name=T", ...args], { cwd, stdio: ["ignore", "pipe", "pipe"] });

  it("503 cwd-admission-unavailable, 0 flow-file reads, then the next request is admitted", async () => {
    git(R, "init", "-q");
    git(R, "commit", "--allow-empty", "-q", "-m", "init");
    const W = path.join(mkTmp("flowin-wt-parent-"), "wt");
    git(R, "worktree", "add", "-q", "-b", "sx4", W);
    writeFlow(W, "ns", "ok");
    const admitOptions: NonNullable<NonNullable<Parameters<typeof mountFlowInputsRoute>[1]>["admitOptions"]> = { runner: failingRunner };
    const app = await appWith(admitOptions);
    readSpy.mockClear();
    const res = await get(app, `cwd=${enc(W)}&flow=${enc("ns:ok")}`);
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: "cwd-admission-unavailable", retryAfterMs: 1000 });
    expect(res.headers["retry-after"]).toBe("1");
    expect(flowReads()).toEqual([]);

    delete admitOptions.runner; // recovery
    const ok = await get(app, `cwd=${enc(W)}&flow=${enc("ns:ok")}`);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().inputs).toHaveLength(1);
    await app.close();
    fs.rmSync(path.dirname(W), { recursive: true, force: true });
  });
});
