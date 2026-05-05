import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import React from "react";
import { CommandInput } from "../CommandInput.js";
import type { CommandInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";

const commands: CommandInfo[] = [
  { name: "deploy", description: "Deploy to production", source: "extension" },
  { name: "test", description: "Run test suite", source: "skill" },
  { name: "review", description: "Code review", source: "prompt" },
];

// ── contenteditable helpers ──────────────────────────────────────────

/** Query the contenteditable input element */
function getEditable(container: HTMLElement): HTMLElement {
  const el = container.querySelector('[data-testid="command-input"]')!;
  expect(el).toBeTruthy();
  return el as HTMLElement;
}

/**
 * Simulate user typing in a contenteditable div backed by react-contenteditable.
 * The library reads `innerHTML` on `input` and calls `onChange({ target: { value: innerHTML } })`.
 */
function typeInEditable(container: HTMLElement, text: string) {
  const el = getEditable(container);
  const html = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
  act(() => {
    el.focus();
    el.innerHTML = html;
    fireEvent.input(el);
  });
}

/** Read current plaintext from the contenteditable div */
function getEditableText(container: HTMLElement): string {
  return getEditable(container).textContent ?? "";
}

/** Check if the editable is disabled */
function isEditableDisabled(container: HTMLElement): boolean {
  const el = getEditable(container);
  return el.getAttribute("contenteditable") === "false" || el.getAttribute("aria-disabled") === "true";
}

function getDropdownItems(container: HTMLElement): string[] {
  const buttons = container.querySelectorAll("button");
  const items: string[] = [];
  for (const btn of buttons) {
    const cmdSpan = btn.querySelector(".font-mono");
    if (cmdSpan?.textContent?.startsWith("/")) {
      items.push(cmdSpan.textContent);
    }
  }
  return items;
}

// ── Selection mock helpers ───────────────────────────────────────────

function mockCollapsedSelection(container: HTMLElement, offset: number) {
  const el = getEditable(container);
  // Walk text nodes to place cursor at character offset
  const textNodes: Text[] = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let node: Node | null = walker.firstChild() as Node | null;
  while (node) {
    textNodes.push(node as Text);
    node = walker.nextNode();
  }

  let remaining = offset;
  let targetNode: Text | null = null;
  let targetOffset = 0;

  for (const tn of textNodes) {
    if (remaining <= tn.length) {
      targetNode = tn;
      targetOffset = remaining;
      break;
    }
    remaining -= tn.length;
  }

  if (!targetNode && textNodes.length > 0) {
    targetNode = textNodes[textNodes.length - 1]!;
    targetOffset = targetNode.length;
  }

  const range = document.createRange();
  if (targetNode) {
    range.setStart(targetNode, targetOffset);
  } else {
    range.setStart(el, 0);
  }
  range.collapse(true);

  const sel = {
    rangeCount: 1,
    isCollapsed: true,
    getRangeAt: () => range,
    removeAllRanges: vi.fn(),
    addRange: vi.fn(),
    anchorNode: targetNode ?? el,
    anchorOffset: targetOffset,
    focusNode: targetNode ?? el,
    focusOffset: targetOffset,
  };

  vi.spyOn(window, "getSelection").mockReturnValue(sel as unknown as Selection);
}

function clearSelectionMock() {
  vi.restoreAllMocks();
}

// ── Render helper ────────────────────────────────────────────────────

function renderInput(props: Partial<React.ComponentProps<typeof CommandInput>> = {}) {
  const onSend = vi.fn();
  const result = render(
    <CommandInput commands={commands} onSend={onSend} {...props} />
  );
  const editable = getEditable(result.container);
  return { ...result, editable, onSend };
}

// ── Tests ────────────────────────────────────────────────────────────

describe("CommandInput autocomplete", () => {
  it("should show command dropdown when typing /", () => {
    const { container } = renderInput();
    typeInEditable(container, "/");
    const items = getDropdownItems(container);
    expect(items).toContain("/deploy");
    expect(items).toContain("/test");
    expect(items).toContain("/review");
  });

  it("should filter commands as user types", () => {
    const { container } = renderInput();
    typeInEditable(container, "/dep");
    const items = getDropdownItems(container);
    expect(items).toContain("/deploy");
    expect(items).not.toContain("/test");
    expect(items).not.toContain("/review");
  });

  it("should hide dropdown when no commands match", () => {
    const { container } = renderInput();
    typeInEditable(container, "/zzz");
    const items = getDropdownItems(container);
    expect(items).toHaveLength(0);
  });

  it("should reopen dropdown after Escape when user types more", () => {
    const { container } = renderInput();

    typeInEditable(container, "/");
    expect(getDropdownItems(container).length).toBeGreaterThan(0);

    const el = getEditable(container);
    act(() => {
      fireEvent.keyDown(el, { key: "Escape" });
    });
    expect(getDropdownItems(container)).toHaveLength(0);

    typeInEditable(container, "/d");
    expect(getDropdownItems(container)).toContain("/deploy");
  });

  it("should show only builtin commands when commands prop is empty", () => {
    const { container } = renderInput({ commands: [] });
    typeInEditable(container, "/");
    expect(getDropdownItems(container)).toContain("/compact");
  });

  it("should select command with Tab", () => {
    const { container } = renderInput();

    typeInEditable(container, "/dep");
    expect(getDropdownItems(container)).toContain("/deploy");

    const el = getEditable(container);
    act(() => {
      fireEvent.keyDown(el, { key: "Tab" });
    });
    // After selection, text should contain "/deploy "
    expect(getEditableText(container)).toBe("/deploy ");
    expect(getDropdownItems(container)).toHaveLength(0);
  });

  it("should reopen dropdown after Escape even when filtered count stays the same", () => {
    const { container } = renderInput();

    typeInEditable(container, "/dep");
    let items = getDropdownItems(container);
    expect(items).toHaveLength(1);
    expect(items).toContain("/deploy");

    let el = getEditable(container);
    act(() => {
      fireEvent.keyDown(el, { key: "Escape" });
    });
    expect(getDropdownItems(container)).toHaveLength(0);

    typeInEditable(container, "/depl");
    items = getDropdownItems(container);
    expect(items).toHaveLength(1);
    expect(items).toContain("/deploy");
  });

  it("should navigate with arrow keys", () => {
    const { container } = renderInput();

    typeInEditable(container, "/");

    const getCommandButtons = () => {
      const buttons = Array.from(container.querySelectorAll("button"));
      return buttons.filter(b => b.querySelector(".font-mono"));
    };

    let cmdButtons = getCommandButtons();
    expect(cmdButtons[0]?.className).toContain("bg-[var(--bg-tertiary)]");

    const el = getEditable(container);
    act(() => {
      fireEvent.keyDown(el, { key: "ArrowDown" });
    });
    cmdButtons = getCommandButtons();
    expect(cmdButtons[1]?.className).toContain("bg-[var(--bg-tertiary)]");
  });
});

describe("Pending prompt behavior", () => {
  it("disables input when pendingPrompt is true", () => {
    const { container } = renderInput({ pendingPrompt: true });
    expect(isEditableDisabled(container)).toBe(true);
  });

  it("disables send button when pendingPrompt is true", () => {
    const { container } = renderInput({ pendingPrompt: true });
    typeInEditable(container, "test");
    const sendBtn = container.querySelector('[data-testid="send-button"]') as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(true);
  });

  it("shows Stop button when pendingPrompt is true", () => {
    const onCancelPending = vi.fn();
    const { container } = renderInput({ pendingPrompt: true, onCancelPending, sessionStatus: "idle" });
    const stopBtn = container.querySelector('[data-testid="stop-button"]');
    expect(stopBtn).not.toBeNull();
  });

  it("calls onCancelPending when Stop clicked during pending", () => {
    const onCancelPending = vi.fn();
    const onAbort = vi.fn();
    const { container } = renderInput({ pendingPrompt: true, onCancelPending, onAbort, sessionStatus: "idle" });
    const stopBtn = container.querySelector('[data-testid="stop-button"]')!;
    fireEvent.click(stopBtn);
    expect(onCancelPending).toHaveBeenCalledOnce();
    expect(onAbort).not.toHaveBeenCalled();
  });

  it("calls onCancelPending on Escape key during pending", () => {
    const onCancelPending = vi.fn();
    const { container } = renderInput({ pendingPrompt: true, onCancelPending });
    const el = getEditable(container);
    fireEvent.keyDown(el, { key: "Escape" });
    expect(onCancelPending).toHaveBeenCalledOnce();
  });

  it("does not call onCancelPending on Escape when not pending", () => {
    const onCancelPending = vi.fn();
    const { container } = renderInput({ pendingPrompt: false, onCancelPending });
    const el = getEditable(container);
    fireEvent.keyDown(el, { key: "Escape" });
    expect(onCancelPending).not.toHaveBeenCalled();
  });
});

describe("Play/Stop buttons", () => {
  it("shows Play icon button instead of text Send", () => {
    const { container } = renderInput();
    const sendBtn = container.querySelector('[data-testid="send-button"]');
    expect(sendBtn).not.toBeNull();
    expect(sendBtn!.querySelector("svg")).not.toBeNull();
    expect(sendBtn!.textContent).not.toContain("Send");
  });

  it("shows Stop button during streaming", () => {
    const onAbort = vi.fn();
    const { container } = renderInput({ sessionStatus: "streaming", onAbort });
    const stopBtn = container.querySelector('[data-testid="stop-button"]');
    expect(stopBtn).not.toBeNull();
  });

  it("hides Stop button when idle", () => {
    const onAbort = vi.fn();
    const { container } = renderInput({ sessionStatus: "idle", onAbort });
    const stopBtn = container.querySelector('[data-testid="stop-button"]');
    expect(stopBtn).toBeNull();
  });

  it("calls onAbort when Stop clicked", () => {
    const onAbort = vi.fn();
    const { container } = renderInput({ sessionStatus: "streaming", onAbort });
    const stopBtn = container.querySelector('[data-testid="stop-button"]')!;
    fireEvent.click(stopBtn);
    expect(onAbort).toHaveBeenCalledOnce();
  });
});

describe("Force kill escalation", () => {
  it("transitions to Force Stop after first click when onForceKill provided", () => {
    const onAbort = vi.fn();
    const onForceKill = vi.fn();
    const { container } = renderInput({ sessionStatus: "streaming", onAbort, onForceKill });

    const stopBtn = container.querySelector('[data-testid="stop-button"]')!;
    fireEvent.click(stopBtn);
    expect(onAbort).toHaveBeenCalledOnce();

    expect(container.querySelector('[data-testid="stop-button"]')).toBeNull();
    expect(container.querySelector('[data-testid="force-stop-button"]')).not.toBeNull();
  });

  it("calls onForceKill when Force Stop clicked", () => {
    const onAbort = vi.fn();
    const onForceKill = vi.fn();
    const { container } = renderInput({ sessionStatus: "streaming", onAbort, onForceKill });

    fireEvent.click(container.querySelector('[data-testid="stop-button"]')!);

    const forceBtn = container.querySelector('[data-testid="force-stop-button"]')!;
    fireEvent.click(forceBtn);
    expect(onForceKill).toHaveBeenCalledOnce();

    expect(container.querySelector('[data-testid="killing-button"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="force-stop-button"]')).toBeNull();
  });

  it("resets state when session stops streaming", () => {
    const onAbort = vi.fn();
    const onForceKill = vi.fn();
    const { container, rerender } = render(
      <CommandInput commands={commands} onSend={vi.fn()} sessionStatus="streaming" onAbort={onAbort} onForceKill={onForceKill} />
    );

    fireEvent.click(container.querySelector('[data-testid="stop-button"]')!);
    expect(container.querySelector('[data-testid="force-stop-button"]')).not.toBeNull();

    rerender(
      <CommandInput commands={commands} onSend={vi.fn()} sessionStatus="idle" onAbort={onAbort} onForceKill={onForceKill} />
    );

    expect(container.querySelector('[data-testid="stop-button"]')).toBeNull();
    expect(container.querySelector('[data-testid="force-stop-button"]')).toBeNull();
    expect(container.querySelector('[data-testid="killing-button"]')).toBeNull();
  });

  it("shows Stop button when retrying=true even if sessionStatus is idle (provider-retry-state)", () => {
    const onAbort = vi.fn();
    const { container } = renderInput({ sessionStatus: "idle", retrying: true, onAbort, onForceKill: vi.fn() });
    expect(container.querySelector('[data-testid="stop-button"]')).not.toBeNull();
  });

  it("Stop pressed during retry escalates to Force Stop while retrying remains true", () => {
    const onAbort = vi.fn();
    const onForceKill = vi.fn();
    const { container } = renderInput({ sessionStatus: "idle", retrying: true, onAbort, onForceKill });
    fireEvent.click(container.querySelector('[data-testid="stop-button"]')!);
    expect(onAbort).toHaveBeenCalledOnce();
    expect(container.querySelector('[data-testid="force-stop-button"]')).not.toBeNull();
  });

  it("resets stop state when retrying clears AND sessionStatus is not streaming", () => {
    const onAbort = vi.fn();
    const onForceKill = vi.fn();
    const { container, rerender } = render(
      <CommandInput commands={commands} onSend={vi.fn()} sessionStatus="idle" retrying={true} onAbort={onAbort} onForceKill={onForceKill} />
    );
    fireEvent.click(container.querySelector('[data-testid="stop-button"]')!);
    expect(container.querySelector('[data-testid="force-stop-button"]')).not.toBeNull();
    rerender(
      <CommandInput commands={commands} onSend={vi.fn()} sessionStatus="idle" retrying={false} onAbort={onAbort} onForceKill={onForceKill} />
    );
    expect(container.querySelector('[data-testid="stop-button"]')).toBeNull();
    expect(container.querySelector('[data-testid="force-stop-button"]')).toBeNull();
  });

  it("does not transition to Force Stop without onForceKill prop", () => {
    const onAbort = vi.fn();
    const { container } = renderInput({ sessionStatus: "streaming", onAbort });

    fireEvent.click(container.querySelector('[data-testid="stop-button"]')!);
    expect(onAbort).toHaveBeenCalledOnce();

    expect(container.querySelector('[data-testid="force-stop-button"]')).toBeNull();
  });
});

describe("Image lightbox from paste preview", () => {
  it("opens lightbox when clicking a paste preview image", async () => {
    let pendingOnload: (() => void) | null = null;
    vi.stubGlobal("FileReader", class {
      result = "data:image/png;base64,iVBORw0KGgo=";
      onload: (() => void) | null = null;
      readAsDataURL() {
        pendingOnload = () => this.onload?.();
      }
    });

    const { container } = renderInput();
    const el = getEditable(container);

    const file = new File([new Uint8Array([137, 80, 78, 71])], "test.png", { type: "image/png" });
    const dataTransfer = {
      items: [{ type: "image/png", getAsFile: () => file, kind: "file" }],
    };

    fireEvent.paste(el, { clipboardData: dataTransfer });

    await act(async () => {
      pendingOnload?.();
    });

    const img = container.querySelector("img.h-16");
    expect(img).not.toBeNull();
    expect(img!.className).toContain("cursor-pointer");
    fireEvent.click(img!);
    const lightbox = document.body.querySelector("[data-testid='lightbox-backdrop']");
    expect(lightbox).not.toBeNull();

    vi.restoreAllMocks();
  });
});

describe("contentEditable plaintext-only attribute", () => {
  it("sets contenteditable='plaintext-only' on the DOM element", () => {
    const { container } = renderInput();
    const el = getEditable(container);
    expect(el.getAttribute("contenteditable")).toBe("plaintext-only");
  });
});

describe("Plaintext enforcement", () => {
  it("strips HTML formatting from typed content", () => {
    const onDraftChange = vi.fn();
    const { container } = renderInput({ draft: "", onDraftChange });
    const el = getEditable(container);

    // Simulate typing raw HTML by setting innerHTML directly
    el.innerHTML = "&lt;b&gt;bold&lt;/b&gt;";
    fireEvent.input(el);
    // safeHtmlToPlain should decode entities back to literal <b>bold</b>
    expect(onDraftChange).toHaveBeenCalledWith("<b>bold</b>");
  });
});

describe("Accessibility", () => {
  it("has role='textbox' and aria attributes", () => {
    const { container } = renderInput();
    const el = getEditable(container);
    expect(el.getAttribute("role")).toBe("textbox");
    expect(el.getAttribute("aria-multiline")).toBe("true");
    expect(el.getAttribute("aria-placeholder")).toBeTruthy();
  });

  it("reflects disabled state in aria-disabled", () => {
    const { container } = renderInput({ pendingPrompt: true });
    const el = getEditable(container);
    expect(el.getAttribute("aria-disabled")).toBe("true");
  });
});

// ── Controlled draft tests ──────────────────────────────────────────

describe("CommandInput — controlled draft prop", () => {
  it("renders the provided draft value in the editable", () => {
    const { container } = renderInput({ draft: "hello world", onDraftChange: vi.fn() });
    // The contenteditable div renders with escaped HTML
    expect(getEditableText(container)).toBe("hello world");
  });

  it("calls onDraftChange when the user types", () => {
    const onDraftChange = vi.fn();
    const { container } = renderInput({ draft: "", onDraftChange });
    typeInEditable(container, "x");
    expect(onDraftChange).toHaveBeenCalledWith("x");
  });

  it("keeps the draft in sync across rerenders (different sessionId)", () => {
    const onDraftChange = vi.fn();
    const { rerender, container } = render(
      <CommandInput commands={commands} onSend={vi.fn()} sessionId="A" draft="alpha" onDraftChange={onDraftChange} />
    );
    expect(getEditableText(container)).toBe("alpha");
    rerender(
      <CommandInput commands={commands} onSend={vi.fn()} sessionId="B" draft="beta" onDraftChange={onDraftChange} />
    );
    expect(getEditableText(container)).toBe("beta");
  });
});

// ── History recall tests ────────────────────────────────────────────

describe("CommandInput — history recall", () => {
  beforeEach(() => {
    // Default: mock selection at end of text (most common case)
  });
  afterEach(() => {
    clearSelectionMock();
  });

  it("ArrowUp from empty draft loads the newest history entry", () => {
    const onDraftChange = vi.fn();
    const { container } = renderInput({
      draft: "",
      onDraftChange,
      history: ["newest", "older"],
    });
    const el = getEditable(container);
    mockCollapsedSelection(container, 0);
    fireEvent.keyDown(el, { key: "ArrowUp" });
    expect(onDraftChange).toHaveBeenLastCalledWith("newest");
  });

  it("walks further back with repeated ArrowUp presses", () => {
    const onDraftChange = vi.fn();
    function Controlled({ history }: { history: string[] }) {
      const [d, setD] = React.useState("");
      return <CommandInput commands={commands} onSend={vi.fn()} draft={d} onDraftChange={(v) => { setD(v); onDraftChange(v); }} history={history} />;
    }
    const { container } = render(<Controlled history={["two", "one"]} />);
    const el = getEditable(container);

    // After first ArrowUp, text = "two" → match selection at 0 to trigger history again
    mockCollapsedSelection(container, 0);
    fireEvent.keyDown(el, { key: "ArrowUp" });

    // Wait for controlled update
    clearSelectionMock();
    mockCollapsedSelection(container, 0);
    fireEvent.keyDown(el, { key: "ArrowUp" });
    expect(onDraftChange).toHaveBeenLastCalledWith("one");
  });

  it("Escape while in history mode restores the in-progress draft", () => {
    function Controlled() {
      const [d, setD] = React.useState("wip");
      return <CommandInput commands={commands} onSend={vi.fn()} draft={d} onDraftChange={setD} history={["recent"]} />;
    }
    const { container } = render(<Controlled />);
    const el = getEditable(container);

    mockCollapsedSelection(container, 0);
    fireEvent.keyDown(el, { key: "ArrowUp" });
    expect(getEditableText(container)).toBe("recent");

    clearSelectionMock();
    act(() => {
      fireEvent.keyDown(el, { key: "Escape" });
    });
    expect(getEditableText(container)).toBe("wip");
  });

  it("ArrowUp with empty history is a no-op", () => {
    const onDraftChange = vi.fn();
    const { container } = renderInput({ draft: "", onDraftChange, history: [] });
    const el = getEditable(container);
    mockCollapsedSelection(container, 0);
    fireEvent.keyDown(el, { key: "ArrowUp" });
    expect(onDraftChange).not.toHaveBeenCalled();
    expect(getEditableText(container)).toBe("");
  });

  it("history-navigation state resets on sessionId change", () => {
    function Controlled({ sid }: { sid: string }) {
      const [d, setD] = React.useState("");
      return <CommandInput commands={commands} onSend={vi.fn()} sessionId={sid} draft={d} onDraftChange={setD} history={["A-recent"]} />;
    }
    const { container, rerender } = render(<Controlled sid="A" />);
    const el = getEditable(container);
    mockCollapsedSelection(container, 0);
    fireEvent.keyDown(el, { key: "ArrowUp" });
    expect(getEditableText(container)).toBe("A-recent");
    rerender(<Controlled sid="B" />);
    clearSelectionMock();
    fireEvent.keyDown(el, { key: "Escape" });
    expect(el).toBeTruthy();
  });
});

// ── Stale-closure regression tests ──────────────────────────────────

describe("CommandInput stale-closure regression (controlled mode, prop-ref change)", () => {
  function renderControlled(initial: {
    onDraftChange: (t: string) => void;
    fileResults?: React.ComponentProps<typeof CommandInput>["fileResults"];
  }) {
    function Wrapper({
      handler,
      fileResults,
    }: {
      handler: (t: string) => void;
      fileResults?: React.ComponentProps<typeof CommandInput>["fileResults"];
    }) {
      const [draft, setDraft] = React.useState("");
      return (
        <CommandInput
          commands={commands}
          onSend={vi.fn()}
          draft={draft}
          onDraftChange={(t) => {
            setDraft(t);
            handler(t);
          }}
          fileResults={fileResults}
          onListFiles={vi.fn()}
        />
      );
    }
    const result = render(
      <Wrapper handler={initial.onDraftChange} fileResults={initial.fileResults} />
    );
    const editable = getEditable(result.container);
    const rerenderWith = (next: {
      onDraftChange: (t: string) => void;
      fileResults?: React.ComponentProps<typeof CommandInput>["fileResults"];
    }) => {
      result.rerender(
        <Wrapper
          handler={next.onDraftChange}
          fileResults={next.fileResults ?? initial.fileResults}
        />
      );
    };
    return { ...result, editable, rerenderWith };
  }

  it("Tab invokes the CURRENT onDraftChange after prop-reference change", () => {
    const v1 = vi.fn();
    const v2 = vi.fn();
    const { container, editable, rerenderWith } = renderControlled({ onDraftChange: v1 });
    rerenderWith({ onDraftChange: v2 });
    typeInEditable(container, "/dep");
    const el = getEditable(container);
    act(() => {
      fireEvent.keyDown(el, { key: "Tab" });
    });
    expect(v2).toHaveBeenCalledWith("/deploy ");
    expect(v1).not.toHaveBeenCalledWith("/deploy ");
  });

  it("Enter invokes the CURRENT onDraftChange after prop-reference change", () => {
    const v1 = vi.fn();
    const v2 = vi.fn();
    const { container, editable, rerenderWith } = renderControlled({ onDraftChange: v1 });
    rerenderWith({ onDraftChange: v2 });
    typeInEditable(container, "/dep");
    const el = getEditable(container);
    act(() => {
      fireEvent.keyDown(el, { key: "Enter" });
    });
    expect(v2).toHaveBeenCalledWith("/deploy ");
    expect(v1).not.toHaveBeenCalledWith("/deploy ");
  });

  it("Mouse click invokes the CURRENT onDraftChange after prop-reference change", () => {
    const v1 = vi.fn();
    const v2 = vi.fn();
    const { container, rerenderWith } = renderControlled({ onDraftChange: v1 });
    rerenderWith({ onDraftChange: v2 });
    typeInEditable(container, "/dep");
    const buttons = Array.from(container.querySelectorAll("button"));
    const deployBtn = buttons.find((b) =>
      b.querySelector(".font-mono")?.textContent?.startsWith("/deploy")
    );
    expect(deployBtn).toBeTruthy();
    act(() => {
      fireEvent.click(deployBtn!);
    });
    expect(v2).toHaveBeenCalledWith("/deploy ");
    expect(v1).not.toHaveBeenCalledWith("/deploy ");
  });

  it("@ file Tab invokes the CURRENT onDraftChange after prop-reference change", () => {
    vi.useFakeTimers();
    try {
      const v1 = vi.fn();
      const v2 = vi.fn();
      const fileResults = {
        query: "",
        files: [
          { path: "src/index.ts", isDirectory: false },
          { path: "README.md", isDirectory: false },
        ],
      };
      const { container, editable, rerenderWith } = renderControlled({
        onDraftChange: v1,
      });
      rerenderWith({ onDraftChange: v2 });
      typeInEditable(container, "@");
      act(() => {
        vi.advanceTimersByTime(200);
      });
      rerenderWith({ onDraftChange: v2, fileResults });
      const el = getEditable(container);
      act(() => {
        fireEvent.keyDown(el, { key: "Tab" });
      });
      const v2Call = v2.mock.calls.find(
        (c) => typeof c[0] === "string" && c[0].includes("src/index.ts")
      );
      expect(
        v2Call,
        `expected v2 to be called with a draft containing src/index.ts, got: ${JSON.stringify(v2.mock.calls)}`
      ).toBeTruthy();
      const v1Call = v1.mock.calls.find(
        (c) => typeof c[0] === "string" && c[0].includes("src/index.ts")
      );
      expect(v1Call).toBeFalsy();
    } finally {
      vi.useRealTimers();
    }
  });
});
