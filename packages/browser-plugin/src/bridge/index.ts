/**
 * Browser plugin bridge entry (pi extension): the agent-facing tools that show
 * a relay tab in the dashboard's editor pane and hand a login to the human.
 *
 *  - `browser_show_in_pane {instanceId, tabId?}` — open the tab in THIS
 *    session's pane (rate-limited server-side).
 *  - `browser_await_human {instanceId, reason}` — open the tab, then block on a
 *    confirm prompt the pane's Done button answers; returns `done` or `cancelled`.
 *    While it blocks, `browser/await-state` tells the server the await is pending (idle hold).
 *  - `browser_connect {target?}` — obtain a browser (dedicated / profile /
 *    headless) per the dashboard's selection policy; calls `browser/connect`.
 *
 * The tools call the plugin server's `browser/open` / `browser/connect` over the
 * private request lane, which supplies the caller's session id from its own socket — never from the
 * arguments. See change: add-browser-editor-pane-tab (D5, D6); add-dedicated-agent-browser (D6).
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

/**
 * Tell the server a `browser_await_human` is pending/finished for an instance so the
 * idle sweep holds it (D8). Best effort: a lane failure must never break the tool.
 */
async function announceAwait(instanceId: unknown, pending: boolean): Promise<void> {
  try {
    await requestPluginServer("browser", "browser/await-state", { instanceId, pending });
  } catch {
    /* the hold is an optimisation of the idle sweep, not a correctness gate */
  }
}

/** Only `target` travels; a spoofed `sessionId` is dropped (the lane supplies the session). */
export async function connectBrowser(params: Record<string, unknown>) {
  return requestPluginServer("browser", "browser/connect", typeof params.target === "string" ? { target: params.target } : {});
}

export function createBrowserTools(): BrowserToolDef[] {
  return [
    {
      name: "browser_connect",
      label: "Connect a browser",
      description:
        "Get a browser for this task. Optional `target`: \"@dedicated\" (the dashboard's own Chrome profile), \"@headless\", or a Chrome profileDirectory. Without it the user's default applies. Returns the browser used (`dedicated` | `profile` | `headless`); for dedicated/profile also `cdpUrl` (run `agent-browser connect <cdpUrl>`) and `liveView` (true = the first tab opens in the user's pane automatically, do not call browser_show_in_pane for it). `unavailable` + `options` means: ask the user which option to use, then call again with that `target`; `stopped: true` means stop and report the reason. Calling again while you hold the dedicated browser closes it and issues a new cdpUrl.",
      parameters: {
        type: "object",
        properties: {
          target: { type: "string", minLength: 1, maxLength: 128, description: "@dedicated, @headless or a Chrome profileDirectory; default: the user's configured browser." },
        },
        additionalProperties: false,
      },
      async execute(_id, params) {
        const reply = await connectBrowser(params);
        if (!reply.ok) return text(`error: ${reply.error}`, { ok: false, error: reply.error });
        const r = (reply.result ?? {}) as Record<string, unknown>;
        return text(JSON.stringify(r), { ok: true, ...r });
      },
    },
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
        await announceAwait(params.instanceId, true);
        try {
          confirmed =
            (await ctx.ui.confirm("Browser: your turn", reason, {
              pluginMeta: { pluginId: "browser", kind: "browser-takeover", instanceId: params.instanceId },
            })) === true;
        } catch {
          confirmed = false; // dismissed / timed out / transport error
        } finally {
          await announceAwait(params.instanceId, false);
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
