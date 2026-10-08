/**
 * Browser plugin bridge entry (pi extension): the agent-facing tools that show
 * a relay tab in the dashboard's editor pane and hand a login to the human.
 *
 *  - `browser_show_in_pane {instanceId, tabId?}` — open the tab in THIS
 *    session's pane (rate-limited server-side).
 *  - `browser_await_human {instanceId, reason}` — open the tab, then block on a
 *    confirm prompt the pane's Done button answers; returns `done` or `cancelled`.
 *
 * Both call the plugin server's `browser/open` over the private request lane,
 * which supplies the caller's session id from its own socket — never from the
 * arguments. See change: add-browser-editor-pane-tab (D5, D6).
 */
import { requestPluginServer } from "@blackbelt-technology/dashboard-plugin-runtime/bridge";

interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
}

/** Per-call context (5th `execute` arg), as gmail's bridge tools use. */
export interface ToolContext {
  hasUI?: boolean;
  ui?: { confirm(title: string, message: string, opts?: unknown): Promise<boolean> };
}

export interface BrowserToolDef {
  name: string;
  label: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(
    toolCallId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
    onUpdate?: unknown,
    ctx?: ToolContext,
  ): Promise<ToolResult>;
}

const text = (t: string, details: Record<string, unknown>): ToolResult => ({ content: [{ type: "text", text: t }], details });

function openArgs(params: Record<string, unknown>, kind: "show" | "takeover") {
  // Only the three known fields travel; anything else (e.g. a spoofed `sessionId`) is dropped here too.
  return {
    kind,
    instanceId: params.instanceId,
    ...(params.tabId !== undefined ? { tabId: params.tabId } : {}),
  };
}

export async function showInPane(params: Record<string, unknown>, kind: "show" | "takeover" = "show") {
  return requestPluginServer("browser", "browser/open", openArgs(params, kind));
}

export function createBrowserTools(): BrowserToolDef[] {
  return [
    {
      name: "browser_show_in_pane",
      label: "Show browser tab in pane",
      description:
        "Show one of your relay browser tabs in the user's dashboard editor pane, next to the chat. Pass the instanceId of your relay connection; tabId is optional (default: the most recent tab). Limited to one call per 5 s per instance.",
      parameters: {
        type: "object",
        properties: {
          instanceId: { type: "string", minLength: 1, description: "Relay instance id." },
          tabId: { type: "integer", description: "Chrome tab id; default: the instance's most recent tab." },
        },
        required: ["instanceId"],
        additionalProperties: false,
      },
      async execute(_id, params) {
        const reply = await showInPane(params, "show");
        if (!reply.ok) return text(`error: ${reply.error}`, { ok: false, error: reply.error });
        const r = reply.result as { path?: string };
        return text(`Opened ${r?.path ?? "tab"} in the dashboard pane.`, { ok: true, ...(r ?? {}) });
      },
    },
    {
      name: "browser_await_human",
      label: "Ask the human to take over the browser",
      description:
        "Show a relay browser tab in the dashboard pane and WAIT while the user does something only they can (log in, solve a CAPTCHA, approve 2FA). Returns `done` when the user clicks Done (or confirms), `cancelled` otherwise. `reason` is what the user is asked to do.",
      parameters: {
        type: "object",
        properties: {
          instanceId: { type: "string", minLength: 1 },
          reason: { type: "string", minLength: 1, maxLength: 200, description: "What the user should do, e.g. 'Sign in to GitHub'." },
        },
        required: ["instanceId", "reason"],
        additionalProperties: false,
      },
      async execute(_id, params, _signal, _u, ctx) {
        if (!ctx?.hasUI || !ctx.ui) {
          return text("cancelled: no interactive UI in this session", { outcome: "cancelled", reason: "no-ui" });
        }
        const reply = await showInPane(params, "takeover");
        if (!reply.ok) return text(`error: ${reply.error}`, { outcome: "cancelled", reason: reply.error });
        const reason = typeof params.reason === "string" ? params.reason : "Complete the step in the browser";
        let confirmed = false;
        try {
          confirmed =
            (await ctx.ui.confirm("Browser: your turn", reason, {
              pluginMeta: { pluginId: "browser", kind: "browser-takeover", instanceId: params.instanceId },
            })) === true;
        } catch {
          confirmed = false; // dismissed / timed out / transport error
        }
        return confirmed
          ? text("done", { outcome: "done" })
          : text("cancelled: the user did not finish", { outcome: "cancelled", reason: "declined-or-timeout" });
      },
    },
  ];
}

interface PiLike {
  registerTool?: (tool: BrowserToolDef) => void;
}

export default function activate(ctx: unknown): void {
  const c = ctx as { pi?: PiLike } | PiLike;
  const pi = ((c as { pi?: PiLike }).pi ?? c) as PiLike;
  if (!pi || typeof pi.registerTool !== "function") return;
  for (const tool of createBrowserTools()) pi.registerTool(tool);
}
