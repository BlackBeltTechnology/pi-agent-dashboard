import { describe, it, expect } from "vitest";
import { createInitialState, reduceEvent, addInteractiveRequest } from "../event-reducer.js";
import { reduceArchitectEvent } from "@blackbelt-technology/pi-dashboard-flows-plugin/reducer";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";

function makeEvent(eventType: string, data: Record<string, unknown> = {}): DashboardEvent {
  return { eventType, timestamp: Date.now(), data };
}

describe("event-reducer flow events", () => {
  it("flow_started creates flow state with agents", () => {
    const state = createInitialState();
    const next = reduceEvent(state, makeEvent("flow_started", {
      flowName: "research",
      task: "Find bugs",
      autonomousMode: false,
      steps: [
        { id: "r", stepType: "agent", agent: "researcher", blockedBy: [] },
        { id: "d", stepType: "agent", agent: "developer", blockedBy: ["r"] },
        { id: "f1", stepType: "fork", question: "which?" },
      ],
    }));
    expect(next.flowState).not.toBeNull();
    expect(next.flowState!.flowName).toBe("research");
    expect(next.flowState!.task).toBe("Find bugs");
    expect(next.flowState!.status).toBe("running");
    expect(next.flowState!.agents.size).toBe(2); // fork step excluded (no agent field)
    // Agents are keyed by step ID
    expect(next.flowState!.agents.get("r")!.status).toBe("pending");
    expect(next.flowState!.agents.get("r")!.agentName).toBe("researcher");
    expect(next.flowState!.agents.get("d")!.blockedBy).toEqual(["r"]);
  });

  it("flow_agent_started sets agent to running with config", () => {
    let state = createInitialState();
    state = reduceEvent(state, makeEvent("flow_started", {
      flowName: "test", task: "", steps: [{ id: "r", stepType: "agent", agent: "researcher", blockedBy: [] }],
    }));
    state = reduceEvent(state, makeEvent("flow_agent_started", {
      agentName: "researcher",
      stepId: "r",
      config: { name: "researcher", model: "@research", card: { label: "Research", role: "@research" } },
    }));
    const agent = state.flowState!.agents.get("r")!;
    expect(agent.status).toBe("running");
    expect(agent.label).toBe("Research");
    expect(agent.model).toBe("@research");
  });

  it("flow_agent_complete sets agent status and tokens", () => {
    let state = createInitialState();
    state = reduceEvent(state, makeEvent("flow_started", {
      flowName: "test", task: "", steps: [{ id: "r", stepType: "agent", agent: "researcher", blockedBy: [] }],
    }));
    state = reduceEvent(state, makeEvent("flow_agent_complete", {
      agentName: "researcher",
      stepId: "r",
      result: { success: true, status: "complete", tokens: { input: 3000, output: 1000 }, duration: 12000, files: ["a.ts"] },
    }));
    const agent = state.flowState!.agents.get("r")!;
    expect(agent.status).toBe("complete");
    expect(agent.tokens).toEqual({ input: 3000, output: 1000 });
    expect(agent.duration).toBe(12000);
    expect(agent.files).toEqual(["a.ts"]);
  });

  it("flow_agent_complete with error sets error status", () => {
    let state = createInitialState();
    state = reduceEvent(state, makeEvent("flow_started", {
      flowName: "test", task: "", steps: [{ id: "r", stepType: "agent", agent: "researcher", blockedBy: [] }],
    }));
    state = reduceEvent(state, makeEvent("flow_agent_complete", {
      agentName: "researcher",
      result: { success: false, status: "error", tokens: { input: 100, output: 50 }, duration: 1000 },
    }));
    expect(state.flowState!.agents.get("r")!.status).toBe("error");
  });

  it("flow_tool_call adds to recentTools and detailHistory", () => {
    let state = createInitialState();
    state = reduceEvent(state, makeEvent("flow_started", {
      flowName: "test", task: "", steps: [{ id: "r", stepType: "agent", agent: "researcher", blockedBy: [] }],
    }));
    state = reduceEvent(state, makeEvent("flow_tool_call", {
      agentName: "researcher", toolName: "read", input: { path: "src/foo.ts" },
    }));
    const agent = state.flowState!.agents.get("r")!;
    expect(agent.recentTools).toHaveLength(1);
    expect(agent.recentTools[0].toolName).toBe("read");
    expect(agent.recentTools[0].inputPreview).toBe("foo.ts");
    expect(agent.detailHistory).toHaveLength(1);
    expect(agent.detailHistory[0].kind).toBe("tool");
  });

  it("flow_tool_result updates last tool entry", () => {
    let state = createInitialState();
    state = reduceEvent(state, makeEvent("flow_started", {
      flowName: "test", task: "", steps: [{ id: "r", stepType: "agent", agent: "researcher", blockedBy: [] }],
    }));
    state = reduceEvent(state, makeEvent("flow_tool_call", {
      agentName: "researcher", toolName: "read", input: { path: "x.ts" },
    }));
    state = reduceEvent(state, makeEvent("flow_tool_result", {
      agentName: "researcher", toolName: "read", output: "file contents", isError: false,
    }));
    const entry = state.flowState!.agents.get("r")!.detailHistory[0];
    expect(entry.kind).toBe("tool");
    if (entry.kind === "tool") {
      expect(entry.output).toBe("file contents");
      expect(entry.isError).toBe(false);
    }
  });

  it("flow_assistant_text and flow_thinking_text append to detailHistory", () => {
    let state = createInitialState();
    state = reduceEvent(state, makeEvent("flow_started", {
      flowName: "test", task: "", steps: [{ id: "r", stepType: "agent", agent: "researcher", blockedBy: [] }],
    }));
    state = reduceEvent(state, makeEvent("flow_assistant_text", { agentName: "researcher", text: "I found..." }));
    state = reduceEvent(state, makeEvent("flow_thinking_text", { agentName: "researcher", text: "Let me think..." }));
    const history = state.flowState!.agents.get("r")!.detailHistory;
    expect(history).toHaveLength(2);
    expect(history[0].kind).toBe("text");
    expect(history[1].kind).toBe("thinking");
  });

  it("flow_loop_iteration updates target agent", () => {
    let state = createInitialState();
    state = reduceEvent(state, makeEvent("flow_started", {
      flowName: "test", task: "", steps: [{ id: "d", stepType: "agent", agent: "developer", blockedBy: [] }],
    }));
    state = reduceEvent(state, makeEvent("flow_loop_iteration", {
      stepId: "verify", loopTarget: "developer", iteration: 2, maxIterations: 3,
    }));
    const agent = state.flowState!.agents.get("d")!;
    expect(agent.loopIteration).toBe(2);
    expect(agent.loopMax).toBe(3);
  });

  it("flow_complete sets final status and result", () => {
    let state = createInitialState();
    state = reduceEvent(state, makeEvent("flow_started", {
      flowName: "test", task: "", steps: [{ id: "r", stepType: "agent", agent: "researcher", blockedBy: [] }],
    }));
    state = reduceEvent(state, makeEvent("flow_complete", {
      status: "success", flowName: "test", results: { researcher: { status: "complete" } },
    }));
    expect(state.flowState!.status).toBe("success");
    expect(state.flowState!.flowResult).toBeDefined();
  });

  it("recentTools keeps only last 3", () => {
    let state = createInitialState();
    state = reduceEvent(state, makeEvent("flow_started", {
      flowName: "test", task: "", steps: [{ id: "r", stepType: "agent", agent: "researcher", blockedBy: [] }],
    }));
    for (let i = 0; i < 5; i++) {
      state = reduceEvent(state, makeEvent("flow_tool_call", {
        agentName: "researcher", toolName: `tool${i}`, input: {},
      }));
    }
    expect(state.flowState!.agents.get("r")!.recentTools).toHaveLength(3);
    expect(state.flowState!.agents.get("r")!.recentTools[2].toolName).toBe("tool4");
  });

  it("flow events without flow_started are ignored", () => {
    const state = createInitialState();
    const next = reduceEvent(state, makeEvent("flow_agent_started", { agentName: "x" }));
    expect(next.flowState).toBeNull();
  });
});

describe("flow dagSteps — all step types in graph", () => {
  it("flow_started stores all steps including non-agent types in dagSteps", () => {
    const state = createInitialState();
    const next = reduceEvent(state, makeEvent("flow_started", {
      flowName: "complex-flow",
      task: "Test",
      steps: [
        { id: "generate", stepType: "agent", agent: "generator", blockedBy: [] },
        { id: "pick-style", stepType: "fork", blockedBy: ["generate"] },
        { id: "branch-a", stepType: "agent", agent: "transformer", blockedBy: ["pick-style"] },
        { id: "branch-b", stepType: "agent", agent: "transformer", blockedBy: ["pick-style"] },
        { id: "validate", stepType: "agent", agent: "validator", blockedBy: ["branch-a", "branch-b"] },
        { id: "loop-check", stepType: "agent-loop-decision", agent: "checker", blockedBy: ["validate"] },
      ],
    }));
    // dagSteps should have ALL 6 steps
    expect(next.flowState!.dagSteps).toHaveLength(6);
    expect(next.flowState!.dagSteps![0].id).toBe("generate");
    expect(next.flowState!.dagSteps![1].stepType).toBe("fork");
    expect(next.flowState!.dagSteps![5].stepType).toBe("agent-loop-decision");
    // agents map keyed by step ID — all steps with an agent field (fork without agent excluded)
    expect(next.flowState!.agents.size).toBe(5); // generate, branch-a, branch-b, validate, loop-check
    expect(next.flowState!.agents.has("generate")).toBe(true);
    expect(next.flowState!.agents.has("loop-check")).toBe(true);
    expect(next.flowState!.agents.get("loop-check")!.agentName).toBe("checker");
    // stepType is populated from dagSteps
    expect(next.flowState!.agents.get("generate")!.stepType).toBe("agent");
    expect(next.flowState!.agents.get("loop-check")!.stepType).toBe("agent-loop-decision");
    expect(next.flowState!.agents.get("branch-a")!.stepType).toBe("agent");
  });

  it("dagSteps preserves blockedBy for non-agent steps", () => {
    const state = createInitialState();
    const next = reduceEvent(state, makeEvent("flow_started", {
      flowName: "fork-flow",
      task: "Test",
      steps: [
        { id: "init", stepType: "agent", agent: "initializer", blockedBy: [] },
        { id: "fork1", stepType: "fork", blockedBy: ["init"] },
        { id: "a", stepType: "agent", agent: "worker-a", blockedBy: ["fork1"] },
      ],
    }));
    expect(next.flowState!.dagSteps![1].id).toBe("fork1");
    expect(next.flowState!.dagSteps![1].blockedBy).toEqual(["init"]);
  });
});

describe("prompt bus — no suppression needed", () => {
  // The PromptBus ensures each prompt is sent to the dashboard exactly once
  // with the correct component. Client-side suppression logic has been removed.

  it("allows all prompts through (no architect suppression)", () => {
    let state = createInitialState();
    let archState = reduceArchitectEvent(null, makeEvent("architect_started", { mode: "new", iteration: 1 }));
    state = { ...state, architectState: archState };

    // All prompt types are allowed through — the bus prevents duplicates server-side
    const next = addInteractiveRequest(state, "req-1", "select", {
      title: "What would you like to do?",
      options: ["Save", "Replan", "Cancel"],
    });
    expect(next.interactiveRequests).toHaveLength(1);
  });

  it("deduplicates by requestId", () => {
    let state = createInitialState();
    state = addInteractiveRequest(state, "req-1", "select", { title: "Pick:" });
    state = addInteractiveRequest(state, "req-1", "select", { title: "Pick:" });
    expect(state.interactiveRequests).toHaveLength(1);
  });

  it("allows prompts without architectState", () => {
    const state = createInitialState();
    const next = addInteractiveRequest(state, "req-3", "select", {
      title: "What would you like to do?",
      options: ["Save", "Cancel"],
    });
    expect(next.interactiveRequests).toHaveLength(1);
  });
});
