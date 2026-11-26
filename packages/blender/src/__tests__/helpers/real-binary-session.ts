/**
 * Shared session plumbing for the real-binary tests: tmp bookkeeping, server lifecycle (`boot`,
 * `closeServer`), the `ok` assertion, `scene`/`reset` calls and `rssBytes`. Imported by
 * `real-binary.test.ts` and its budget-lane file `real-binary.budget.test.ts`. The `afterAll` cleanup
 * registers in whichever test file imports this module.
 *
 * See change: stabilize-blocking-test-lanes.
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll } from "vitest";
import { type McpClient, startServer, type ToolResultJson } from "./mcp-client.js";

const tmpDirs: string[] = [];
export function tmpDir(prefix = "pi-blender-real-"): string {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tmpDirs.push(d);
  return d;
}
export const servers: McpClient[] = [];

export interface Session {
  ws: string;
  c: McpClient;
}

/** A real server whose cwd (= project root) is a fresh tmp workspace. */
export function boot(env: NodeJS.ProcessEnv = {}): Session {
  const ws = tmpDir("pi-blender-ws-");
  const c = startServer({ cwd: ws, env });
  servers.push(c);
  return { ws, c };
}

export async function closeServer(c: McpClient): Promise<void> {
  c.child.stdin?.end();
  const timer = setTimeout(() => c.child.kill("SIGKILL"), 15_000);
  await c.exited;
  clearTimeout(timer);
}

afterAll(async () => {
  await Promise.all(servers.splice(0).map(closeServer));
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

export const scene = (s: Session, args: Record<string, unknown> = {}): Promise<ToolResultJson> => s.c.call("blender_scene", args);
export const reset = (s: Session, mode: "factory" | "empty" = "factory"): Promise<ToolResultJson> => s.c.call("blender_reset", { mode });

/** Fail with the tool's own message when a call was not a success. */
export function ok(r: ToolResultJson): ToolResultJson {
  if (r.isError) throw new Error(`tool error: ${JSON.stringify(r.data)}${r.output ? `\n${r.output}` : ""}`);
  return r;
}

/** Resident set size of `pid` in bytes (`ps` on POSIX, `tasklist` on Windows). */
export function rssBytes(pid: number): number {
  if (process.platform === "win32") {
    const out = execFileSync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], { encoding: "utf8" });
    const cells = out.trim().split('","');
    const kb = Number((cells[cells.length - 1] ?? "").replace(/[^0-9]/g, ""));
    return kb * 1024;
  }
  return Number(execFileSync("ps", ["-o", "rss=", "-p", String(pid)], { encoding: "utf8" }).trim()) * 1024;
}
