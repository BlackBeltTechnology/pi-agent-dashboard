/**
 * Faux-model client-side renderer integration test.
 *
 * Feeds the SAME faux scenario catalog (`qa/fixtures/faux-scenarios.ts`) the
 * server suite uses into a real `ChatView`, with no pi subprocess. Each scenario's
 * faux `script` (a `fauxToolCall(...)` / `fauxToolCall("ask_user", { method })`)
 * is translated into the `ChatMessage` shape `ChatView` consumes, then asserted:
 *
 * - every tool name in `tool-renderers/registry.ts` dispatches to its mapped
 *   renderer (unknown → `GenericToolRenderer`);
 * - every `ask_user` method dispatches to its interactive renderer
 *   (unknown → `GenericInteractiveRenderer`);
 * - `ChatView` mounts each renderer with the real faux args without crashing.
 *
 * The dispatch-identity assertions test `registry.ts` directly (the mapping the
 * spec scenarios name); the `ChatView` render proves the mapped renderer mounts
 * with real faux data. The test never modifies renderer/registry source.
 *
 * §3.4 (ask_user answer round-trip, scenario `ask-select-roundtrip`) lives in the
 * server suite (`packages/server/src/__tests__/faux-session.integration.test.ts`)
 * because the answer-submit path (`prompt_response` over `/ws`) is server-mediated.
 *
 * See change: add-faux-model-integration-tests.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import { ChatView } from "../chat/ChatView.js";
import { ThemeProvider } from "../settings/ThemeProvider.js";
import { createInitialState } from "../../lib/chat/event-reducer.js";
import type { SessionState } from "../../lib/chat/event-reducer.js";
import type { ToolContext } from "../tool-renderers/index.js";
import { getToolRenderer } from "../tool-renderers/registry.js";
import { ReadToolRenderer } from "../tool-renderers/ReadToolRenderer.js";
import { EditToolRenderer } from "../tool-renderers/EditToolRenderer.js";
import { WriteToolRenderer } from "../tool-renderers/WriteToolRenderer.js";
import { BashToolRenderer } from "../tool-renderers/BashToolRenderer.js";
import { AgentToolRenderer } from "../tool-renderers/AgentToolRenderer.js";
import { CtxToolRenderer } from "../tool-renderers/CtxToolRenderer.js";
import { GenericToolRenderer } from "../tool-renderers/GenericToolRenderer.js";
import { AskUserToolRenderer } from "../tool-renderers/AskUserToolRenderer.js";
import { getInteractiveRenderer } from "../interactive-renderers/registry.js";
import { ConfirmRenderer } from "../interactive-renderers/ConfirmRenderer.js";
import { SelectRenderer } from "../interactive-renderers/SelectRenderer.js";
import { InputRenderer } from "../interactive-renderers/InputRenderer.js";
import { EditorRenderer } from "../interactive-renderers/EditorRenderer.js";
import { MultiselectRenderer } from "../interactive-renderers/MultiselectRenderer.js";
import { NotifyRenderer } from "../interactive-renderers/NotifyRenderer.js";
import { BatchRenderer } from "../interactive-renderers/BatchRenderer.js";
import { GenericInteractiveRenderer } from "../interactive-renderers/GenericInteractiveRenderer.js";
import { SCENARIOS, type Scenario, type MiniToolCall } from "../../../../../qa/fixtures/faux-scenarios.js";

const defaultToolContext: ToolContext = {};

beforeAll(() => {
  Element.prototype.scrollTo = () => {};
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === "(prefers-color-scheme: dark)",
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});

/** Pull the tool calls out of a scenario's first scripted assistant message. */
function toolCallsOf(scenario: Scenario): MiniToolCall[] {
  const first = scenario.script[0];
  if (typeof first === "function") return [];
  const content = (first as { content?: Array<{ type: string }> }).content ?? [];
  return content.filter((b): b is MiniToolCall => b.type === "toolCall");
}

/** Build a ChatView state whose single message is a completed tool call. */
function stateForToolScenario(scenario: Scenario): SessionState {
  const state = createInitialState();
  const call = toolCallsOf(scenario)[0];
  state.messages.push({
    id: `tool-${call.id}`,
    role: "toolResult",
    content: call.name,
    toolName: call.name,
    toolCallId: call.id,
    args: call.arguments as Record<string, unknown>,
    toolStatus: "complete",
    result: "(faux result)",
    timestamp: Date.now(),
  });
  return state;
}

/** Build a ChatView state whose single message is a pending ask_user prompt. */
function stateForAskScenario(scenario: Scenario): { state: SessionState; method: string } {
  const call = toolCallsOf(scenario)[0];
  const params = call.arguments as Record<string, unknown>;
  const method = String(params.method);
  const state = createInitialState();
  state.messages.push({
    id: `ui-${call.id}`,
    role: "interactiveUi",
    content: "",
    args: {
      requestId: call.id,
      method,
      params: { question: params.title ?? "?", ...params },
      status: "pending",
    },
    timestamp: Date.now(),
  });
  return { state, method };
}

function renderChat(state: SessionState) {
  return render(
    <ThemeProvider>
      <ChatView sessionId="faux" state={state} toolContext={defaultToolContext} onRespondToUi={vi.fn()} />
    </ThemeProvider>,
  );
}

describe("faux renderer matrix — tool renderers (§3.2)", () => {
  const cases: Array<[scenarioId: string, expected: React.ComponentType<any>]> = [
    ["tool-read", ReadToolRenderer],
    ["tool-edit", EditToolRenderer],
    ["tool-write", WriteToolRenderer],
    ["tool-bash", BashToolRenderer],
    ["tool-ctx", CtxToolRenderer],
    ["tool-agent", AgentToolRenderer],
    ["tool-unknown", GenericToolRenderer],
  ];

  for (const [scenarioId, expected] of cases) {
    it(`${scenarioId} dispatches to ${expected.name} and mounts in ChatView`, () => {
      const scenario = SCENARIOS[scenarioId];
      const call = toolCallsOf(scenario)[0];

      // Registry maps the faux tool name to the expected renderer.
      expect(getToolRenderer(call.name)).toBe(expected);

      // ChatView mounts that renderer with the real faux args.
      const { container } = renderChat(stateForToolScenario(scenario));
      expect(container.textContent ?? "").not.toBe("");
    });
  }

  it("covers every registered tool name", () => {
    const covered = new Set(cases.map(([id]) => SCENARIOS[id] && toolCallsOf(SCENARIOS[id])[0]?.name));
    for (const name of ["read", "edit", "write", "bash", "Agent", "ctx_execute"]) {
      expect(covered.has(name)).toBe(true);
    }
  });

  it("ask_user dispatches to AskUserToolRenderer (interactive methods asserted below)", () => {
    // ask_user is in tool-renderers/registry.ts; the per-method interactive
    // matrix (§3.3) covers the rendering it delegates to.
    expect(getToolRenderer("ask_user")).toBe(AskUserToolRenderer);
  });
});

describe("faux renderer matrix — interactive renderers (§3.3)", () => {
  const cases: Array<[scenarioId: string, method: string, expected: React.ComponentType<any>]> = [
    ["ask-confirm", "confirm", ConfirmRenderer],
    ["ask-select", "select", SelectRenderer],
    ["ask-multiselect", "multiselect", MultiselectRenderer],
    ["ask-input", "input", InputRenderer],
    ["ask-editor", "editor", EditorRenderer],
    ["ask-batch", "batch", BatchRenderer],
    ["ask-notify", "notify", NotifyRenderer],
    ["ask-unknown-method", "totally-unknown-method", GenericInteractiveRenderer],
  ];

  for (const [scenarioId, method, expected] of cases) {
    it(`${scenarioId} (method=${method}) dispatches to ${expected.name} and mounts in ChatView`, () => {
      const scenario = SCENARIOS[scenarioId];
      const built = stateForAskScenario(scenario);
      expect(built.method).toBe(method);

      // Registry maps the ask_user method to the expected interactive renderer.
      expect(getInteractiveRenderer(method)).toBe(expected);

      // ChatView mounts that interactive renderer with the real faux params.
      const { container } = renderChat(built.state);
      expect(container.textContent ?? "").not.toBe("");
    });
  }
});
