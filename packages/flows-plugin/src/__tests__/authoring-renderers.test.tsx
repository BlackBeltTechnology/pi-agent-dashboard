/**
 * Tests for the flow_write / flow_agents authoring tool renderers.
 * Covers success, validation-failure, and list states + the args-backed
 * shared `FlowGraph` (not-started pipeline, lenient). See changes:
 * rework-flows-plugin-for-new-pi-flows, unify-flow-rendering (D4).
 */
import React from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import {
  UiPrimitiveProvider,
  createUiPrimitiveRegistry,
  registerUiPrimitive,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import { FlowWriteToolRenderer } from "../client/FlowWriteToolRenderer.js";
import { FlowAgentsToolRenderer } from "../client/FlowAgentsToolRenderer.js";
import { FLOW_SHOW_ERROR_ROUTES_KEY } from "../client/flow-collapse-storage.js";
import { useIsolatedLocalStorage } from "./flows-test-harness.js";

useIsolatedLocalStorage();

const markdownSpy = vi.fn();
const registry = createUiPrimitiveRegistry();
registerUiPrimitive(
  registry,
  UI_PRIMITIVE_KEYS.markdownContent,
  (({ content }: { content: string }) => {
    markdownSpy(content);
    return <div data-testid="md">{content}</div>;
  }) as never,
);
registerUiPrimitive(registry, UI_PRIMITIVE_KEYS.zoomControls, (() => null) as never);
registerUiPrimitive(
  registry,
  UI_PRIMITIVE_KEYS.dialog,
  (({ open, size, children }: { open: boolean; size?: string; children?: React.ReactNode }) =>
    open ? <div data-testid="dialog" data-size={size}>{children}</div> : null) as never,
);

function renderWrite(props: { toolInput: Record<string, unknown>; status?: "running" | "complete" | "error"; result?: string }) {
  return render(
    <UiPrimitiveProvider value={registry}>
      <FlowWriteToolRenderer toolName="flow_write" sessionId="s1" {...props} />
    </UiPrimitiveProvider>,
  );
}

const FLOW_YAML = `name: invoice
steps:
  - id: extract
    type: agent
    agent: e
    blockedBy: []
  - id: validate
    type: code
    blockedBy: [extract]`;

const OK = JSON.stringify({ written: true, name: "t", namespace: "custom", command: "custom:t", path: "/p/t.yaml", diagnostics: [] });

const nodeIds = (root: ParentNode = document) =>
  Array.from(root.querySelectorAll("[data-node]")).map((n) => n.getAttribute("data-node")).sort();
const edgeIds = (root: ParentNode = document) =>
  Array.from(root.querySelectorAll("[data-edge]")).map((n) => n.getAttribute("data-edge")).sort();

beforeEach(() => {
  localStorage.clear();
  markdownSpy.mockClear();
});
afterEach(() => cleanup());

describe("FlowWriteToolRenderer", () => {
  it("success: shows command, counts, and the shared flow graph from args", () => {
    const { getByText } = renderWrite({
      toolInput: { name: "invoice", content: FLOW_YAML },
      status: "complete",
      result: JSON.stringify({ written: true, name: "invoice", namespace: "custom", command: "custom:invoice", path: "/p/invoice.yaml", diagnostics: [] }),
    });
    expect(getByText("/custom:invoice")).toBeTruthy();
    expect(getByText("2 steps · 1 agents, 1 code")).toBeTruthy();
    expect(nodeIds()).toEqual(["extract", "validate"]);
  });

  it("validation failure: renders diagnostics verbatim", () => {
    const { getByText } = renderWrite({
      toolInput: { name: "invoice", content: FLOW_YAML },
      status: "error",
      result: JSON.stringify({ written: false, diagnostics: [{ message: 'step "validate" missing' }] }),
    });
    expect(getByText(/step "validate" missing/)).toBeTruthy();
  });

  it("view-yaml toggle reveals the submitted args", () => {
    const { getByText, queryByText } = renderWrite({
      toolInput: { name: "invoice", content: FLOW_YAML },
      status: "complete",
      result: JSON.stringify({ written: true, command: "custom:invoice", diagnostics: [] }),
    });
    expect(queryByText(/type: code/)).toBeNull();
    fireEvent.click(getByText(/View flow YAML/));
    expect(getByText(/type: code/)).toBeTruthy();
  });

  it("E1: tolerates YAML the strict parser would reject (no description, untyped step)", () => {
    const { getByText } = renderWrite({
      toolInput: { content: "name: t\nsteps:\n  - id: a\n  - id: b\n    type: code\n" },
      status: "complete",
      result: OK,
    });
    expect(nodeIds()).toEqual(["a", "b"]);
    expect(getByText("2 steps · 1 agents, 1 code").textContent).toBe("2 steps · 1 agents, 1 code");
  });

  it("E2: invalid steps are skipped", () => {
    const { getByText } = renderWrite({
      toolInput: { content: "name: t\nsteps:\n  - { id: a, type: agent, agent: x }\n  - { type: code }\n  - { id: c, type: code }\n" },
      status: "complete",
      result: OK,
    });
    expect(nodeIds()).toEqual(["a", "c"]);
    expect(getByText(/^2 steps/).textContent).toMatch(/^2 steps · /);
  });

  it("E3: empty steps degrade to no graph, no counts", () => {
    const { getByText } = renderWrite({ toolInput: { content: "name: t\nsteps: []" }, status: "complete", result: OK });
    expect(nodeIds()).toEqual([]);
    expect(document.body.textContent).not.toMatch(/steps ·/);
    expect(getByText("/custom:t").textContent).toBe("/custom:t");
    expect(getByText("registered").textContent).toBe("registered");
  });

  it("E4: unparseable YAML degrades without throwing", () => {
    const { getByText } = renderWrite({ toolInput: { content: "::: not yaml [" }, status: "complete", result: OK });
    expect(nodeIds()).toEqual([]);
    expect(document.body.textContent).not.toMatch(/steps ·/);
    expect(getByText("/custom:t").textContent).toBe("/custom:t");
  });

  it("E5: only a successful write draws a graph", () => {
    const { getByText } = renderWrite({
      toolInput: { content: FLOW_YAML },
      status: "complete",
      result: JSON.stringify({ written: false, diagnostics: ["bad"] }),
    });
    expect(nodeIds()).toEqual([]);
    expect(getByText("not written — validation failed").textContent).toBe("not written — validation failed");
    expect(getByText("bad").textContent).toBe("bad");
  });

  it("E6: object-form branches draw their edge on the card", () => {
    renderWrite({
      toolInput: {
        content: "name: t\nsteps:\n  - id: gate\n    type: code-decision\n    branches:\n      fix: { to: fix, means: bug }\n  - id: fix\n    type: agent\n    agent: a\n",
      },
      status: "complete",
      result: OK,
    });
    expect(edgeIds()).toContain("gate>fix");
    expect(nodeIds()).not.toContain("[object Object]");
  });

  it("E9: counts come from the step list (untyped counts as agent, fork in neither)", () => {
    const yaml = [
      "name: t",
      "steps:",
      "  - { id: s1, type: agent, agent: a }",
      "  - { id: s2, type: agent-decision, agent: a, task: t, branches: { x: s4 } }",
      "  - { id: s3, type: fork, question: q, options: [x], branches: { x: s4 } }",
      "  - { id: s4, type: code }",
      "  - { id: s5, type: code-decision, branches: { y: s6 } }",
      "  - { id: s6 }",
    ].join("\n");
    const { getByText } = renderWrite({ toolInput: { content: yaml }, status: "complete", result: OK });
    expect(getByText("6 steps · 3 agents, 2 code").textContent).toBe("6 steps · 3 agents, 2 code");
  });

  it("E12: no Mermaid output; graph nodes present", () => {
    const { container } = renderWrite({ toolInput: { content: FLOW_YAML }, status: "complete", result: OK });
    expect(container.querySelectorAll(".language-mermaid")).toHaveLength(0);
    expect(markdownSpy).not.toHaveBeenCalled();
    expect(nodeIds().length).toBeGreaterThan(0);
  });

  it("F11: a replayed (persisted) card rebuilds the same graph and counts", () => {
    const props = { toolInput: { content: FLOW_YAML }, status: "complete" as const, result: OK };
    const live = renderWrite(props);
    const liveNodes = nodeIds();
    const liveText = live.container.textContent;
    cleanup();
    // Persisted entries are plain JSON round-trips of the same props.
    renderWrite(JSON.parse(JSON.stringify(props)));
    expect(nodeIds()).toEqual(liveNodes);
    expect(document.body.textContent).toBe(liveText);
  });

  it("F12: the card follows the shared error-route toggle", () => {
    const yaml = "name: t\nsteps:\n  - { id: a, type: agent, agent: x, on_error: fixup }\n  - { id: b, type: agent, agent: y, blockedBy: [a] }\n  - { id: fixup, type: agent, agent: z }\n";
    const { getByTitle } = renderWrite({ toolInput: { content: yaml }, status: "complete", result: OK });
    const errorEdges = () => document.querySelectorAll('[data-edge-kind="on_error"]').length;
    expect(errorEdges()).toBe(0);
    fireEvent.click(getByTitle("Show error routes"));
    expect(errorEdges()).toBeGreaterThan(0);
    expect(localStorage.getItem(FLOW_SHOW_ERROR_ROUTES_KEY)).toBe("true");
  });

  it("F13: expand opens a full-size dialog with a non-fit graph", () => {
    const { getByTitle, getByTestId } = renderWrite({ toolInput: { content: FLOW_YAML }, status: "complete", result: OK });
    fireEvent.click(getByTitle("Expand graph"));
    const dialog = getByTestId("dialog");
    expect(dialog.getAttribute("data-size")).toBe("full");
    expect(nodeIds(dialog)).toEqual(["extract", "validate"]);
    // The dialog graph is not `fit`: it carries no ⤢ expand button of its own.
    expect(dialog.querySelectorAll('[title="Expand graph"]')).toHaveLength(0);
  });
});

describe("FlowAgentsToolRenderer", () => {
  it("list: shows agent names + count (as rows)", () => {
    const { getByText } = render(
      <FlowAgentsToolRenderer toolName="flow_agents" sessionId="s1"
        toolInput={{ op: "list" }} status="complete"
        result={JSON.stringify([{ name: "reviewer" }, { name: "reader" }])} />,
    );
    expect(getByText("list · 2 agents")).toBeTruthy();
    expect(getByText("reviewer")).toBeTruthy();
    expect(getByText("reader")).toBeTruthy();
  });

  it("write success: shows saved name", () => {
    const { getByText } = render(
      <FlowAgentsToolRenderer toolName="flow_agents" sessionId="s1"
        toolInput={{ op: "write", content: "name: reviewer" }} status="complete"
        result={JSON.stringify({ written: true, name: "reviewer", path: "/a/reviewer.md", diagnostics: [] })} />,
    );
    expect(getByText("reviewer")).toBeTruthy();
    expect(getByText("saved")).toBeTruthy();
  });

  it("write failure: shows diagnostics", () => {
    const { getByText } = render(
      <FlowAgentsToolRenderer toolName="flow_agents" sessionId="s1"
        toolInput={{ op: "write", content: "bad" }} status="error"
        result={JSON.stringify({ written: false, error: "missing name" })} />,
    );
    expect(getByText("not written")).toBeTruthy();
    expect(getByText(/missing name/)).toBeTruthy();
  });

  const AGENTS_DETAILS = [
    { name: "test-analyzer", description: "Emits a one-line note", source_type: "local", tools: ["read"], inputs: ["focus"], outputs: ["notes"], use_when: "parallel analysis branch" },
    { name: "flow-decision", description: "Decides at forks", source_type: "built-in" },
  ];

  it("list truncated (no details): does not report zero, shows truncated indicator", () => {
    const { queryByText, getByText } = render(
      <FlowAgentsToolRenderer toolName="flow_agents" sessionId="s1"
        toolInput={{ op: "list" }} status="complete"
        result={'«76 earlier lines hidden»\n    "source_type": "local"\n  }\n]'} />,
    );
    expect(queryByText(/·\s*0 agents/)).toBeNull();
    expect(getByText(/truncated/i)).toBeTruthy();
  });

  it("list details present + truncated text: renders rows (name+description+badge), no truncated", () => {
    const { getByText, queryByText } = render(
      <FlowAgentsToolRenderer toolName="flow_agents" sessionId="s1"
        toolInput={{ op: "list" }} status="complete"
        toolDetails={{ count: 2, agents: AGENTS_DETAILS }}
        result={'«76 earlier lines hidden»\n]'} />,
    );
    expect(getByText("list · 2 agents")).toBeTruthy();
    expect(getByText("test-analyzer")).toBeTruthy();
    expect(getByText("Emits a one-line note")).toBeTruthy();
    expect(getByText("flow-decision")).toBeTruthy();
    // source badges present
    expect(getByText("local")).toBeTruthy();
    expect(getByText("built-in")).toBeTruthy();
    expect(queryByText(/truncated/i)).toBeNull();
  });

  it("list rows are collapsed by default (no detail block until expand)", () => {
    const { queryByText } = render(
      <FlowAgentsToolRenderer toolName="flow_agents" sessionId="s1"
        toolInput={{ op: "list" }} status="complete"
        toolDetails={{ count: 2, agents: AGENTS_DETAILS }} result={"[]"} />,
    );
    // detail-only field values must not be visible before expanding
    expect(queryByText("focus")).toBeNull();
    expect(queryByText("parallel analysis branch")).toBeNull();
  });

  it("expanding a row reveals present fields and omits absent ones", () => {
    const { getByText, queryByText } = render(
      <FlowAgentsToolRenderer toolName="flow_agents" sessionId="s1"
        toolInput={{ op: "list" }} status="complete"
        toolDetails={{ count: 2, agents: AGENTS_DETAILS }} result={"[]"} />,
    );
    fireEvent.click(getByText("test-analyzer"));
    expect(getByText("read")).toBeTruthy();      // tools
    expect(getByText("focus")).toBeTruthy();     // inputs
    expect(getByText("notes")).toBeTruthy();     // outputs
    expect(getByText("parallel analysis branch")).toBeTruthy(); // use_when
    // flow-decision (no tools/inputs/outputs) — expand shows no such fields
    fireEvent.click(getByText("flow-decision"));
    // its use_when falls back to description; but tools/inputs/outputs absent
    expect(queryByText("grep")).toBeNull();
  });

  it("list text fallback (no details): renders rows from parsed text catalog", () => {
    const { getByText } = render(
      <FlowAgentsToolRenderer toolName="flow_agents" sessionId="s1"
        toolInput={{ op: "list" }} status="complete"
        result={JSON.stringify([{ name: "x", description: "the x", source_type: "local" }, { name: "y", description: "the y", source_type: "package" }])} />,
    );
    expect(getByText("list · 2 agents")).toBeTruthy();
    expect(getByText("x")).toBeTruthy();
    expect(getByText("the x")).toBeTruthy();
    expect(getByText("y")).toBeTruthy();
  });

  it("list genuine empty array: reports 0 agents", () => {
    const { getByText, queryByText } = render(
      <FlowAgentsToolRenderer toolName="flow_agents" sessionId="s1"
        toolInput={{ op: "list" }} status="complete" result={"[]"} />,
    );
    expect(getByText("list · 0 agents")).toBeTruthy();
    expect(queryByText(/truncated/i)).toBeNull();
  });
});
