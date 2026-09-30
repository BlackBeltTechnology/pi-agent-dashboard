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
// Default mirrors the card's `previewLines={2}` (consolidate-flow-agent-cards).
registerUiPrimitive(
  registry,
  UI_PRIMITIVE_KEYS.logBlock,
  (({ label, text, previewLines = 2 }: { label: string; text: string; previewLines?: number }) => (
    <div data-testid="log-block" data-preview-lines={previewLines}>
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

function renderCard(agent: FlowAgentState, sessionId: string | null = "S1", historyState: unknown = null) {
  mem = memoryLocation({ path: "/session/S1", record: true, state: historyState });
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

  it("3.2b re-clicking the same file control mints a fresh open intent (distinct nonces)", () => {
    // The bug (design D8): closing the editor leaves the URL naming the target,
    // so a second click pushed the SAME URL and the host's apply-once key did
    // not change — the split never re-opened. The URL is still identical; the
    // per-call nonce in history state is what makes the second click a new open.
    const { getByTitle } = renderCard(makeAgent({ nodeKind: "code", codeTarget: HANDLER_PATH }));
    const button = getByTitle("Open handler in editor");
    const nonceOf = () => (mem.state as { openNonce?: number } | null)?.openNonce;

    fireEvent.click(button);
    const first = nonceOf();
    fireEvent.click(button);
    const second = nonceOf();

    expect(mem.history?.at(-2)).toBe(editorUrl(HANDLER_PATH));
    expect(mem.history?.at(-1)).toBe(editorUrl(HANDLER_PATH));
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(second).not.toBe(first);
  });

  it("3.2b uniqueness across page loads: a nonce is a string and never equals a nonce survivor of a reload", () => {
    // The bug: `history.state` survives a reload but a module-level counter
    // restarts at 0, so after (open file A → nonce 1) → reload → close → click,
    // the new nonce was 1 again — equal to the current entry's, so the host's
    // apply-once key was unchanged and the editor never re-opened. A nonce must
    // therefore be unique across page loads, i.e. never collide with a stale
    // value already sitting in history state.
    for (const survivor of [{ openNonce: 1 }, { openNonce: "1" }]) {
      const { getByTitle, unmount } = renderCard(
        makeAgent({ nodeKind: "code", codeTarget: HANDLER_PATH }),
        "S1",
        survivor,
      );
      fireEvent.click(getByTitle("Open handler in editor"));
      const minted = (mem.state as { openNonce?: unknown } | null)?.openNonce;
      expect(typeof minted, JSON.stringify(survivor)).toBe("string");
      expect(minted, JSON.stringify(survivor)).not.toBe(survivor.openNonce);
      unmount();
    }
  });

  it("3.3 the agent document button opens the agent .md in the editor", () => {
    const md = "/home/u/proj/agents/filler.md";
    const { getByTitle } = renderCard(makeAgent({ nodeKind: "agent", sourcePath: md }));
    fireEvent.click(getByTitle(/source in editor$/));
    expect(mem.history?.at(-1)).toBe(editorUrl(md));
  });

  it("3.5 code-node log preview renders via LogBlock with previewLines 2 and copy carrying the FULL log", () => {
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
    // The card asks for exactly two preview lines.
    expect(getByTestId("log-block").getAttribute("data-preview-lines")).toBe("2");
    // Preview shows the last 2 lines only.
    expect(body.textContent).toContain("line-3");
    expect(body.textContent).toContain("line-4");
    expect(body.textContent).not.toContain("line-1");
    expect(body.textContent).not.toContain("line-2");
    // Copy carries the FULL log (all 4 lines).
    expect(getByTestId("log-block-copy").getAttribute("data-full")).toBe(
      "line-1\nline-2\nline-3\nline-4",
    );
  });
});

// L1 — card layout: reserved body, tool-call rule, basename line, controls.
// See change: consolidate-flow-agent-cards (test-plan #E2, #E3, #E6, #E9, #E10, #X2).

const tools = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ toolName: `tool-${i + 1}`, inputPreview: `in-${i + 1}` }));

describe("FlowAgentCard reserved body and tool-call display (#E2/#E3)", () => {
  it("#E2: one reserved two-line body slot for 0, 1 and 2 tool calls, no pad rows", () => {
    for (const n of [0, 1, 2]) {
      const { getAllByTestId, container, unmount } = renderCard(
        makeAgent({ nodeKind: "agent", recentTools: tools(n) }),
      );
      const bodies = getAllByTestId("flow-card-body");
      expect(bodies, `n=${n}`).toHaveLength(1);
      expect(bodies[0].className).toContain("min-h-[30px]");
      expect(bodies[0].className).toContain("leading-[15px]");
      // No placeholder padding rows: no element whose only text is U+00A0.
      const pads = Array.from(container.querySelectorAll("*")).filter((el) => el.textContent === "\u00a0");
      expect(pads, `n=${n}`).toEqual([]);
      unmount();
    }
  });

  it("#E3: renders at most the LAST 2 tool calls, newest first, newest marked", () => {
    const zero = renderCard(makeAgent({ nodeKind: "agent", recentTools: [] }));
    expect(zero.getByTestId("flow-card-body").textContent).toBe("");
    zero.unmount();

    const one = renderCard(makeAgent({ nodeKind: "agent", recentTools: tools(1) }));
    expect(one.getByTestId("flow-card-body").textContent).toBe("▸ tool-1 in-1");
    one.unmount();

    const two = renderCard(makeAgent({ nodeKind: "agent", recentTools: tools(2) }));
    const twoText = two.getByTestId("flow-card-body").textContent ?? "";
    expect(twoText).toContain("▸ tool-2 in-2");
    expect(twoText).toContain("· tool-1 in-1");
    two.unmount();

    const four = renderCard(makeAgent({ nodeKind: "agent", recentTools: tools(4) }));
    const body = four.getByTestId("flow-card-body");
    const entries = Array.from(body.children).filter((el) => (el.textContent ?? "").trim());
    expect(entries).toHaveLength(2);
    expect(body.textContent).toContain("▸ tool-4 in-4");
    expect(body.textContent).toContain("· tool-3 in-3");
    expect(body.textContent).not.toContain("tool-1");
    expect(body.textContent).not.toContain("tool-2");
  });

  it("#E5: a logless code node renders the same reserved slot, no LogBlock", () => {
    const { getByTestId, queryByTestId } = renderCard(makeAgent({ nodeKind: "code", codeTarget: HANDLER_PATH }));
    expect(queryByTestId("log-block")).toBeNull();
    const body = getByTestId("flow-card-body");
    expect(body.className).toContain("min-h-[30px]");
    expect(body.textContent).toBe("");
  });

  it("#E5: 1/2/3 log lines render via LogBlock, previewing the last 2 and copying all", () => {
    const cases: Array<{ lines: string[]; preview: string[] }> = [
      { lines: ["only-1"], preview: ["only-1"] },
      { lines: ["one", "two"], preview: ["one", "two"] },
      { lines: ["l1", "l2", "l3"], preview: ["l2", "l3"] },
    ];
    for (const c of cases) {
      const { getByTestId, unmount } = renderCard(
        makeAgent({
          nodeKind: "code",
          codeTarget: HANDLER_PATH,
          detailHistory: c.lines.map((text) => ({ kind: "text", text })),
        } as Partial<FlowAgentState>),
      );
      const body = getByTestId("log-block-body").textContent ?? "";
      expect(body).toBe(c.preview.join("\n"));
      expect(getByTestId("log-block-copy").getAttribute("data-full")).toBe(c.lines.join("\n"));
      unmount();
    }
  });
});

describe("FlowAgentCard basename line (#E6)", () => {
  it("resolves codeTarget -> sourcePath -> @alias -> none, full path as title", () => {
    const code = renderCard(makeAgent({ nodeKind: "code", codeTarget: "/a/b/handler.ts" }));
    const codeLine = code.getByTestId("flow-card-basename");
    expect(codeLine.textContent).toBe("handler.ts");
    expect(codeLine.getAttribute("title")).toBe("/a/b/handler.ts");
    expect(codeLine.className).toContain("font-mono");
    code.unmount();

    const agentDoc = renderCard(makeAgent({ nodeKind: "agent", sourcePath: "/x/y/filler.md" }));
    const docLine = agentDoc.getByTestId("flow-card-basename");
    expect(docLine.textContent).toBe("filler.md");
    expect(docLine.getAttribute("title")).toBe("/x/y/filler.md");
    agentDoc.unmount();

    const alias = renderCard(makeAgent({ nodeKind: "agent", model: "@ops" }));
    const aliasLine = alias.getByTestId("flow-card-basename");
    expect(aliasLine.textContent).toBe("@ops");
    expect(aliasLine.getAttribute("title")).toBe("@ops");
    // Exactly one alias line — the separate alias line is gone.
    expect(alias.getAllByText("@ops")).toHaveLength(1);
    alias.unmount();

    const none = renderCard(makeAgent({ nodeKind: "agent" }));
    expect(none.queryByTestId("flow-card-basename")).toBeNull();
    // No chevron-prefixed absolute-path line survives.
    expect(none.container.textContent).not.toContain("‹›");
  });
});

describe("FlowAgentCard file controls (#E9/#E10/#X2)", () => {
  const HANDLER = "/h/handler.ts";
  const DOC = "/d/filler.md";

  it("#E9: code card with both targets keeps exactly the two file controls + Details", () => {
    const { getByTitle, queryByTitle, container } = renderCard(
      makeAgent({ nodeKind: "code", codeTarget: HANDLER, sourcePath: DOC, label: "filler" }),
    );
    expect(getByTitle("Open handler in editor")).toBeTruthy();
    expect(getByTitle("Open filler source in editor")).toBeTruthy();
    expect(Array.from(container.querySelectorAll("button"))).toHaveLength(3);
    expect(queryByTitle(/preview|eye/i)).toBeNull();
  });

  it("#E9: agent card without a codeTarget keeps one file control", () => {
    const { getByTitle, queryByTitle } = renderCard(
      makeAgent({ nodeKind: "agent", sourcePath: DOC, label: "filler" }),
    );
    expect(getByTitle("Open filler source in editor")).toBeTruthy();
    expect(queryByTitle("Open handler in editor")).toBeNull();
  });

  it("#E10: visibility decision table across kind x codeTarget x sourcePath x session", () => {
    type Kind = NonNullable<FlowAgentState["nodeKind"]>;
    const cases: Array<{
      kind: Kind;
      codeTarget?: string;
      sourcePath?: string;
      session: string | null;
      handler: boolean;
      doc: boolean;
    }> = [
      { kind: "code", codeTarget: HANDLER, session: "S1", handler: true, doc: false },
      { kind: "code-decision", codeTarget: HANDLER, sourcePath: DOC, session: "S1", handler: true, doc: true },
      { kind: "agent", codeTarget: HANDLER, session: "S1", handler: false, doc: false },
      { kind: "agent", sourcePath: DOC, session: "S1", handler: false, doc: true },
      { kind: "code", codeTarget: HANDLER, session: null, handler: false, doc: false },
      { kind: "agent", sourcePath: DOC, session: null, handler: false, doc: false },
      { kind: "code", session: "S1", handler: false, doc: false },
    ];
    for (const c of cases) {
      const { queryByTitle, unmount } = renderCard(
        makeAgent({ nodeKind: c.kind, codeTarget: c.codeTarget, sourcePath: c.sourcePath, label: "filler" }),
        c.session,
      );
      expect(queryByTitle("Open handler in editor") !== null, JSON.stringify(c)).toBe(c.handler);
      expect(queryByTitle("Open filler source in editor") !== null, JSON.stringify(c)).toBe(c.doc);
      unmount();
    }
  });

  it("#X2: withdrawing the session id drops both controls without navigating or throwing", () => {
    const agent = makeAgent({ nodeKind: "code", codeTarget: HANDLER, sourcePath: DOC, label: "filler" });
    const route = memoryLocation({ path: "/session/S1", record: true });
    const tree = (sessionId: string | undefined) => (
      <Router hook={route.hook}>
        <UiPrimitiveProvider value={registry}>
          <FlowAgentCard agent={agent} sessionId={sessionId} />
        </UiPrimitiveProvider>
      </Router>
    );
    const { queryByTitle, rerender } = render(tree("S1"));
    expect(queryByTitle("Open handler in editor")).not.toBeNull();
    expect(queryByTitle("Open filler source in editor")).not.toBeNull();
    const before = [...(route.history ?? [])];
    expect(() => rerender(tree(undefined))).not.toThrow();
    expect(queryByTitle("Open handler in editor")).toBeNull();
    expect(queryByTitle("Open filler source in editor")).toBeNull();
    expect(route.history ?? []).toEqual(before);
  });
});
