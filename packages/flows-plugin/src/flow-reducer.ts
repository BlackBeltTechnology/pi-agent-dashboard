/**
 * Flow state machine reducer.
 * Handles all flow_* events and returns updated FlowState.
 */
import type {
  DashboardEvent,
  FlowAgentState,
  FlowDetailEntry,
  FlowRecentTool,
  FlowState,
  FlowAgentCardConfig,
} from "@blackbelt-technology/pi-dashboard-shared/types.js";

/** Extract a short input preview for tool call display */
function extractToolInputPreview(toolName: string, input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const inp = input as Record<string, unknown>;
  switch (toolName.toLowerCase()) {
    case "read":
    case "write":
    case "edit":
      return String(inp.file_path || inp.path || "").split("/").pop() || "";
    case "grep":
      return String(inp.pattern || "").slice(0, 20);
    case "bash":
      return String(inp.command || "").slice(0, 20);
    case "flow_write":
      return String(inp.name || "");
    default:
      return JSON.stringify(input).slice(0, 20);
  }
}

/**
 * Find an agent entry by agentName or stepId.
 * Agents map is keyed by step ID, but events reference by agent name.
 * Also accepts stepId for flow_loop_iteration which uses loopTarget (a step ID).
 * Returns [mapKey, agent] or [undefined, undefined].
 */
function findAgent(
  agents: Map<string, FlowAgentState>,
  nameOrStepId: string,
  stepId?: string,
): [string | undefined, FlowAgentState | undefined] {
  // Direct key lookup (step ID)
  if (agents.has(nameOrStepId)) return [nameOrStepId, agents.get(nameOrStepId)!];
  // If stepId provided, try that
  if (stepId && agents.has(stepId)) return [stepId, agents.get(stepId)!];
  // Search by agentName field
  for (const [key, agent] of agents) {
    if (agent.agentName === nameOrStepId) return [key, agent];
  }
  // Search by stepId field
  for (const [key, agent] of agents) {
    if (agent.stepId === nameOrStepId) return [key, agent];
  }
  return [undefined, undefined];
}

/**
 * Returns true if the event type is a flow event handled by this reducer.
 */
export function isFlowEvent(eventType: string): boolean {
  return eventType.startsWith("flow_");
}

/**
 * Reduce a flow event into the current FlowState.
 * Returns null when the event creates a new flow (flow_started).
 * Caller should pass current flowState (may be null).
 */
export function reduceFlowEvent(
  flowState: FlowState | null,
  event: DashboardEvent,
): FlowState | null {
  const data = event.data;

  switch (event.eventType) {
    case "flow_started": {
      const steps = data.steps as Array<{
        id: string;
        stepType: string;
        agent?: string;
        blockedBy?: string[];
        loopTarget?: string;
        exitTarget?: string;
      }> | undefined;
      const agents = new Map<string, FlowAgentState>();
      if (steps) {
        for (const step of steps) {
          // Include all steps that have an agent (not just stepType "agent")
          // This covers fork (with agent), agent-loop-decision, agent-decision, etc.
          if (step.agent) {
            // Key by step ID to avoid deduplication when multiple steps share an agent
            agents.set(step.id, {
              agentName: step.agent,
              stepId: step.id,
              stepType: step.stepType,
              status: "pending",
              blockedBy: step.blockedBy || [],
              recentTools: [],
              detailHistory: [],
            });
          }
        }
      }
      // Store all steps for DAG graph (including non-agent types)
      const dagSteps = steps?.map(step => ({
        id: step.id,
        stepType: step.stepType,
        agent: step.agent,
        blockedBy: step.blockedBy || [],
        loopTarget: step.loopTarget,
        exitTarget: step.exitTarget,
      }));

      return {
        flowName: data.flowName as string,
        task: (data.task as string) || "",
        status: "running",
        autonomousMode: (data.autonomousMode as boolean) || false,
        flowSource: (data.source as string) || undefined,
        agents,
        dagSteps,
      };
    }

    case "flow_agent_started": {
      if (!flowState) return null;
      const agentName = data.agentName as string;
      const stepId = (data.stepId as string) || agentName;
      const config = data.config as FlowAgentCardConfig | undefined;
      const agents = new Map(flowState.agents);
      const [key, existing] = findAgent(agents, agentName, stepId);
      const mapKey = key || stepId;
      const isRerun = existing && (existing.status === "complete" || existing.status === "error" || existing.status === "blocked");
      agents.set(mapKey, {
        ...(existing || {
          agentName,
          stepId,
          blockedBy: [],
          recentTools: [],
          detailHistory: [],
        }),
        ...(isRerun ? { recentTools: [], detailHistory: [] } : {}),
        status: "running",
        label: config?.card?.label,
        model: config?.model,
        resolvedModel: (data.resolvedModel as string) || undefined,
        cardRole: config?.card?.role,
        sourcePath: config?.sourcePath,
        runCount: isRerun ? (existing.runCount ?? 1) + 1 : (existing?.runCount ?? 1),
      });
      return { ...flowState, agents };
    }

    case "flow_agent_complete": {
      if (!flowState) return null;
      const agentName = data.agentName as string;
      const stepId = data.stepId as string | undefined;
      const result = data.result as {
        success: boolean;
        status?: string;
        summary?: string;
        files?: string[];
        tokens?: { input: number; output: number };
        duration?: number;
      } | undefined;
      const agents = new Map(flowState.agents);
      const [key, existing] = findAgent(agents, agentName, stepId);
      if (key && existing) {
        agents.set(key, {
          ...existing,
          status: result?.status === "blocked" ? "blocked" : result?.success ? "complete" : "error",
          tokens: result?.tokens,
          duration: result?.duration,
          summary: result?.summary,
          files: result?.files,
        });
      }
      return { ...flowState, agents };
    }

    case "flow_tool_call": {
      if (!flowState) return null;
      const agentName = data.agentName as string;
      const stepId = data.stepId as string | undefined;
      const toolName = data.toolName as string;
      const input = data.input;
      const agents = new Map(flowState.agents);
      const [key, existing] = findAgent(agents, agentName, stepId);
      if (key && existing) {
        const preview = extractToolInputPreview(toolName, input);
        const recentTools: FlowRecentTool[] = [
          ...existing.recentTools,
          { toolName, inputPreview: preview },
        ].slice(-3);
        const detailHistory: FlowDetailEntry[] = [
          ...existing.detailHistory,
          { kind: "tool", toolName, input, isError: false },
        ];
        agents.set(key, { ...existing, recentTools, detailHistory });
      }
      return { ...flowState, agents };
    }

    case "flow_tool_result": {
      if (!flowState) return null;
      const agentName = data.agentName as string;
      const stepId = data.stepId as string | undefined;
      const agents = new Map(flowState.agents);
      const [key, existing] = findAgent(agents, agentName, stepId);
      if (key && existing) {
        const detailHistory = [...existing.detailHistory];
        for (let i = detailHistory.length - 1; i >= 0; i--) {
          const entry = detailHistory[i];
          if (entry.kind === "tool" && entry.output === undefined) {
            detailHistory[i] = {
              ...entry,
              output: data.output,
              isError: (data.isError as boolean) || false,
            };
            break;
          }
        }
        agents.set(key, { ...existing, detailHistory });
      }
      return { ...flowState, agents };
    }

    case "flow_assistant_text": {
      if (!flowState) return null;
      const agentName = data.agentName as string;
      const stepId = data.stepId as string | undefined;
      const text = data.text as string;
      if (!text) return flowState;
      const agents = new Map(flowState.agents);
      const [key, existing] = findAgent(agents, agentName, stepId);
      if (key && existing) {
        const detailHistory: FlowDetailEntry[] = [
          ...existing.detailHistory,
          { kind: "text", text },
        ];
        agents.set(key, { ...existing, detailHistory });
      }
      return { ...flowState, agents };
    }

    case "flow_thinking_text": {
      if (!flowState) return null;
      const agentName = data.agentName as string;
      const stepId = data.stepId as string | undefined;
      const text = data.text as string;
      if (!text) return flowState;
      const agents = new Map(flowState.agents);
      const [key, existing] = findAgent(agents, agentName, stepId);
      if (key && existing) {
        const detailHistory: FlowDetailEntry[] = [
          ...existing.detailHistory,
          { kind: "thinking", text },
        ];
        agents.set(key, { ...existing, detailHistory });
      }
      return { ...flowState, agents };
    }

    case "flow_loop_iteration": {
      if (!flowState) return null;
      const loopTarget = data.loopTarget as string;
      const iteration = data.iteration as number;
      const maxIterations = data.maxIterations as number;
      if (!loopTarget) return flowState;
      const agents = new Map(flowState.agents);
      const [key, existing] = findAgent(agents, loopTarget);
      if (key && existing) {
        agents.set(key, {
          ...existing,
          loopIteration: iteration,
          loopMax: maxIterations,
        });
      }
      return { ...flowState, agents };
    }

    case "flow_auto_decision": {
      return flowState;
    }

    case "flow_complete": {
      if (!flowState) return null;
      const status = (data.status as string) || "success";
      return {
        ...flowState,
        status: status as FlowState["status"],
        flowResult: data as Record<string, unknown>,
      };
    }

    case "flow_summary_ready": {
      if (!flowState) return null;
      return {
        ...flowState,
        nextStep: (data.nextStep as string | null) ?? null,
        summaryStats: data.stats as FlowState["summaryStats"],
      };
    }

    case "flow_summary_dismissed": {
      return null;
    }

    case "flow_autonomous_changed": {
      if (!flowState) return null;
      return {
        ...flowState,
        autonomousMode: (data.enabled as boolean) ?? flowState.autonomousMode,
      };
    }

    default:
      return flowState;
  }
}
