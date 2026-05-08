/**
 * Shared mutable state for bridge modules.
 * Avoids passing 14+ closure variables to every extracted function.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ConnectionManager } from "./connection.js";

export interface BridgeContext {
  pi: ExtensionAPI;
  connection: ConnectionManager;
  /** Current session ID (mutated on session change: new/fork/resume) */
  sessionId: string;
  cachedCtx: any;
  cachedModelRegistry: any;
  cachedHasUI: boolean | undefined;
  lastModel: string | undefined;
  lastThinkingLevel: string | undefined;
  lastSessionFile: string | undefined;
  lastSessionDir: string | undefined;
  lastFirstMessage: string | undefined;
  lastGitBranch: string | undefined;
  lastGitPrNumber: number | undefined;
  lastSessionName: string | undefined;
  /**
   * `false` until the very first `sendStateSync` after the bridge
   * process boots; `true` for the rest of the process lifetime.
   * Drives `registerReason` on `session_register` so the server can
   * distinguish initial spawn vs. dashboard-restart reattach.
   * `handleSessionChange` (new/fork/resume) ignores this flag and
   * always tags `"spawn"` because it mints a fresh sessionId.
   * See change: reattach-move-to-front.
   */
  hasRegisteredOnce: boolean;
}

// Commands that the dashboard handles natively with superior UX, filtered from
// the command list sent to dashboard clients AND from extension-slash detection.
// Current set: { "roles" }. Bridge-registered `__dashboard_reload` is filtered
// separately by the `__`-prefix rule. See change: fix-extension-slash-commands-in-dashboard.
export const DASHBOARD_NATIVE_COMMANDS = new Set(["roles"]);

/** Filter out hidden commands (names starting with __) and dashboard-native commands from commands list */
export function filterHiddenCommands(commands: any[]): any[] {
  return commands.filter((cmd) =>
    !cmd.name.startsWith("__") &&
    !DASHBOARD_NATIVE_COMMANDS.has(cmd.name)
  );
}

/**
 * Pure predicate: does `text` name an extension-registered slash command?
 *
 * Returns true iff:
 *   - `text` starts with `/` and contains no embedded newline
 *   - the token after `/` (up to first space or end) appears in `commandList`
 *     with `source === "extension"`
 *   - that token is NOT in `DASHBOARD_NATIVE_COMMANDS` (and not `__`-prefixed)
 *
 * Pure: no pi calls, no mutation. See change: fix-extension-slash-commands-in-dashboard.
 */
export function isExtensionSlashCommand(
  text: string,
  commandList: ReadonlyArray<{ name: string; source?: string }>,
): boolean {
  if (typeof text !== "string" || !text.startsWith("/")) return false;
  if (text.includes("\n")) return false;
  const rest = text.slice(1);
  const spaceIdx = rest.indexOf(" ");
  const cmdName = spaceIdx === -1 ? rest : rest.slice(0, spaceIdx);
  if (!cmdName) return false;
  if (cmdName.startsWith("__")) return false;
  if (DASHBOARD_NATIVE_COMMANDS.has(cmdName)) return false;
  return commandList.some((c) => c?.name === cmdName && c?.source === "extension");
}

/**
 * Feature-detect upstream `pi.dispatchCommand(text, opts)` (pi 0.71+).
 * Returns true iff the field is a function on the supplied object.
 * See change: fix-extension-slash-commands-in-dashboard.
 */
export function hasDispatchCommand(pi: unknown): boolean {
  return typeof (pi as any)?.dispatchCommand === "function";
}

/** Extract first user message text from session entries */
export function extractFirstMessage(ctx: any): string | undefined {
  try {
    const entries = ctx?.sessionManager?.getEntries?.();
    if (!entries || !Array.isArray(entries)) return undefined;
    for (const entry of entries) {
      if (entry.role === "user" && typeof entry.content === "string") {
        return entry.content.slice(0, 200);
      }
      if (entry.role === "user" && Array.isArray(entry.content)) {
        for (const part of entry.content) {
          if (part.type === "text" && typeof part.text === "string") {
            return part.text.slice(0, 200);
          }
        }
      }
    }
  } catch { /* ignore */ }
  return undefined;
}

/** Get current model string (provider/id) from cached context */
export function getCurrentModelString(bc: BridgeContext): string | undefined {
  const model = bc.cachedCtx?.model;
  if (!model) return undefined;
  return `${model.provider}/${model.id}`;
}
