/**
 * Flows → automation action contribution (publish/collect).
 *
 * Flows PUBLISHES an immutable action contribution under
 * `automation.action.flows` via `ctx.provide`. It does NOT consume an
 * automation-owned registry, import the automation package, or depend on load
 * order — the automation plugin collects published contributions lazily. If
 * flows is disabled, it publishes nothing and `flows.run` never appears.
 *
 * The contribution is typed structurally so flows needs no compile dependency
 * on automation. See change: decouple-automation-action-registry.
 */
import fs from "node:fs";
import path from "node:path";

/** Publish key automation collects under (`automation.action.<source>`). */
export const ACTION_CONTRIBUTION_KEY = "automation.action.flows";

/** Structural mirror of one automation payload-schema field. */
interface ActionFieldSpecLike {
  key: string;
  label: string;
  type: "string" | "multiline" | "text" | "enum";
  help?: string;
  options?: (cwd: string) => string[];
}

/** Structural mirror of an automation action contribution. */
export interface ActionContributionLike {
  id: string;
  source: string;
  label: string;
  description?: string;
  available?: (cwd: string) => boolean;
  unavailableReason?: string;
  payloadSchema?: ActionFieldSpecLike[];
  /** Event-dispatch: emit a configured event into the run session. */
  buildEvent?: (args: { payload: Record<string, unknown>; automation: unknown }) =>
    | { eventType: string; data?: Record<string, unknown> }
    | null;
}

/**
 * Discover flows on disk for a cwd: `<cwd>/.pi/flows/flows/<ns>/<name>/flow.yaml`
 * → `<ns>:<name>` (the command id pi registers the flow under). Sorted.
 */
export function discoverFlows(cwd: string): string[] {
  const root = path.join(cwd, ".pi", "flows", "flows");
  const out: string[] = [];
  let nsDirs: fs.Dirent[];
  try {
    nsDirs = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const ns of nsDirs) {
    if (!ns.isDirectory()) continue;
    const nsPath = path.join(root, ns.name);
    let nameDirs: fs.Dirent[];
    try {
      nameDirs = fs.readdirSync(nsPath, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const nm of nameDirs) {
      if (!nm.isDirectory()) continue;
      if (fs.existsSync(path.join(nsPath, nm.name, "flow.yaml"))) {
        out.push(`${ns.name}:${nm.name}`);
      }
    }
  }
  return out.sort();
}

/**
 * A flow id is `<ns>:<name>` (from discoverFlows). It is placed into the
 * `flow:run` event payload, so a malformed value is rejected (emit nothing).
 */
const FLOW_ID_RE = /^[\w.-]+:[\w.-]+$/;

/** Build the flows action contribution(s): flows.run only. */
export function flowsActionContributions(): ActionContributionLike[] {
  const hasFlows = (cwd: string) => discoverFlows(cwd).length > 0;
  return [
    {
      id: "flows.run",
      source: "flows",
      label: "Run a flow",
      description: "Run a flow with a task.",
      available: hasFlows,
      unavailableReason: "no flows in this folder",
      payloadSchema: [
        { key: "flow", label: "Flow", type: "enum", options: discoverFlows, help: "Discovered in .pi/flows/flows" },
        { key: "task", label: "Task", type: "multiline", help: "Passed as the flow's initial task." },
      ],
      // Emit flow:run into the run session (the event pi-flows listens for),
      // not a slash-command prompt. Runs finalize on agent_end.
      buildEvent: ({ payload }) => {
        const flow = String(payload.flow ?? "").trim();
        if (!FLOW_ID_RE.test(flow)) return null;
        const task = String(payload.task ?? "").trim();
        return { eventType: "flow:run", data: { flowName: flow, ...(task ? { task } : {}) } };
      },
    },
  ];
}

/**
 * Publish the flows action contribution for automation to collect. Pure
 * publisher: consumes nothing, references no automation code, order-agnostic.
 */
export function provideFlowsActions(
  provide: (name: string, value: unknown) => void,
  log: (m: string) => void,
): void {
  provide(ACTION_CONTRIBUTION_KEY, flowsActionContributions());
  log("[flows] published automation action: flows.run");
}
