/**
 * Resolve the blackhole config file path identically to the extension's own
 * agent-directory resolution (`src/core/unified-config.ts` `getAgentDir()`,
 * which reads `PI_CODING_AGENT_DIR` and otherwise defers to pi's `getAgentDir`).
 * The directory and filename are FIXED constants, never taken from request
 * input — there is no path-traversal surface.
 *
 * SOURCE-VERSION PIN: mirrored from `pi-blackhole@0.4.5`
 * `src/core/unified-config.ts` (`CONFIG_DIR`, `CONFIG_FILE`, `getAgentDir`).
 *
 * See change: add-blackhole-plugin.
 */
import * as os from "node:os";
import * as path from "node:path";

/** The fixed config subdirectory. Never sourced from user input. */
export const BLACKHOLE_CONFIG_DIR = "pi-blackhole";
/** The fixed config filename. Never sourced from user input. */
export const BLACKHOLE_CONFIG_FILENAME = "pi-blackhole-config.json";

/** Expand a leading `~` / `~/` / `~\` to the home directory. */
function expandHome(input: string): string {
  if (input === "~") return os.homedir();
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input;
}

/**
 * Resolve the agent root: `PI_CODING_AGENT_DIR` (trimmed, `~`-expanded,
 * resolved) when set, else `<home>/.pi/agent`.
 */
export function resolveAgentRoot(env: Record<string, string | undefined> = process.env): string {
  const configured = env.PI_CODING_AGENT_DIR?.trim();
  return configured ? path.resolve(expandHome(configured)) : path.join(os.homedir(), ".pi", "agent");
}

/** Resolve the absolute blackhole config path (agent root + fixed dir + file). */
export function resolveBlackholeConfigPath(
  env: Record<string, string | undefined> = process.env,
): string {
  return path.join(resolveAgentRoot(env), BLACKHOLE_CONFIG_DIR, BLACKHOLE_CONFIG_FILENAME);
}
