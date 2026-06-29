/**
 * FlowAgentCard code-handler source open.
 *
 * Code / code-decision nodes carry `codeTarget` (the resolved .ts handler path,
 * emitted absolute by the flow runtime). The card renders an mdiCodeBraces
 * button that opens a ui:dialog, fetches the handler via
 * /api/pi-resource-file, and renders it wrapped in a fenced ```ts block.
 * See change: open-code-handler-from-flow-card.
 */
import React from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";
import {
  UiPrimitiveProvider,
  createUiPrimitiveRegistry,
  registerUiPrimitive,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import type { FlowAgentState } from "@blackbelt-technology/pi-dashboard-shared/types.js";
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

function renderCard(agent: FlowAgentState) {
  return render(
    <UiPrimitiveProvider value={registry}>
      <FlowAgentCard agent={agent} />
    </UiPrimitiveProvider>,
  );
}

const HANDLER_PATH = "/home/u/proj/.pi/flows/flows/custom/test-flow/verify.ts";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("FlowAgentCard code-handler source", () => {
  it("3.1 renders the code button only for code nodes with a target", () => {
    const { queryByTitle, unmount } = renderCard(
      makeAgent({ nodeKind: "code", codeTarget: HANDLER_PATH }),
    );
    expect(queryByTitle("View handler source")).not.toBeNull();
    unmount();

    // agent node — no code button
    const agentCard = renderCard(makeAgent({ nodeKind: "agent" }));
    expect(agentCard.queryByTitle("View handler source")).toBeNull();
    agentCard.unmount();

    // code node without target — no code button
    const noTarget = renderCard(makeAgent({ nodeKind: "code", codeTarget: undefined }));
    expect(noTarget.queryByTitle("View handler source")).toBeNull();
  });

  it("3.2 clicking the code button opens a dialog and fetches the handler path", async () => {
    const fetchMock = vi.fn(async () => ({
      json: async () => ({ success: true, data: { type: "file", content: "export const x = 1;" } }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const { getByTitle, findByTestId } = renderCard(
      makeAgent({ nodeKind: "code", codeTarget: HANDLER_PATH }),
    );
    fireEvent.click(getByTitle("View handler source"));

    await findByTestId("dialog");
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/pi-resource-file?path=${encodeURIComponent(HANDLER_PATH)}`,
    );
  });

  it("3.3 loaded handler content is wrapped in a ```ts fence", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        json: async () => ({ success: true, data: { type: "file", content: "export const x = 1;" } }),
      })),
    );

    const { getByTitle, findByTestId } = renderCard(
      makeAgent({ nodeKind: "code-decision", codeTarget: HANDLER_PATH }),
    );
    fireEvent.click(getByTitle("View handler source"));

    const md = await findByTestId("md");
    expect(md.textContent).toBe("```ts\nexport const x = 1;\n```");
  });

  it("3.4 fetch error surfaces in the dialog", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        json: async () => ({ success: false, error: "path not in allowed resource location" }),
      })),
    );

    const { getByTitle, findByTestId } = renderCard(
      makeAgent({ nodeKind: "code", codeTarget: HANDLER_PATH }),
    );
    fireEvent.click(getByTitle("View handler source"));

    const dialog = await findByTestId("dialog");
    await waitFor(() =>
      expect(dialog.textContent).toContain("path not in allowed resource location"),
    );
    expect(dialog.querySelector('[data-testid="md"]')).toBeNull();
  });
});
