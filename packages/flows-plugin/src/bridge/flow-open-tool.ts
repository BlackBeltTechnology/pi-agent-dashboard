/**
 * The agent-callable `flow_open` tool (D1). Shows a catalog flow
 * (`flow: "<ns>:<name>"`, runnable) or a flow definition file / directory
 * (`path`, view-only) in this session's dashboard flow slot.
 *
 * The bridge tracks whether a flow runs (the server is not fed flow events):
 * the active `runId` is set on `flow:flow-started` and cleared only by a
 * `flow:complete` carrying the same `runId` (a rejected complete has none and
 * never clears), and reset on `session_start`. While a flow runs the call is
 * refused `flow-running` locally. Otherwise the request rides the private
 * plugin lane `flow/open`; the server takes the session from lane meta.
 * Relative paths resolve against the tool context cwd. Never throws.
 * See change: add-flow-open-tool.
 */
import path from "node:path";
import { requestPluginServer } from "@blackbelt-technology/dashboard-plugin-runtime/bridge";

const FLOW_OPEN_TOOL = "flow_open";

interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
}

interface FlowOpenToolDef {
  name: string;
  label: string;
  description: string;
  promptGuidelines: string[];
  parameters: Record<string, unknown>;
  execute(
    toolCallId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
    onUpdate?: unknown,
    ctx?: { cwd?: string },
  ): Promise<ToolResult>;
}

interface PiLike {
  registerTool?: (tool: FlowOpenToolDef) => void;
  on?: (name: string, fn: () => void) => unknown;
  events?: { on(name: string, fn: (data: unknown) => void): unknown };
}

const result = (details: Record<string, unknown>): ToolResult => ({
  content: [{ type: "text", text: JSON.stringify(details) }],
  details,
});
const refused = (reason: string) => result({ status: "refused", reason });

function createFlowOpenTool(isRunning: () => boolean): FlowOpenToolDef {
  return {
    name: FLOW_OPEN_TOOL,
    label: "Show a flow",
    description:
      "Show a flow's graph and node cards in the dashboard flow panel of this session. Pass exactly one of `flow` (a catalog flow name `<namespace>:<name>`, opens runnable) or `path` (a flow.yaml / flow.yml, or a directory directly containing one, inside the session working directory; opens view-only). Returns `shown` with `acks` (browser tabs that showed it), `no-viewer` (no dashboard browser confirmed), or `refused` with a `reason` (invalid-arguments, unknown-flow, not-a-flow, path-not-allowed, flow-running, rate-limited, unavailable); a directory without a flow returns `candidates`.",
    promptGuidelines: [
      "After writing, editing or inspecting a pi flow, call flow_open (with `flow` for a registered catalog flow, else `path`) so the user can see the flow in the dashboard.",
    ],
    parameters: {
      type: "object",
      properties: {
        flow: { type: "string", minLength: 1, maxLength: 200, description: "Catalog flow name, e.g. custom:update-dashboard." },
        path: { type: "string", minLength: 1, maxLength: 4096, description: "Flow definition file or a directory directly containing flow.yaml." },
      },
      additionalProperties: false,
    },
    async execute(_id, params, _signal, _u, ctx) {
      try {
        const payload = toPayload(params, ctx?.cwd);
        if (typeof payload === "string") return refused(payload);
        if (isRunning()) return refused("flow-running");
        const reply = await requestPluginServer("flows", "flow/open", payload);
        const r = reply.ok ? (reply.result as Record<string, unknown> | null) : null;
        if (!r || typeof r.status !== "string") return refused("unavailable");
        return result(r);
      } catch {
        return refused("unavailable");
      }
    },
  };
}

/** The lane payload (`flow`, or `path` resolved against the tool cwd), or `invalid-arguments`. */
function toPayload(params: Record<string, unknown> | undefined, cwd: string | undefined): Record<string, unknown> | "invalid-arguments" {
  const hasFlow = params?.flow !== undefined;
  const hasPath = params?.path !== undefined;
  if (hasFlow === hasPath) return "invalid-arguments";
  if (hasFlow) return { flow: params?.flow };
  const p = params?.path;
  if (typeof p !== "string" || !p) return "invalid-arguments";
  return { path: cwd ? path.resolve(cwd, p) : p };
}

/** Register `flow_open` and its running-flow tracker. Never throws. */
export function startFlowOpenTool(pi: PiLike): void {
  if (!pi || typeof pi.registerTool !== "function") return;
  let activeRunId: string | null = null;
  const runIdOf = (d: unknown): string | null => {
    const id = (d as { runId?: unknown } | null | undefined)?.runId;
    return typeof id === "string" && id ? id : null;
  };
  try {
    pi.events?.on("flow:flow-started", (d) => {
      const id = runIdOf(d);
      if (id) activeRunId = id;
    });
    pi.events?.on("flow:complete", (d) => {
      const id = runIdOf(d);
      if (id && id === activeRunId) activeRunId = null;
    });
    pi.on?.("session_start", () => {
      activeRunId = null;
    });
  } catch {
    /* tracking is best-effort */
  }
  try {
    pi.registerTool(createFlowOpenTool(() => activeRunId !== null));
  } catch {
    /* never throw from activate */
  }
}
