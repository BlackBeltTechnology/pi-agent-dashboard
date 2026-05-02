import { describe, it, expect } from "vitest";
import { isArchitectEvent, reduceArchitectEvent } from "../architect-reducer.js";
import type { DashboardEvent, ArchitectState } from "@blackbelt-technology/pi-dashboard-shared/types.js";

function makeEvent(eventType: string, data: Record<string, unknown> = {}): DashboardEvent {
  return { eventType, timestamp: Date.now(), data };
}

describe("isArchitectEvent", () => {
  it("returns true for architect_ prefixed events", () => {
    expect(isArchitectEvent("architect_started")).toBe(true);
    expect(isArchitectEvent("architect_tool_call")).toBe(true);
    expect(isArchitectEvent("architect_complete")).toBe(true);
  });

  it("returns false for non-architect events", () => {
    expect(isArchitectEvent("flow_started")).toBe(false);
    expect(isArchitectEvent("agent_start")).toBe(false);
    expect(isArchitectEvent("tool_execution_start")).toBe(false);
  });
});

describe("architect-reducer state transitions", () => {
  it("full lifecycle: context → designing → preview → complete", () => {
    // Context generating
    let state = reduceArchitectEvent(null, makeEvent("architect_context_generating", { mode: "new" }));
    expect(state).not.toBeNull();
    expect(state!.phase).toBe("context");
    expect(state!.architectMode).toBe("new");

    // Architect started
    state = reduceArchitectEvent(state, makeEvent("architect_started", { mode: "new", iteration: 1 }));
    expect(state!.phase).toBe("designing");
    expect(state!.iteration).toBe(1);

    // Tool call: agent_catalog
    state = reduceArchitectEvent(state, makeEvent("architect_tool_call", {
      toolName: "agent_catalog",
      input: {},
    }));
    expect(state!.lastToolCall).toEqual({ toolName: "agent_catalog", inputPreview: "{}" });
    expect(state!.catalogSummary).toBe("Reading catalog…");
    expect(state!.recentTools).toHaveLength(1);
    expect(state!.detailHistory).toHaveLength(1);
    expect(state!.detailHistory[0].kind).toBe("tool");

    // Tool result: agent_catalog
    state = reduceArchitectEvent(state, makeEvent("architect_tool_result", {
      toolName: "agent_catalog",
      output: JSON.stringify([{ name: "a1" }, { name: "a2" }]),
      isError: false,
    }));
    expect(state!.catalogSummary).toBe("Catalog: 2 agents");
    // Detail history entry should have output filled in
    expect((state!.detailHistory[0] as any).output).toBeDefined();

    // Tool call: agent_write
    state = reduceArchitectEvent(state, makeEvent("architect_tool_call", {
      toolName: "agent_write",
      input: { path: "/tmp/agents/reviewer.md", content: "name: reviewer\n" },
    }));
    expect(state!.agents).toHaveLength(1);
    expect(state!.agents[0].name).toBe("reviewer");
    expect(state!.agents[0].status).toBe("creating");
    expect(state!.agents[0].type).toBe("custom");

    // Tool result: agent_write
    state = reduceArchitectEvent(state, makeEvent("architect_tool_result", {
      toolName: "agent_write",
      output: "ok",
      isError: false,
    }));
    expect(state!.agents[0].status).toBe("done");

    // Tool call: flow_write
    state = reduceArchitectEvent(state, makeEvent("architect_tool_call", {
      toolName: "flow_write",
      input: {
        path: "/tmp/flows/test.yaml",
        content: "name: test-flow\nsteps:\n  - id: analyze\n    agent: analyzer\n  - id: report\n    agent: reviewer\n    blockedBy: [analyze]\n",
      },
    }));
    expect(state!.flowName).toBe("test-flow");
    expect(state!.dagSteps.length).toBeGreaterThanOrEqual(2);
    expect(state!.dagSteps[0].id).toBe("analyze");

    // Preview
    state = reduceArchitectEvent(state, makeEvent("architect_preview", {
      parsedFlows: [{
        name: "test-flow",
        description: "A test",
        maxConcurrent: 2,
        steps: [
          { id: "analyze", agentName: "analyzer", blockedBy: [] },
          { id: "report", agentName: "reviewer", blockedBy: ["analyze"] },
        ],
      }],
      flowPath: "/tmp/flows/test.yaml",
      createdFiles: ["/tmp/flows/test.yaml"],
    }));
    expect(state!.phase).toBe("preview");
    expect(state!.parsedFlows).toHaveLength(1);
    expect(state!.parsedFlows[0].steps).toHaveLength(2);

    // Complete
    state = reduceArchitectEvent(state, makeEvent("architect_complete", { choice: "save" }));
    expect(state).toBeNull();
  });

  it("extracts blockedBy from camelCase YAML (pi-flows format)", () => {
    let state = reduceArchitectEvent(null, makeEvent("architect_context_generating", { mode: "new" }));
    state = reduceArchitectEvent(state, makeEvent("architect_started", { mode: "new", iteration: 1 }));
    state = reduceArchitectEvent(state, makeEvent("architect_tool_call", {
      toolName: "flow_write",
      input: {
        path: "/tmp/flows/pipeline.yaml",
        content: "name: pipeline\nsteps:\n  - id: researcher\n    agent: test-researcher\n  - id: summarizer\n    agent: test-summarizer\n    blockedBy: [researcher]\n",
      },
    }));
    expect(state!.dagSteps).toHaveLength(2);
    expect(state!.dagSteps[0].blockedBy).toEqual([]);
    expect(state!.dagSteps[1].blockedBy).toEqual(["researcher"]);
  });

  it("architect_started captures resolvedModel and modelAlias", () => {
    let state = reduceArchitectEvent(null, makeEvent("architect_context_generating", { mode: "new" }));
    state = reduceArchitectEvent(state, makeEvent("architect_started", {
      mode: "new",
      iteration: 1,
      resolvedModel: "anthropic/claude-opus-4-6",
      modelAlias: "@planning",
    }));
    expect(state!.resolvedModel).toBe("anthropic/claude-opus-4-6");
    expect(state!.modelAlias).toBe("@planning");
  });

  it("architect_started without model fields leaves them undefined", () => {
    const state = reduceArchitectEvent(null, makeEvent("architect_started", { mode: "new", iteration: 1 }));
    expect(state!.resolvedModel).toBeUndefined();
    expect(state!.modelAlias).toBeUndefined();
  });

  it("architect_started without prior context_generating creates fresh state", () => {
    const state = reduceArchitectEvent(null, makeEvent("architect_started", { mode: "edit", iteration: 1 }));
    expect(state).not.toBeNull();
    expect(state!.phase).toBe("designing");
    expect(state!.architectMode).toBe("edit");
  });

  it("architect_cancelled clears state", () => {
    let state = reduceArchitectEvent(null, makeEvent("architect_started", { mode: "new", iteration: 1 }));
    state = reduceArchitectEvent(state, makeEvent("architect_cancelled", {}));
    expect(state).toBeNull();
  });

  it("architect_error stores error message", () => {
    let state = reduceArchitectEvent(null, makeEvent("architect_started", { mode: "new", iteration: 1 }));
    state = reduceArchitectEvent(state, makeEvent("architect_error", { summary: "Something broke" }));
    expect(state!.error).toBe("Something broke");
  });

  it("architect_run_handoff clears state", () => {
    let state = reduceArchitectEvent(null, makeEvent("architect_started", { mode: "new", iteration: 1 }));
    state = reduceArchitectEvent(state, makeEvent("architect_run_handoff", { flowName: "test" }));
    expect(state).toBeNull();
  });
});

describe("architect-reducer replan loop", () => {
  it("replan resets state with incremented iteration", () => {
    // Start
    let state = reduceArchitectEvent(null, makeEvent("architect_started", { mode: "new", iteration: 1 }));
    expect(state!.iteration).toBe(1);

    // Add some agents
    state = reduceArchitectEvent(state, makeEvent("architect_tool_call", {
      toolName: "agent_write",
      input: { path: "/tmp/agents/a.md" },
    }));
    expect(state!.agents).toHaveLength(1);

    // Replan
    state = reduceArchitectEvent(state, makeEvent("architect_replan", { iteration: 2, notes: "change X" }));
    expect(state!.phase).toBe("designing");
    expect(state!.iteration).toBe(2);
    expect(state!.agents).toHaveLength(0); // reset
    expect(state!.dagSteps).toHaveLength(0); // reset
    expect(state!.lastToolCall).toBeNull(); // reset
    expect(state!.recentTools).toHaveLength(0); // reset
    expect(state!.detailHistory).toHaveLength(0); // reset

    // Second iteration: new agents
    state = reduceArchitectEvent(state, makeEvent("architect_tool_call", {
      toolName: "agent_write",
      input: { path: "/tmp/agents/b.md" },
    }));
    expect(state!.agents).toHaveLength(1);
    expect(state!.agents[0].name).toBe("b");

    // Complete
    state = reduceArchitectEvent(state, makeEvent("architect_complete", { choice: "save" }));
    expect(state).toBeNull();
  });

  it("multiple replans increment correctly", () => {
    let state = reduceArchitectEvent(null, makeEvent("architect_started", { mode: "edit", iteration: 1 }));
    state = reduceArchitectEvent(state, makeEvent("architect_replan", { iteration: 2 }));
    expect(state!.iteration).toBe(2);
    state = reduceArchitectEvent(state, makeEvent("architect_replan", { iteration: 3 }));
    expect(state!.iteration).toBe(3);
  });
});

describe("architect-reducer prompt handling", () => {
  it("architect_prompt_request sets pendingPrompt", () => {
    let state = reduceArchitectEvent(null, makeEvent("architect_started", { mode: "new", iteration: 1 }));
    expect(state!.pendingPrompt).toBeNull();

    state = reduceArchitectEvent(state, makeEvent("architect_prompt_request", {
      id: "prompt-1",
      promptType: "select",
      question: "What would you like to do?",
      options: ["Save", "Replan", "Cancel"],
    }));
    expect(state!.pendingPrompt).not.toBeNull();
    expect(state!.pendingPrompt!.id).toBe("prompt-1");
    expect(state!.pendingPrompt!.type).toBe("select");
    expect(state!.pendingPrompt!.question).toBe("What would you like to do?");
    expect(state!.pendingPrompt!.options).toEqual(["Save", "Replan", "Cancel"]);
  });

  it("architect_prompt_request with input type and defaultValue", () => {
    let state = reduceArchitectEvent(null, makeEvent("architect_started", { mode: "edit", iteration: 1 }));
    state = reduceArchitectEvent(state, makeEvent("architect_prompt_request", {
      id: "prompt-2",
      promptType: "input",
      question: "Name this flow:",
      defaultValue: "my-flow",
    }));
    expect(state!.pendingPrompt!.type).toBe("input");
    expect(state!.pendingPrompt!.defaultValue).toBe("my-flow");
  });

  it("architect_prompt_request without state returns null", () => {
    const state = reduceArchitectEvent(null, makeEvent("architect_prompt_request", {
      id: "prompt-3",
      promptType: "select",
      question: "test?",
    }));
    expect(state).toBeNull();
  });

  it("pendingPrompt is cleared on architect_complete", () => {
    let state = reduceArchitectEvent(null, makeEvent("architect_started", { mode: "new", iteration: 1 }));
    state = reduceArchitectEvent(state, makeEvent("architect_prompt_request", {
      id: "prompt-4", promptType: "select", question: "Save?", options: ["Save", "Cancel"],
    }));
    expect(state!.pendingPrompt).not.toBeNull();
    state = reduceArchitectEvent(state, makeEvent("architect_complete", {}));
    expect(state).toBeNull(); // entire state cleared
  });

  it("pendingPrompt is cleared on architect_cancelled", () => {
    let state = reduceArchitectEvent(null, makeEvent("architect_started", { mode: "new", iteration: 1 }));
    state = reduceArchitectEvent(state, makeEvent("architect_prompt_request", {
      id: "prompt-5", promptType: "select", question: "Save?", options: ["Save", "Cancel"],
    }));
    state = reduceArchitectEvent(state, makeEvent("architect_cancelled", {}));
    expect(state).toBeNull();
  });

  it("pendingPrompt is cleared on architect_replan", () => {
    let state = reduceArchitectEvent(null, makeEvent("architect_started", { mode: "new", iteration: 1 }));
    state = reduceArchitectEvent(state, makeEvent("architect_prompt_request", {
      id: "prompt-6", promptType: "select", question: "Save?", options: ["Save", "Cancel"],
    }));
    expect(state!.pendingPrompt).not.toBeNull();
    state = reduceArchitectEvent(state, makeEvent("architect_replan", { iteration: 2 }));
    expect(state!.pendingPrompt).toBeNull();
  });

  it("architect_preview stores flowYamlContent", () => {
    let state = reduceArchitectEvent(null, makeEvent("architect_started", { mode: "new", iteration: 1 }));
    state = reduceArchitectEvent(state, makeEvent("architect_preview", {
      flows: [{ name: "test.yaml", content: "name: test-flow\nsteps:\n  - id: a\n    agent: analyzer" }],
      parsedFlows: [{ name: "test-flow", steps: [{ id: "a", agentName: "analyzer", blockedBy: [] }] }],
    }));
    expect(state!.flowYamlContent).toBe("name: test-flow\nsteps:\n  - id: a\n    agent: analyzer");
  });

  it("architect_preview without flows has no flowYamlContent", () => {
    let state = reduceArchitectEvent(null, makeEvent("architect_started", { mode: "new", iteration: 1 }));
    state = reduceArchitectEvent(state, makeEvent("architect_preview", {
      parsedFlows: [{ name: "test-flow", steps: [] }],
    }));
    expect(state!.flowYamlContent).toBeUndefined();
  });

  it("pendingPrompt is cleared on architect_started (new iteration)", () => {
    let state = reduceArchitectEvent(null, makeEvent("architect_started", { mode: "new", iteration: 1 }));
    state = reduceArchitectEvent(state, makeEvent("architect_prompt_request", {
      id: "prompt-7", promptType: "select", question: "Save?", options: ["Save"],
    }));
    state = reduceArchitectEvent(state, makeEvent("architect_started", { mode: "new", iteration: 2 }));
    expect(state!.pendingPrompt).toBeNull();
  });
});
