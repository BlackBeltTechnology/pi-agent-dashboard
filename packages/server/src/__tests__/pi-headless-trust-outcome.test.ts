/**
 * Pins pi's headless `project_trust` outcome with the INSTALLED pi (harden-agent-tool-guards
 * task 3.3, test-plan #E92). With the bridge left undecided (no extension answers) an RPC
 * process (no UI) resolves a `.pi/`-bearing folder through `trust.json`, then
 * `defaultProjectTrust`: `ask` and `never` skip project resources (no prompt, no stall),
 * `always` loads them. D3 relies on this: an uncovered dashboard spawn is NOT auto-trusted.
 * Skipped with a clear message when pi cannot be located.
 *
 * Also pins two more premises of the same change against the INSTALLED pi (test-plan #E105/#E107/#X21):
 *  - a project SKILL follows the same trust outcome as a project extension: absent under `ask`, present
 *    under `always`, absent again once the trust is withdrawn, and the session answers RPC every time
 *    (the "skill absent, present, absent; ready every time" observable of T.107, at the real-pi level);
 *  - a MISTYPED `-e` extension ref (the shape of a mistyped chat-gateway `guardExtension`) makes pi exit at
 *    startup with "Failed to load extension" and never answer RPC, so such a session can never register or
 *    announce guard readiness (the premise of T.105/T.129; the gateway's refuse-and-send-nothing half is
 *    pinned at L1 by `gateway-guard-ready.test.ts` T.41/T.123);
 *  - pi runs the `session_start` handler of a `-e` extension (the chat-gateway guard) BEFORE that of an
 *    extension registered through settings (the dashboard bridge). The bridge only listens for
 *    `dashboard:plugin-message` inside its own `session_start`, so a single readiness emit from the guard
 *    is lost; the guard therefore re-announces on a schedule (found by the L3 spec
 *    `chat-gateway-guard-readiness.spec.ts`).
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

function findPiCli(): string | null {
  for (const root of createRequire(import.meta.url).resolve.paths("@earendil-works/pi-coding-agent") ?? []) {
    const cli = path.join(root, "@earendil-works", "pi-coding-agent", "dist", "cli.js");
    if (fs.existsSync(cli)) return cli;
  }
  return null;
}

const cli = findPiCli();
if (!cli) console.warn("[pi-headless-trust-outcome] installed pi not found: skipping (task 3.3)");

let tmp: string;
beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-headless-trust-"));
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

/**
 * Start pi in RPC mode and probe `get_state`. Returns whether the project extension loaded (marker),
 * how long that took, and whether the RPC server ANSWERED (a stalled or crashed start must fail the
 * negative cases instead of passing them vacuously). Resolves once the marker appears, or after the
 * RPC answered and `settleMs` more elapsed without a marker.
 */
async function runPi(
  mode: "ask" | "never" | "always",
  waitMs: number,
  settleMs: number,
): Promise<{ loadedAfter: number | null; rpcAnswered: boolean; exitedEarly: boolean }> {
  const agentDir = path.join(tmp, `agent-${mode}`);
  const proj = path.join(tmp, `proj-${mode}`);
  const marker = path.join(tmp, `marker-${mode}`);
  fs.mkdirSync(agentDir, { recursive: true });
  fs.mkdirSync(path.join(proj, ".pi", "extensions"), { recursive: true });
  fs.writeFileSync(path.join(agentDir, "settings.json"), JSON.stringify({ defaultProjectTrust: mode }));
  fs.writeFileSync(
    path.join(proj, ".pi", "extensions", "x.ts"),
    `import * as fs from "node:fs";\nexport default function () { fs.writeFileSync(${JSON.stringify(marker)}, "loaded"); }\n`,
  );
  const child = spawn(process.execPath, [cli as string, "--mode", "rpc", "--no-session"], {
    cwd: proj,
    env: { ...process.env, HOME: tmp, PI_CODING_AGENT_DIR: agentDir },
    stdio: ["pipe", "pipe", "ignore"],
  });
  let out = "";
  let exited = false;
  child.stdout.on("data", (d) => {
    out += String(d);
  });
  child.on("exit", () => {
    exited = true;
  });
  child.stdin.write(`${JSON.stringify({ id: "probe", type: "get_state" })}\n`);
  const t0 = Date.now();
  let answeredAt: number | null = null;
  try {
    while (Date.now() - t0 < waitMs) {
      if (fs.existsSync(marker)) return { loadedAfter: Date.now() - t0, rpcAnswered: out.includes('"probe"'), exitedEarly: false };
      if (answeredAt === null && out.includes('"probe"')) answeredAt = Date.now();
      if (answeredAt !== null && Date.now() - answeredAt >= settleMs) break;
      if (exited) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    return { loadedAfter: null, rpcAnswered: out.includes('"probe"'), exitedEarly: exited && answeredAt === null };
  } finally {
    child.kill("SIGKILL");
  }
}

describe.skipIf(!cli)("pi headless project_trust with no extension answer (installed pi)", () => {
  it("`always` loads project resources; `ask` and `never` start (RPC answers) and skip them without a prompt or stall", async () => {
    const always = await runPi("always", 20_000, 0);
    expect(always.loadedAfter, "defaultProjectTrust:always must load the project extension").not.toBeNull();
    for (const mode of ["ask", "never"] as const) {
      const r = await runPi(mode, 30_000, 2_000);
      expect(r.exitedEarly, `${mode}: pi exited before answering RPC`).toBe(false);
      expect(r.rpcAnswered, `${mode}: pi must reach RPC readiness (no trust prompt, no stall)`).toBe(true);
      expect(r.loadedAfter, `${mode}: the project extension must stay unloaded`).toBeNull();
    }
  }, 60_000);
});

interface RpcProbe {
  out: string;
  err: string;
  exited: boolean;
  code: number | null;
}

/**
 * Run the installed pi in RPC mode in `proj` under `defaultProjectTrust: mode`, send `requests` (each with an
 * `id`), and resolve once every id has answered, pi exited, or `waitMs` passed. Always kills the child.
 */
async function rpcProbe(
  mode: "ask" | "never" | "always",
  proj: string,
  requests: Array<{ id: string; type: string }>,
  extraArgs: string[] = [],
  waitMs = 30_000,
  /** Keep the process alive until this also holds (e.g. a side effect of a handler that runs after the RPC answer). */
  alsoUntil: () => boolean = () => true,
): Promise<RpcProbe> {
  const agentDir = path.join(tmp, `agent-probe-${mode}`);
  fs.mkdirSync(agentDir, { recursive: true });
  const settingsPath = path.join(agentDir, "settings.json");
  const existing = fs.existsSync(settingsPath) ? (JSON.parse(fs.readFileSync(settingsPath, "utf8")) as Record<string, unknown>) : {};
  fs.writeFileSync(settingsPath, JSON.stringify({ ...existing, defaultProjectTrust: mode }));
  const child = spawn(process.execPath, [cli as string, "--mode", "rpc", "--no-session", ...extraArgs], {
    cwd: proj,
    env: { ...process.env, HOME: tmp, PI_CODING_AGENT_DIR: agentDir },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const r: RpcProbe = { out: "", err: "", exited: false, code: null };
  child.stdout.on("data", (d) => {
    r.out += String(d);
  });
  child.stderr.on("data", (d) => {
    r.err += String(d);
  });
  child.on("exit", (code) => {
    r.exited = true;
    r.code = code;
  });
  child.stdin.on("error", () => undefined); // pi may already be gone when we write
  for (const q of requests) child.stdin.write(`${JSON.stringify(q)}\n`);
  const t0 = Date.now();
  try {
    while (Date.now() - t0 < waitMs) {
      if (requests.every((q) => r.out.includes(`"id":"${q.id}"`)) && alsoUntil()) break;
      if (r.exited) break;
      await new Promise((res) => setTimeout(res, 100));
    }
    return r;
  } finally {
    child.kill("SIGKILL");
  }
}

describe.skipIf(!cli)("project skill follows the trust outcome; a mistyped extension ref never starts (installed pi)", () => {
  const SKILL = "probe-skill";
  const answered = (r: RpcProbe, id: string): boolean => r.out.includes(`"id":"${id}"`) && r.out.includes('"success":true');
  const listsSkill = (r: RpcProbe): boolean => r.out.includes(`skill:${SKILL}`);

  it("T.107: skill absent (ask), present (always), absent again (ask); RPC answers every time", async () => {
    const proj = path.join(tmp, "proj-skill");
    fs.mkdirSync(path.join(proj, ".pi", "skills", "s"), { recursive: true });
    fs.writeFileSync(
      path.join(proj, ".pi", "skills", "s", "SKILL.md"),
      `---\nname: ${SKILL}\ndescription: project skill used to observe the trust outcome\n---\n# ${SKILL}\n`,
    );
    const asks = [{ id: "state", type: "get_state" }, { id: "cmds", type: "get_commands" }];
    const legs: Array<["ask" | "always" | "ask", boolean, string]> = [
      ["ask", false, "unpinned: no dashboard trust"],
      ["always", true, "pinned: trust covers the folder"],
      ["ask", false, "unpinned again: no stale trust"],
    ];
    for (const [mode, expectSkill, label] of legs) {
      const r = await rpcProbe(mode, proj, asks);
      expect(answered(r, "state") && answered(r, "cmds"), `${label}: the session must reach RPC readiness (stderr: ${r.err.slice(0, 200)})`).toBe(true);
      expect(listsSkill(r), `${label}: project skill ${expectSkill ? "must be" : "must NOT be"} loaded`).toBe(expectSkill);
    }
  }, 120_000);

  it("T.105/T.129 premise: a mistyped extension ref makes pi exit at startup and never answer RPC", async () => {
    const proj = path.join(tmp, "proj-bad-guard");
    fs.mkdirSync(proj, { recursive: true });
    const typo = path.join(tmp, "no-such-dir", "chat-gateway-guard-typo.ts");
    const r = await rpcProbe("always", proj, [{ id: "state", type: "get_state" }], ["-e", typo], 25_000);
    expect(r.exited, "pi must exit, not sit there unguarded").toBe(true);
    expect(r.code, "a failed extension load is a non-zero exit").not.toBe(0);
    expect(r.err, "the failure names the extension").toContain("Failed to load extension");
    expect(r.out.includes('"id":"state"'), "no RPC answer: no session can register or announce readiness").toBe(false);
  }, 40_000);

  it("a `-e` extension's session_start runs BEFORE a settings-registered extension's (why a one-shot readiness emit is lost)", async () => {
    const proj = path.join(tmp, "proj-order");
    const extDir = path.join(tmp, "ext-order");
    const log = path.join(tmp, "order.log");
    fs.mkdirSync(proj, { recursive: true });
    fs.mkdirSync(extDir, { recursive: true });
    for (const name of ["bridge", "guard"]) {
      fs.writeFileSync(
        path.join(extDir, `${name}.ts`),
        `import * as fs from "node:fs";\nexport default function (pi: any) {\n  pi.on("session_start", async () => { fs.appendFileSync(${JSON.stringify(log)}, "${name}\\n"); });\n}\n`,
      );
    }
    const agentDir = path.join(tmp, "agent-probe-always");
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(
      path.join(agentDir, "settings.json"),
      JSON.stringify({ defaultProjectTrust: "always", extensions: [path.join(extDir, "bridge.ts")] }),
    );
    const r = await rpcProbe("always", proj, [{ id: "state", type: "get_state" }], ["-e", path.join(extDir, "guard.ts")], 30_000, () =>
      fs.existsSync(log) && fs.readFileSync(log, "utf8").trim().split("\n").length >= 2,
    );
    expect(answered(r, "state"), `pi must start (stderr: ${r.err.slice(0, 200)})`).toBe(true);
    expect(fs.readFileSync(log, "utf8").trim().split("\n")).toEqual(["guard", "bridge"]);
  }, 60_000);
});

