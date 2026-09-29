/**
 * FlowAgentCard code-handler source open.
 *
 * Code / code-decision nodes carry `codeTarget` (the resolved .ts handler path,
 * emitted absolute by the flow runtime). The card renders an mdiCodeBraces
 * button; agent nodes with `sourcePath` a document button. Both open the file
 * in the host's built-in editor via `/session/:id/editor?file=<path>`
 * (wouter navigation), and are hidden without a session.
 * See change: open-code-handler-from-flow-card, attach-flow-before-run.
 */

import {
  createUiPrimitiveRegistry,
  registerUiPrimitive,
  UiPrimitiveProvider,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import type { FlowAgentState } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { FlowAgentCard } from "../client/FlowAgentCard.js";

const registry = createUiPrimitiveRegistry();

// AgentCardShell: render headerRight + children + forward onClick.
registerUiPrimitive(
  registry,
  UI_PRIMITIVE_KEYS.agentCard,
  (({ children, headerRight, onClick }: { children: React.ReactNode; headerRight?: React.ReactNode; onClick?: () => void }) => (
    <div data-testid="card" onClick={onClick}>
      <div>{headerRight}</div>
      {children}
    </div>
  )) as never,
);
registerUiPrimitive(registry, UI_PRIMITIVE_KEYS.formatTokens, ((n: number) => String(n)) as never);
registerUiPrimitive(registry, UI_PRIMITIVE_KEYS.formatDuration, ((n: number) => String(n)) as never);
// Dialog: render children only when open.
registerUiPrimitive(
  registry,
  UI_PRIMITIVE_KEYS.dialog,
  (({ open, title, children }: { open: boolean; title?: string; children: React.ReactNode }) =>
    open ? (
      <div data-testid="dialog">
        <div data-testid="dialog-title">{title}</div>
        {children}
      </div>
    ) : null) as never,
);
// MarkdownContent: surface the raw content for fence assertions.
registerUiPrimitive(
  registry,
  UI_PRIMITIVE_KEYS.markdownContent,
  (({ content }: { content: string }) => <pre data-testid="md">{content}</pre>) as never,
);
// LogBlock: preview mode surfaces last-N lines + a copy button carrying the
// FULL text so the code-node preview's copy/expand affordances are testable.
registerUiPrimitive(
  registry,
  UI_PRIMITIVE_KEYS.logBlock,
  (({ label, text, previewLines = 3 }: { label: string; text: string; previewLines?: number }) => (
    <div data-testid="log-block">
      <span>{label}</span>
      <button type="button" data-testid="log-block-copy" data-full={text}>copy</button>
      <pre data-testid="log-block-body">{text.split("\n").slice(-previewLines).join("\n")}</pre>
    </div>
  )) as never,
);

function makeAgent(over: Partial<FlowAgentState>): FlowAgentState {
  return {
    agentName: "verify",
    stepId: "verify",
    status: "complete",
    blockedBy: [],
    recentTools: [],
    detailHistory: [],
    ...over,
  } as FlowAgentState;
}

let mem = memoryLocation({ path: "/session/S1", record: true });

function renderCard(agent: FlowAgentState, sessionId: string | null = "S1") {
  mem = memoryLocation({ path: "/session/S1", record: true });
  return render(
    <Router hook={mem.hook}>
      <UiPrimitiveProvider value={registry}>
        <FlowAgentCard agent={agent} sessionId={sessionId ?? undefined} />
      </UiPrimitiveProvider>
    </Router>,
  );
}

const editorUrl = (p: string) => `/session/S1/editor?file=${encodeURIComponent(p)}`;

const HANDLER_PATH = "/home/u/proj/.pi/flows/flows/custom/test-flow/verify.ts";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("FlowAgentCard code-handler source", () => {
  it("3.1 renders the code button only for code nodes with a target, and only with a session", () => {
    const { queryByTitle, unmount } = renderCard(
      makeAgent({ nodeKind: "code", codeTarget: HANDLER_PATH }),
    );
    expect(queryByTitle("Open handler in editor")).not.toBeNull();
    unmount();

    // agent node — no code button
    const agentCard = renderCard(makeAgent({ nodeKind: "agent" }));
    expect(agentCard.queryByTitle("Open handler in editor")).toBeNull();
    agentCard.unmount();

    // code node without target — no code button
    const noTarget = renderCard(makeAgent({ nodeKind: "code", codeTarget: undefined }));
    expect(noTarget.queryByTitle("Open handler in editor")).toBeNull();
    noTarget.unmount();

    // no session — no editor to open in
    const noSession = renderCard(makeAgent({ nodeKind: "code", codeTarget: HANDLER_PATH }), null);
    expect(noSession.queryByTitle("Open handler in editor")).toBeNull();
  });

  it("3.2 clicking the code button opens the handler in the editor (no fetch, no dialog)", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const onSelect = vi.fn();
    const { getByTitle, queryByTestId } = render(
      <Router hook={(mem = memoryLocation({ path: "/session/S1", record: true })).hook}>
        <UiPrimitiveProvider value={registry}>
          <FlowAgentCard agent={makeAgent({ nodeKind: "code-decision", codeTarget: HANDLER_PATH })} sessionId="S1" onSelect={onSelect} />
        </UiPrimitiveProvider>
      </Router>,
    );
    fireEvent.click(getByTitle("Open handler in editor"));
    expect(mem.history?.at(-1)).toBe(editorUrl(HANDLER_PATH));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(queryByTestId("dialog")).toBeNull();
    expect(onSelect).not.toHaveBeenCalled(); // click does not bubble to card select
  });

  it("3.3 the agent document button opens the agent .md in the editor", () => {
    const md = "/home/u/proj/agents/filler.md";
    const { getByTitle } = renderCard(makeAgent({ nodeKind: "agent", sourcePath: md }));
    fireEvent.click(getByTitle(/source in editor$/));
    expect(mem.history?.at(-1)).toBe(editorUrl(md));
  });

  it("3.5 code-node log preview renders via LogBlock with copy carrying the FULL log", () => {
    const agent = makeAgent({
      nodeKind: "code",
      codeTarget: HANDLER_PATH,
      detailHistory: [
        { kind: "text", text: "line-1" },
        { kind: "text", text: "line-2" },
        { kind: "text", text: "line-3" },
        { kind: "text", text: "line-4" },
      ],
    } as Partial<FlowAgentState>);
    const { getByTestId } = renderCard(agent);
    const body = getByTestId("log-block-body");
    // Preview shows the last 3 lines.
    expect(body.textContent).toContain("line-4");
    expect(body.textContent).not.toContain("line-1");
    // Copy carries the FULL log (all 4 lines).
    expect(getByTestId("log-block-copy").getAttribute("data-full")).toBe(
      "line-1\nline-2\nline-3\nline-4",
    );
  });

});
