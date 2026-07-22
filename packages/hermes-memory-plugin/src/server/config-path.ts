/**
 * Resolve the hermes config file path identically to the `pi-hermes-memory`
 * extension's `resolveAgentRoot()` (design D2). The filename is FIXED and never
 * taken from request input — eliminating path-traversal surface.
 *
 * SOURCE-VERSION PIN: mirrored from `pi-hermes-memory@0.8.1` src/paths.ts
 * (`resolveAgentRoot`, `expandHome`).
 *
 * See change: add-hermes-memory-settings-plugin.
 */
import * as os from "node:os";
import * as path from "node:path";

/** The fixed config filename. Never sourced from user input. */
export const HERMES_CONFIG_FILENAME = "hermes-memory-config.json";

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

/** Resolve the absolute hermes config file path (agent root + fixed filename). */
export function resolveHermesConfigPath(env: Record<string, string | undefined> = process.env): string {
  return path.join(resolveAgentRoot(env), HERMES_CONFIG_FILENAME);
}
