/**
 * Pins pi's headless `project_trust` outcome with the INSTALLED pi (harden-agent-tool-guards
 * task 3.3, test-plan #E92). With the bridge left undecided (no extension answers) an RPC
 * process (no UI) resolves a `.pi/`-bearing folder through `trust.json`, then
 * `defaultProjectTrust`: `ask` and `never` skip project resources (no prompt, no stall),
 * `always` loads them. D3 relies on this: an uncovered dashboard spawn is NOT auto-trusted.
 * Skipped with a clear message when pi cannot be located.
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
