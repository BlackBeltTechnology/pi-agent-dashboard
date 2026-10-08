/**
 * mcp-client-plugin · default `pi mcp list --json` runner (server only).
 *
 * Resolves pi through the shared `ToolResolver` (managed / registry / PATH),
 * spawns through the shared `windowsHide` spawn wrapper (never a shell),
 * inherits the server env (so `PI_CODING_AGENT_DIR` matches the files the
 * dashboard reads), forces `ELECTRON_RUN_AS_NODE` when pi is node-wrapped on
 * the Electron execPath, and kills the child's whole process TREE (pi plus
 * the stdio MCP servers it started) when the core's 30 s deadline aborts. The exit code is returned, never thrown: pi exits 1 whenever a
 * server is disconnected or an entry is invalid.
 *
 * See change: migrate-mcp-to-pi-builtin (D3 "Live state").
 */

import { ToolResolver } from "@blackbelt-technology/pi-dashboard-shared/platform/binary-lookup.js";
import { spawn } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import { killPidWithGroup, killProcess } from "@blackbelt-technology/pi-dashboard-shared/platform/process.js";
import { buildSpawnEnvForArgv } from "@blackbelt-technology/pi-dashboard-shared/platform/runner.js";
import type { PiMcpListRunner } from "../core/types.js";

/** stdout cap — a list of servers is small; anything larger is not pi's JSON. */
const MAX_STDOUT_BYTES = 4 * 1024 * 1024;

export function createPiMcpListRunner(resolver = new ToolResolver({ processExecPath: process.execPath, useLoginShell: false })): PiMcpListRunner {
  return (cwd, signal) =>
    new Promise((resolve, reject) => {
      const argv = resolver.resolvePi();
      if (!argv || argv.length === 0) {
        reject(new Error("pi executable not found"));
        return;
      }
      const [cmd, ...prefix] = argv;
      const env = buildSpawnEnvForArgv(cmd) ?? process.env;
      // Own process group (POSIX), so the kill reaches the stdio MCP servers
      // pi started — killing pi alone would orphan them.
      const child = spawn(cmd, [...prefix, "mcp", "list", "--json"], {
        cwd,
        env,
        stdio: ["ignore", "pipe", "ignore"],
        detached: true,
      });
      const chunks: Buffer[] = [];
      let size = 0;
      let killed = false;
      const kill = (): void => {
        const pid = child.pid;
        if (killed || pid === undefined) return;
        killed = true;
        // Shared platform primitives: group SIGKILL on POSIX; `taskkill /T`
        // tree kill on Windows (killProcess). No platform branch here.
        try {
          killPidWithGroup(pid, "SIGKILL");
        } catch {
          /* already gone */
        }
        void killProcess(pid, { timeoutMs: 0 }).catch(() => undefined);
      };
      signal.addEventListener("abort", kill, { once: true });
      child.stdout?.on("data", (b: Buffer) => {
        size += b.length;
        if (size > MAX_STDOUT_BYTES) kill();
        else chunks.push(b);
      });
      child.once("error", (e) => {
        signal.removeEventListener("abort", kill);
        reject(e);
      });
      child.once("close", (code) => {
        signal.removeEventListener("abort", kill);
        resolve({ stdout: Buffer.concat(chunks).toString("utf8"), code });
      });
    });
}
