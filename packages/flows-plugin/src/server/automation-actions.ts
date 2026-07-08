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
 *
 * Flow availability + the `flow` enum options come from the LIVE per-session
 * flows list the server already holds (`stateStore`, populated by the
 * bridge-forwarded `flows_list`), resolved by mapping a cwd to its running
 * session(s). NOT a static `.pi/flows/flows/` scan — so package-bundled and
 * event-registered flows (which pi-flows discovers at runtime) are reflected.
 * See change: fix-automation-flow-detection.
 */

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
  /**
   * Event-dispatch: emit a configured event into the run session. May also
   * declare `completion` — how a run of this action FINISHES — so the
   * automation engine can finalize an event-dispatched run (which emits no
   * `agent_end`) without knowing anything action-specific.
   * See change: finalize-event-dispatched-automation-runs.
   */
  buildEvent?: (args: { payload: Record<string, unknown>; automation: unknown }) =>
    | {
        eventType: string;
        data?: Record<string, unknown>;
        completion?: {
          eventType: string;
          summarize?: (data: Record<string, unknown> | undefined) => string;
        };
      }
    | null;
}

/**
 * Resolve the flows available in a cwd: `<ns>:<name>` ids from the live
 * per-session flows list. Injected by the server entry (see index.ts) so this
 * module stays free of server/session dependencies.
 */
export type FlowsForCwd = (cwd: string) => string[];

/**
 * A flow id is `<ns>:<name>`. It is placed into the
 * `flow:run` event payload, so a malformed value is rejected (emit nothing).
 */
const FLOW_ID_RE = /^[\w.-]+:[\w.-]+$/;

/** A plain-object `payload.inputs` with at least one key, else undefined.
 *  Values are forwarded as-is (already per-fire resolved, types preserved). */
function normalizeInputs(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const obj = raw as Record<string, unknown>;
  return Object.keys(obj).length > 0 ? obj : undefined;
}

/**
 * Derive an automation run-result line from a pi-flows `flow_complete` payload
 * (the forwarded `FlowResult`: `status`, `flowName`, `lastResult.result.summary`).
 * An event-dispatched flows.run has no assistant turn to capture, so this line
 * IS the run result. Owns the FlowResult shape so the automation plugin does
 * not. See change: finalize-event-dispatched-automation-runs.
 */
export function summarizeFlowResult(data: Record<string, unknown> | undefined): string {
  const d = data as
    | { status?: string; flowName?: string; lastResult?: { result?: { summary?: string } } }
    | undefined;
  const summary = d?.lastResult?.result?.summary;
  return `flow ${d?.flowName ?? ""} ${d?.status ?? "finished"}${summary ? `: ${summary}` : ""}`
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Build the flows action contribution(s): flows.run only. Availability and the
 * `flow` enum options derive from the injected `flowsForCwd` resolver (live
 * per-session flows list). See change: fix-automation-flow-detection.
 */
export function flowsActionContributions(flowsForCwd: FlowsForCwd): ActionContributionLike[] {
  const hasFlows = (cwd: string) => flowsForCwd(cwd).length > 0;
  return [
    {
      id: "flows.run",
      source: "flows",
      label: "Run a flow",
      description: "Run a flow with a task.",
      available: hasFlows,
      unavailableReason: "no flows in this folder (no running session, or the session reports no flows)",
      payloadSchema: [
        { key: "flow", label: "Flow", type: "enum", options: flowsForCwd, help: "Flows reported by the running session for this folder" },
        { key: "task", label: "Task", type: "multiline", help: "Passed as the flow's initial task." },
      ],
      // Emit flow:run into the run session (the event pi-flows listens for),
      // not a slash-command prompt. A flows.run run produces NO agent turn in
      // the host session (pi-flows consumes flow:run headlessly), so it emits
      // no `agent_end`. Declare `completion` so the automation engine finalizes
      // it on the forwarded `flow_complete` event instead (the extension's
      // FLOW_EVENT_MAP forwards pi-flows' `flow:complete` → `flow_complete`).
      // All flows knowledge — the event name and the FlowResult shape — stays
      // here; the automation plugin stays generic.
      //
      // `payload` is already per-fire interpolated by the engine (the
      // `${{trigger}}` token in `payload.inputs` is resolved to the fired
      // value, type preserved). We forward `payload.inputs` as `data.inputs`,
      // which pi-flows consumes as `flowInput` → `${{flow.input.<name>}}`.
      // `task` stays optional and may coexist with `inputs`.
      // See change: finalize-event-dispatched-automation-runs, wire-flow-inputs-in-automation.
      buildEvent: ({ payload }) => {
        const flow = String(payload.flow ?? "").trim();
        if (!FLOW_ID_RE.test(flow)) return null;
        const task = String(payload.task ?? "").trim();
        const inputs = normalizeInputs(payload.inputs);
        const data: Record<string, unknown> = { flowName: flow };
        if (task) data.task = task;
        if (inputs) data.inputs = inputs;
        return {
          eventType: "flow:run",
          data,
          completion: { eventType: "flow_complete", summarize: summarizeFlowResult },
        };
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
  flowsForCwd: FlowsForCwd,
): void {
  provide(ACTION_CONTRIBUTION_KEY, flowsActionContributions(flowsForCwd));
  log("[flows] published automation action: flows.run");
}
