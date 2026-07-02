/**
 * Tests for the flow_write / flow_agents authoring tool renderers.
 * Covers success, validation-failure, and list states + the args-backed
 * Mermaid snapshot. See change: rework-flows-plugin-for-new-pi-flows.
 */
import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import {
  UiPrimitiveProvider,
  createUiPrimitiveRegistry,
  registerUiPrimitive,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import { FlowWriteToolRenderer } from "../client/FlowWriteToolRenderer.js";
import { FlowAgentsToolRenderer } from "../client/FlowAgentsToolRenderer.js";

const registry = createUiPrimitiveRegistry();
registerUiPrimitive(
  registry,
  UI_PRIMITIVE_KEYS.markdownContent,
  (({ content }: { content: string }) => <div data-testid="md">{content}</div>) as never,
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

afterEach(() => cleanup());

describe("FlowWriteToolRenderer", () => {
  it("success: shows command, counts, and a Mermaid snapshot from args", () => {
    const { getByText, getByTestId } = renderWrite({
      toolInput: { name: "invoice", content: FLOW_YAML },
      status: "complete",
      result: JSON.stringify({ written: true, name: "invoice", namespace: "custom", command: "custom:invoice", path: "/p/invoice.yaml", diagnostics: [] }),
    });
    expect(getByText("/custom:invoice")).toBeTruthy();
    expect(getByText("2 steps · 1 agents, 1 code")).toBeTruthy();
    expect(getByTestId("md").textContent).toContain("graph LR");
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
