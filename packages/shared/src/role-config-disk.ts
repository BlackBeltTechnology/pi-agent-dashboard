/**
 * Node-only: read the role slice of `~/.pi/agent/providers.json`.
 * Split from `role-schema.ts` because that module is bundled by the client and
 * MUST NOT import `node:*`. TOTAL: missing/garbled file → empty RoleConfig.
 *
 * See change: add-role-aware-model-refs.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseRoleConfig, type RoleConfig } from "./role-schema.js";

export function providersJsonPath(homeDir: string = os.homedir()): string {
  return path.join(homeDir, ".pi", "agent", "providers.json");
}

export function readRoleConfigFromDisk(homeDir?: string): RoleConfig {
  try {
    return parseRoleConfig(JSON.parse(fs.readFileSync(providersJsonPath(homeDir), "utf-8")));
  } catch {
    return parseRoleConfig(undefined);
  }
}
