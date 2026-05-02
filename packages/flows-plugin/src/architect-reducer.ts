/**
 * Architect state machine reducer.
 * Handles all architect_* events and returns updated ArchitectState.
 */
import type {
  DashboardEvent,
  ArchitectState,
  ArchitectAgentEntry,
  ArchitectDagStep,
  ArchitectParsedFlow,
  ArchitectPrompt,
  FlowRecentTool,
  FlowDetailEntry,
} from "@blackbelt-technology/pi-dashboard-shared/types.js";

const MAX_RECENT_TOOLS = 3;

/** Extract a short input preview for tool call display */
function extractInputPreview(toolName: string, input: unknown): string {
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
    case "agent_write":
      return extractAgentName(inp);
    default:
      return JSON.stringify(input).slice(0, 20);
  }
}

/** Extract agent name from agent_write tool input */
function extractAgentName(input: Record<string, unknown>): string {
  if (input.path) {
    const seg = String(input.path).split("/").pop() || "";
    return seg.replace(/\.md$/, "") || "unknown";
  }
  if (input.content) {
    const m = String(input.content).match(/^name:\s*(.+)$/m);
    if (m) return m[1].trim();
  }
  return "unknown";
}

/** Extract step IDs from flow YAML content via regex (approximate, for live progress) */
function extractStepsFromYaml(content: string): ArchitectDagStep[] {
  const steps: ArchitectDagStep[] = [];
  // Match step entries: "  - id: <name>"
  const idMatches = content.matchAll(/^\s+-\s*id:\s*(.+)$/gm);
  for (const m of idMatches) {
    const id = m[1].trim();
    steps.push({ id, blockedBy: [] });
  }
  // Try to extract fields for each step (simple regex, may miss complex cases)
  const stepBlocks = content.split(/^\s+-\s*id:/m).slice(1);
  for (let i = 0; i < stepBlocks.length && i < steps.length; i++) {
    const block = stepBlocks[i];
    const agentMatch = block.match(/^\s+agent:\s*(.+)$/m);
    if (agentMatch) steps[i].agentName = agentMatch[1].trim();
    const blockedMatch = block.match(/^\s+blockedBy:\s*\[([^\]]*)\]/m);
    if (blockedMatch) {
      steps[i].blockedBy = blockedMatch[1].split(",").map(s => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    }
    const stepTypeMatch = block.match(/^\s+stepType:\s*(.+)$/m);
    if (stepTypeMatch) steps[i].stepType = stepTypeMatch[1].trim() as ArchitectDagStep["stepType"];
    const loopTargetMatch = block.match(/^\s+loop_target:\s*(.+)$/m);
    if (loopTargetMatch) steps[i].loopTarget = loopTargetMatch[1].trim();
    const exitTargetMatch = block.match(/^\s+exit_target:\s*(.+)$/m);
    if (exitTargetMatch) steps[i].exitTarget = exitTargetMatch[1].trim();
  }
  return steps;
}

/** Extract flow name from flow YAML content */
function extractFlowName(content: string): string {
  const m = content.match(/^name:\s*(.+)$/m);
  return m ? m[1].trim() : "";
}

/**
 * Returns true if the event type is an architect event handled by this reducer.
 */
export function isArchitectEvent(eventType: string): boolean {
  return eventType.startsWith("architect_");
}

/**
 * Reduce an architect event into the current ArchitectState.
 * Returns null to clear the state (e.g., on complete/cancelled).
 */
export function reduceArchitectEvent(
  state: ArchitectState | null,
  event: DashboardEvent,
): ArchitectState | null {
  const data = event.data;

  switch (event.eventType) {
    case "architect_prompt_request": {
      if (!state) return null;
      const prompt: ArchitectPrompt = {
        id: data.id as string,
        type: (data.promptType as "select" | "input" | "confirm") || "select",
        question: (data.question as string) || "",
        options: data.options as string[] | undefined,
        defaultValue: data.defaultValue as string | undefined,
      };
      return { ...state, pendingPrompt: prompt };
    }

    case "architect_context_generating": {
      return {
        phase: "context",
        architectMode: (data.mode as "new" | "edit") || "new",
        flowName: "",
        agents: [],
        dagSteps: [],
        parsedFlows: [],
        lastToolCall: null,
        recentTools: [],
        detailHistory: [],
        iteration: 1,
        pendingPrompt: null,
      };
    }

    case "architect_started": {
      const mode = (data.mode as "new" | "edit") || "new";
      const iteration = (data.iteration as number) || 1;
      const resolvedModel = data.resolvedModel as string | undefined;
      const modelAlias = data.modelAlias as string | undefined;
      // If we already have state (from context_generating), just update phase
      if (state) {
        return {
          ...state,
          phase: "designing",
          architectMode: mode,
          iteration,
          resolvedModel,
          modelAlias,
          pendingPrompt: null,
        };
      }
      return {
        phase: "designing",
        architectMode: mode,
        flowName: "",
        resolvedModel,
        modelAlias,
        agents: [],
        dagSteps: [],
        parsedFlows: [],
        lastToolCall: null,
        recentTools: [],
        detailHistory: [],
        iteration,
        pendingPrompt: null,
      };
    }

    case "architect_tool_call": {
      if (!state) return null;
      const toolName = data.toolName as string;
      const input = data.input as Record<string, unknown> | undefined;
      const next = { ...state };

      const inputPreview = extractInputPreview(toolName, input);

      // Update last tool call for display
      next.lastToolCall = { toolName, inputPreview };

      // Append to recent tools (rolling window)
      next.recentTools = [...state.recentTools, { toolName, inputPreview } as FlowRecentTool].slice(-MAX_RECENT_TOOLS);

      // Append to detail history
      next.detailHistory = [...state.detailHistory, { kind: "tool", toolName, input, isError: false } as FlowDetailEntry];

      switch (toolName) {
        case "agent_catalog":
          next.catalogSummary = "Reading catalog…";
          break;

        case "agent_write": {
          const name = input ? extractAgentName(input) : "unknown";
          const source = input ? String(input.content || "") : "";
          const agents = [...next.agents];
          const existing = agents.find(a => a.name === name);
          if (existing) {
            existing.type = "custom";
            existing.status = "creating";
            existing.statusText = "Writing…";
            if (source) existing.source = source;
          } else {
            agents.push({ name, type: "custom", status: "creating", statusText: "Writing…", ...(source ? { source } : {}) });
          }
          next.agents = agents;
          break;
        }

        case "flow_write": {
          if (input?.content) {
            const content = String(input.content);
            const name = extractFlowName(content);
            if (name) next.flowName = name;
            const steps = extractStepsFromYaml(content);
            if (steps.length > 0) {
              next.dagSteps = steps;
              // Register agents from steps that aren't already in the list
              const agents = [...next.agents];
              for (const step of steps) {
                const agentName = step.agentName || step.id;
                if (!agents.find(a => a.name === agentName)) {
                  agents.push({ name: agentName, type: "built-in", status: "done" });
                }
              }
              next.agents = agents;
            }
          }
          break;
        }
      }

      return next;
    }

    case "architect_tool_result": {
      if (!state) return null;
      const toolName = data.toolName as string;
      const isError = (data.isError as boolean) || false;
      const next = { ...state };

      // Update last tool entry in detail history with output
      const detailHistory = [...state.detailHistory];
      for (let i = detailHistory.length - 1; i >= 0; i--) {
        const entry = detailHistory[i];
        if (entry.kind === "tool" && entry.output === undefined) {
          detailHistory[i] = { ...entry, output: data.output, isError };
          break;
        }
      }
      next.detailHistory = detailHistory;

      switch (toolName) {
        case "agent_catalog": {
          // Parse catalog output for summary
          try {
            const output = data.output;
            const catalog = typeof output === "string" ? JSON.parse(output) : output;
            if (Array.isArray(catalog)) {
              next.catalogSummary = `Catalog: ${catalog.length} agents`;
            }
          } catch {
            next.catalogSummary = "Catalog loaded";
          }
          break;
        }

        case "flow_write": {
          // The tool result output is { written: boolean, path, diagnostics? }
          // Already parsed by execution.ts (JSON.parse on content[0].text)
          const output = data.output;
          if (output && typeof output === "object" && "written" in output) {
            next.flowWriteStatus = output.written ? "written" : "validation-error";
          } else if (isError) {
            next.flowWriteStatus = "validation-error";
          }
          break;
        }

        case "agent_write": {
          // Find the agent that was being created and mark done/error
          const agents = [...next.agents];
          const creating = agents.find(a => a.status === "creating");
          if (creating) {
            creating.status = isError ? "error" : "done";
            creating.statusText = isError ? "Failed" : undefined;
          }
          next.agents = agents;
          break;
        }
      }

      return next;
    }

    case "architect_text": {
      if (!state) return null;
      const kind = data.kind as string;
      const text = data.text as string;
      if (!text) return state;
      const entry: FlowDetailEntry = kind === "thinking"
        ? { kind: "thinking", text }
        : { kind: "text", text };
      return {
        ...state,
        detailHistory: [...state.detailHistory, entry],
      };
    }

    case "architect_preview": {
      if (!state) return null;
      const parsedFlows = data.parsedFlows as ArchitectParsedFlow[] | undefined;
      // Store raw YAML content for the YAML viewer
      const flows = data.flows as Array<{ name: string; content: string }> | undefined;
      const next: ArchitectState = {
        ...state,
        phase: "preview",
        flowYamlContent: flows?.[0]?.content,
      };

      if (parsedFlows && parsedFlows.length > 0) {
        next.parsedFlows = parsedFlows;
        // Use first flow's data for display
        const first = parsedFlows[0];
        if (first.name) next.flowName = first.name;
        if (first.steps.length > 0) next.dagSteps = first.steps;
        // Register agents from parsed steps
        const agents = [...next.agents];
        for (const flow of parsedFlows) {
          for (const step of flow.steps) {
            const agentName = step.agentName || step.id;
            if (!agents.find(a => a.name === agentName)) {
              agents.push({ name: agentName, type: "built-in", status: "done" });
            }
          }
        }
        next.agents = agents;
      }

      return next;
    }

    case "architect_replan": {
      const iteration = (data.iteration as number) || ((state?.iteration ?? 1) + 1);
      return {
        phase: "designing",
        architectMode: state?.architectMode || "new",
        flowName: state?.flowName || "",
        agents: [],
        dagSteps: [],
        parsedFlows: [],
        lastToolCall: null,
        recentTools: [],
        detailHistory: [],
        iteration,
        pendingPrompt: null,
      };
    }

    case "architect_complete":
    case "architect_cancelled": {
      return null;
    }

    case "architect_error": {
      if (!state) return null;
      const summary = (data.summary as string) || (data.error as string) || "Unknown error";
      return { ...state, error: summary };
    }

    case "architect_saved": {
      // Keep state alive — architect_complete will clear it
      return state;
    }

    case "architect_run_handoff": {
      // Flow execution is about to start — clear architect state
      return null;
    }

    case "architect_context_ready": {
      // Context generation finished, architect will start soon
      return state;
    }

    default:
      return state;
  }
}
