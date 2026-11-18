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

/** Start pi in RPC mode; resolves when the marker appears or `waitMs` elapses. Returns ms until loaded, or null. */
async function loadsProjectExtension(mode: "ask" | "never" | "always", waitMs: number): Promise<number | null> {
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
    stdio: ["pipe", "ignore", "ignore"],
  });
  const t0 = Date.now();
  try {
    while (Date.now() - t0 < waitMs) {
      if (fs.existsSync(marker)) return Date.now() - t0;
      await new Promise((r) => setTimeout(r, 100));
    }
    return null;
  } finally {
    child.kill("SIGKILL");
  }
}

describe.skipIf(!cli)("pi headless project_trust with no extension answer (installed pi)", () => {
  it("`always` loads project resources; `ask` and `never` skip them without a prompt or stall", async () => {
    const loadedAfter = await loadsProjectExtension("always", 20_000);
    expect(loadedAfter, "defaultProjectTrust:always must load the project extension").not.toBeNull();
    // A startup that took `loadedAfter` ms for the positive case bounds the negative waits.
    const wait = Math.max(3_000, (loadedAfter ?? 0) * 2);
    expect(await loadsProjectExtension("ask", wait)).toBeNull();
    expect(await loadsProjectExtension("never", wait)).toBeNull();
  }, 60_000);
});
