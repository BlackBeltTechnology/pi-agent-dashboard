/**
 * Filesystem locations. Resolved per call from `os.homedir()` so tests that
 * swap HOME per file see their own tree. See change: add-system-one-registry.
 */
import { homedir } from "node:os";
import { join } from "node:path";

export const agentDir = (): string => join(homedir(), ".pi", "agent");
export const userConfigPath = (): string => join(agentDir(), "system-one.json");
export const projectConfigPath = (cwd: string): string => join(cwd, ".pi", "system-one.json");
export const stateDir = (): string => join(agentDir(), "system-one");
export const consumersDir = (): string => join(stateDir(), "consumers");
export const decisionsDir = (): string => join(stateDir(), "decisions");
export const authPath = (): string => join(stateDir(), "auth.json");
