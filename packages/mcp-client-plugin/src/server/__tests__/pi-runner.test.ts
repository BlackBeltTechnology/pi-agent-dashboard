/**
 * Default `pi mcp list --json` runner against a REAL child process
 * (migrate-mcp-to-pi-builtin D3 "Live state"): stdout + exit code are returned
 * whatever the code, and an abort kills the child (and its process group).
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolResolver } from "@blackbelt-technology/pi-dashboard-shared/platform/binary-lookup.js";
import { afterEach, describe, expect, it } from "vitest";
import { createPiMcpListRunner } from "../pi-runner.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function fakePi(body: string): ToolResolver {
  const dir = mkdtempSync(join(tmpdir(), "pi-runner-"));
  dirs.push(dir);
  const script = join(dir, "fake-pi.mjs");
  writeFileSync(script, body);
  return { resolvePi: () => [process.execPath, script] } as unknown as ToolResolver;
}

describe("createPiMcpListRunner", () => {
  it("returns stdout and a non-zero exit code without rejecting; passes the mcp list --json argv", async () => {
    const runner = createPiMcpListRunner(
      fakePi(`process.stdout.write(JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() })); process.exit(1);`),
    );
    const cwd = mkdtempSync(join(tmpdir(), "pi-runner-cwd-"));
    dirs.push(cwd);
    const r = await runner(cwd, new AbortController().signal);
    expect(r.code).toBe(1);
    const out = JSON.parse(r.stdout) as { argv: string[]; cwd: string };
    expect(out.argv).toEqual(["mcp", "list", "--json"]);
    expect(out.cwd.endsWith(cwd.split("/").pop() as string)).toBe(true);
  });

  it("an abort kills a hanging child promptly", async () => {
    const runner = createPiMcpListRunner(fakePi(`setInterval(() => {}, 1000);`));
    const controller = new AbortController();
    const started = Date.now();
    const pending = runner(tmpdir(), controller.signal);
    setTimeout(() => controller.abort(), 200);
    const r = await pending;
    expect(Date.now() - started).toBeLessThan(5000);
    expect(r.stdout).toBe("");
  });

  it("rejects when pi cannot be resolved", async () => {
    const runner = createPiMcpListRunner({ resolvePi: () => null } as unknown as ToolResolver);
    await expect(runner(tmpdir(), new AbortController().signal)).rejects.toThrow(/pi executable not found/);
  });
});
