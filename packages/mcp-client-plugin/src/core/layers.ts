/**
 * mcp-client-plugin · CORE layer paths + strict-JSON layer reads.
 *
 * pi's built-in MCP reads exactly two files: `<agentDir>/mcp.json`
 * (`PI_CODING_AGENT_DIR`, else `~/.pi/agent`) and, for a trusted project,
 * `<cwd>/.pi/mcp.json`. Both are parsed with strict `JSON.parse`; a file with
 * comments or trailing commas is reported and skipped whole. This module reads
 * them the same way, so the dashboard never shows (or writes over) a file pi
 * would skip.
 *
 * See change: migrate-mcp-to-pi-builtin (D3 "Reads").
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { isPlainObject } from "./path-utils.js";
import type { ConfigIO } from "./types.js";

export interface LayerPaths {
  globalPath(): string;
  projectPath(cwd: string): string;
}

/** The Pi agent dir, resolved per call so a changed env is honoured. */
export function piAgentDir(env: NodeJS.ProcessEnv = process.env): string {
  const dir = env.PI_CODING_AGENT_DIR;
  return dir && dir.length > 0 ? dir : join(homedir(), ".pi", "agent");
}

export function defaultLayerPaths(): LayerPaths {
  return {
    globalPath: () => join(piAgentDir(), "mcp.json"),
    projectPath: (cwd) => join(cwd, ".pi", "mcp.json"),
  };
}

/** A null-prototype shallow copy, so a `__proto__` own key can never pollute. */
export function nullProto<T extends object>(obj: T): T {
  return Object.assign(Object.create(null), obj) as T;
}

export type LayerRead =
  | { ok: true; path: string; exists: boolean; config: Record<string, unknown>; servers: Record<string, unknown> }
  | { ok: false; path: string; exists: true; message: string };

/** Read + strictly parse one layer. A missing file reads as an empty config. */
export function readLayer(io: ConfigIO, path: string): LayerRead {
  const raw = io.readFile(path);
  if (raw === null) return { ok: true, path, exists: false, config: nullProto({}), servers: nullProto({}) };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { ok: false, path, exists: true, message: `${path}: ${(e as Error).message}` };
  }
  if (!isPlainObject(parsed) || (parsed.mcpServers !== undefined && !isPlainObject(parsed.mcpServers))) {
    return { ok: false, path, exists: true, message: `${path}: expected an object with an "mcpServers" object` };
  }
  const servers = isPlainObject(parsed.mcpServers) ? nullProto(parsed.mcpServers) : nullProto({});
  return { ok: true, path, exists: true, config: nullProto(parsed), servers };
}
