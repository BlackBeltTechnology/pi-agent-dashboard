/**
 * Demo plugin bridge entry (fixture — registered only under
 * PI_DASHBOARD_FIXTURE_PLUGINS=1). Registers `demo_echo`, which round-trips its
 * input through the private plugin request lane to the demo server's
 * `demo/echo` handler. See change: expose-plugin-credential-and-oauth-seams (D8).
 */
import { requestPluginServer } from "@blackbelt-technology/dashboard-plugin-runtime/bridge";

interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
}

interface PiLike {
  registerTool?: (tool: {
    name: string;
    label: string;
    description: string;
    parameters: unknown;
    execute: (toolCallId: string, params: { text?: unknown }) => Promise<ToolResult>;
  }) => void;
}

export async function demoEcho(text: string): Promise<ToolResult> {
  const reply = await requestPluginServer("demo", "demo/echo", { text });
  const out = reply.ok ? String(reply.result) : `error: ${reply.error}`;
  return { content: [{ type: "text", text: out }], details: { ok: reply.ok } };
}

export default function activate(ctx: unknown): void {
  const c = ctx as { pi?: PiLike } | PiLike;
  const pi = ((c as { pi?: PiLike }).pi ?? c) as PiLike;
  if (!pi || typeof pi.registerTool !== "function") return;
  pi.registerTool({
    name: "demo_echo",
    label: "Demo echo",
    description: "Fixture tool: echoes `text` back through the dashboard plugin request lane.",
    parameters: {
      type: "object",
      properties: { text: { type: "string", description: "Text to echo" } },
      required: ["text"],
      additionalProperties: false,
    },
    execute: async (_id, params) => demoEcho(typeof params?.text === "string" ? params.text : ""),
  });
}
