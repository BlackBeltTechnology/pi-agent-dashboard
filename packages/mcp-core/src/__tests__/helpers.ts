/**
 * Hermetic fixtures for the core tests: an in-memory ConfigIO and fixed
 * layer paths (`/agent/mcp.json`, `<cwd>/.pi/mcp.json`).
 */

import type { LayerPaths } from "../layers.js";
import { createMcpClientConfigService, type McpClientConfigServiceDeps } from "../service.js";
import type { ConfigIO } from "../types.js";

export const GLOBAL = "/agent/mcp.json";
export const CWD = "/work/proj";
export const PROJECT = `${CWD}/.pi/mcp.json`;

const PATHS: LayerPaths = {
  globalPath: () => GLOBAL,
  projectPath: (cwd) => `${cwd}/.pi/mcp.json`,
};

export type MemIO = ConfigIO & { files: Map<string, string>; writes: string[] };

export function makeIO(initial: Record<string, unknown> = {}): MemIO {
  const files = new Map<string, string>(
    Object.entries(initial).map(([p, v]) => [p, typeof v === "string" ? v : `${JSON.stringify(v, null, 2)}\n`]),
  );
  const writes: string[] = [];
  return {
    files,
    writes,
    readFile: (p) => files.get(p) ?? null,
    writeFileAtomic: (p, content) => {
      writes.push(p);
      files.set(p, content);
    },
  };
}

export function json(io: MemIO, path: string): Record<string, any> {
  return JSON.parse(io.files.get(path) as string);
}

export function makeService(io: MemIO, deps: Partial<McpClientConfigServiceDeps> = {}) {
  return createMcpClientConfigService({
    configIO: io,
    paths: PATHS,
    knownCwds: () => [CWD],
    isProjectTrusted: () => true,
    scratchCwd: "/scratch-empty",
    ...deps,
  });
}
