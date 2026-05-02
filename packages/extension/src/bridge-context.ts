/**
 * Shared mutable state for bridge modules.
 * Avoids passing 14+ closure variables to every extracted function.
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
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
  /**
   * Last serialized `JjState` snapshot sent to the server, or `null`
   * when the previous probe explicitly cleared it. Compared on every
   * probe tick so we only send `jj_state_update` when the value actually
   * changes. See change: add-jj-workspace-plugin.
   */
  lastJjStateJson: string | undefined;
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

// Commands that the dashboard handles natively with superior UX.
// These are filtered from the command list sent to dashboard clients.
const DASHBOARD_NATIVE_COMMANDS = new Set(["roles"]);

/** Filter out hidden commands (names starting with __) and dashboard-native commands from commands list */
export function filterHiddenCommands(commands: any[]): any[] {
  return commands.filter((cmd) =>
    !cmd.name.startsWith("__") &&
    !DASHBOARD_NATIVE_COMMANDS.has(cmd.name)
  );
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
