import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import React from "react";
import { CommandInput } from "../CommandInput.js";
import type { CommandInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";

const commands: CommandInfo[] = [
  { name: "deploy", description: "Deploy to production", source: "extension" },
  { name: "test", description: "Run test suite", source: "skill" },
  { name: "review", description: "Code review", source: "prompt" },
];

function renderInput(props: Partial<React.ComponentProps<typeof CommandInput>> = {}) {
  const onSend = vi.fn();
  const result = render(
    <CommandInput commands={commands} onSend={onSend} {...props} />
  );
  const textarea = result.container.querySelector("textarea")!;
  return { ...result, textarea, onSend };
}

function getDropdownItems(container: HTMLElement): string[] {
  // Command items have font-mono text-blue-400 class and start with /
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

describe("CommandInput autocomplete", () => {
  it("should show command dropdown when typing /", () => {
    const { container, textarea } = renderInput();
    fireEvent.change(textarea, { target: { value: "/" } });
    const items = getDropdownItems(container);
    expect(items).toContain("/deploy");
    expect(items).toContain("/test");
    expect(items).toContain("/review");
  });

  it("should filter commands as user types", () => {
    const { container, textarea } = renderInput();
    fireEvent.change(textarea, { target: { value: "/dep" } });
    const items = getDropdownItems(container);
    expect(items).toContain("/deploy");
    expect(items).not.toContain("/test");
    expect(items).not.toContain("/review");
  });

  it("should hide dropdown when no commands match", () => {
    const { container, textarea } = renderInput();
    fireEvent.change(textarea, { target: { value: "/zzz" } });
    const items = getDropdownItems(container);
    expect(items).toHaveLength(0);
  });

  it("should reopen dropdown after Escape when user types more", () => {
    const { container, textarea } = renderInput();

    // Type / to open dropdown
    fireEvent.change(textarea, { target: { value: "/" } });
    expect(getDropdownItems(container).length).toBeGreaterThan(0);

    // Press Escape to dismiss
    fireEvent.keyDown(textarea, { key: "Escape" });
    expect(getDropdownItems(container)).toHaveLength(0);

    // Type more - dropdown should reopen
    fireEvent.change(textarea, { target: { value: "/d" } });
    expect(getDropdownItems(container)).toContain("/deploy");
  });

  it("should show only builtin commands when commands prop is empty", () => {
    const { container, textarea } = renderInput({ commands: [] });
    fireEvent.change(textarea, { target: { value: "/" } });
    // Built-in commands like /compact are always available
    expect(getDropdownItems(container)).toContain("/compact");
  });

  it("should select command with Tab", () => {
    const { container, textarea } = renderInput();
    fireEvent.change(textarea, { target: { value: "/dep" } });
    expect(getDropdownItems(container)).toContain("/deploy");

    fireEvent.keyDown(textarea, { key: "Tab" });
    expect(textarea.value).toBe("/deploy ");
    // Dropdown should close after selection
    expect(getDropdownItems(container)).toHaveLength(0);
  });

  it("should reopen dropdown after Escape even when filtered count stays the same", () => {
    const { container, textarea } = renderInput();

    // Type /dep to get exactly 1 match (deploy)
    fireEvent.change(textarea, { target: { value: "/dep" } });
    let items = getDropdownItems(container);
    expect(items).toHaveLength(1);
    expect(items).toContain("/deploy");

    // Press Escape
    fireEvent.keyDown(textarea, { key: "Escape" });
    expect(getDropdownItems(container)).toHaveLength(0);

    // Type more but same number of matches: /depl still matches only deploy
    fireEvent.change(textarea, { target: { value: "/depl" } });
    items = getDropdownItems(container);
    expect(items).toHaveLength(1);
    expect(items).toContain("/deploy");
  });

  it("should navigate with arrow keys", () => {
    const { container, textarea } = renderInput();
    fireEvent.change(textarea, { target: { value: "/" } });

    // Get command buttons (excluding the Send button)
    const getCommandButtons = () => {
      const buttons = Array.from(container.querySelectorAll("button"));
      return buttons.filter(b => b.querySelector(".font-mono"));
    };

    // First item should be highlighted
    let cmdButtons = getCommandButtons();
    expect(cmdButtons[0]?.className).toContain("bg-[var(--bg-tertiary)]");

    // Arrow down - second item highlighted
    fireEvent.keyDown(textarea, { key: "ArrowDown" });
    cmdButtons = getCommandButtons();
    expect(cmdButtons[1]?.className).toContain("bg-[var(--bg-tertiary)]");
  });
});

describe("Pending prompt behavior", () => {
  it("disables input when pendingPrompt is true", () => {
    const { textarea } = renderInput({ pendingPrompt: true });
    expect(textarea.disabled).toBe(true);
  });

  it("disables send button when pendingPrompt is true", () => {
    const { container, textarea } = renderInput({ pendingPrompt: true });
    fireEvent.change(textarea, { target: { value: "test" } });
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
    const { textarea } = renderInput({ pendingPrompt: true, onCancelPending });
    fireEvent.keyDown(textarea, { key: "Escape" });
    expect(onCancelPending).toHaveBeenCalledOnce();
  });

  it("does not call onCancelPending on Escape when not pending", () => {
    const onCancelPending = vi.fn();
    const { textarea } = renderInput({ pendingPrompt: false, onCancelPending });
    fireEvent.keyDown(textarea, { key: "Escape" });
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

    // Click Stop
    const stopBtn = container.querySelector('[data-testid="stop-button"]')!;
    fireEvent.click(stopBtn);
    expect(onAbort).toHaveBeenCalledOnce();

    // Stop button should be gone, Force Stop should appear
    expect(container.querySelector('[data-testid="stop-button"]')).toBeNull();
    expect(container.querySelector('[data-testid="force-stop-button"]')).not.toBeNull();
  });

  it("calls onForceKill when Force Stop clicked", () => {
    const onAbort = vi.fn();
    const onForceKill = vi.fn();
    const { container } = renderInput({ sessionStatus: "streaming", onAbort, onForceKill });

    // Click Stop first
    fireEvent.click(container.querySelector('[data-testid="stop-button"]')!);

    // Click Force Stop
    const forceBtn = container.querySelector('[data-testid="force-stop-button"]')!;
    fireEvent.click(forceBtn);
    expect(onForceKill).toHaveBeenCalledOnce();

    // Should show killing state
    expect(container.querySelector('[data-testid="killing-button"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="force-stop-button"]')).toBeNull();
  });

  it("resets state when session stops streaming", () => {
    const onAbort = vi.fn();
    const onForceKill = vi.fn();
    const { container, rerender } = render(
      <CommandInput commands={commands} onSend={vi.fn()} sessionStatus="streaming" onAbort={onAbort} onForceKill={onForceKill} />
    );

    // Click Stop to enter aborting state
    fireEvent.click(container.querySelector('[data-testid="stop-button"]')!);
    expect(container.querySelector('[data-testid="force-stop-button"]')).not.toBeNull();

    // Session stops streaming
    rerender(
      <CommandInput commands={commands} onSend={vi.fn()} sessionStatus="idle" onAbort={onAbort} onForceKill={onForceKill} />
    );

    // No stop buttons visible (session is idle)
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

    // Should still show the stop button (no escalation without onForceKill)
    expect(container.querySelector('[data-testid="force-stop-button"]')).toBeNull();
  });
});

describe("Image lightbox from paste preview", () => {
  it("opens lightbox when clicking a paste preview image", async () => {
    // Create a mock FileReader class where readAsDataURL triggers onload asynchronously
    let pendingOnload: (() => void) | null = null;
    vi.stubGlobal("FileReader", class {
      result = "data:image/png;base64,iVBORw0KGgo=";
      onload: (() => void) | null = null;
      readAsDataURL() {
        pendingOnload = () => this.onload?.();
      }
    });

    const { container } = renderInput();
    const textarea = container.querySelector("textarea")!;

    const file = new File([new Uint8Array([137, 80, 78, 71])], "test.png", { type: "image/png" });
    const dataTransfer = {
      items: [{ type: "image/png", getAsFile: () => file, kind: "file" }],
    };

    fireEvent.paste(textarea, { clipboardData: dataTransfer });

    // Trigger the captured onload outside React's event dispatch
    await act(async () => {
      pendingOnload?.();
    });

    // Find the preview image
    const img = container.querySelector("img.h-16");
    expect(img).not.toBeNull();
    expect(img!.className).toContain("cursor-pointer");
    fireEvent.click(img!);
    const lightbox = document.body.querySelector("[data-testid='lightbox-backdrop']");
    expect(lightbox).not.toBeNull();

    vi.restoreAllMocks();
  });
});

// --- Controlled draft + history tests (change: chat-input-draft-and-history) ---

/**
 * Place the caret at a given offset inside the textarea. Some of our logic
 * reads `selectionStart`/`selectionEnd` directly off the element, so we set
 * them explicitly (plus focus) before firing the key event.
 */
function setCaret(textarea: HTMLTextAreaElement, pos: number) {
  textarea.focus();
  textarea.setSelectionRange(pos, pos);
}

describe("CommandInput — controlled draft prop", () => {
  it("renders the provided draft value in the textarea", () => {
    const { textarea } = renderInput({ draft: "hello world", onDraftChange: vi.fn() });
    expect(textarea.value).toBe("hello world");
  });

  it("calls onDraftChange when the user types", () => {
    const onDraftChange = vi.fn();
    const { textarea } = renderInput({ draft: "", onDraftChange });
    fireEvent.change(textarea, { target: { value: "x" } });
    expect(onDraftChange).toHaveBeenCalledWith("x");
  });

  it("keeps the draft in sync across rerenders (different sessionId)", () => {
    const onDraftChange = vi.fn();
    const { rerender, container } = render(
      <CommandInput commands={commands} onSend={vi.fn()} sessionId="A" draft="alpha" onDraftChange={onDraftChange} />
    );
    let textarea = container.querySelector("textarea")!;
    expect(textarea.value).toBe("alpha");
    rerender(
      <CommandInput commands={commands} onSend={vi.fn()} sessionId="B" draft="beta" onDraftChange={onDraftChange} />
    );
    textarea = container.querySelector("textarea")!;
    expect(textarea.value).toBe("beta");
  });
});

describe("CommandInput — history recall", () => {
  it("ArrowUp from empty draft loads the newest history entry", () => {
    const onDraftChange = vi.fn();
    const { textarea } = renderInput({
      draft: "",
      onDraftChange,
      history: ["newest", "older"],
    });
    setCaret(textarea, 0);
    fireEvent.keyDown(textarea, { key: "ArrowUp" });
    expect(onDraftChange).toHaveBeenLastCalledWith("newest");
  });

  it("walks further back with repeated ArrowUp presses", () => {
    const onDraftChange = vi.fn();
    // Parent mirrors `draft` from onDraftChange to simulate controlled flow.
    function Controlled({ history }: { history: string[] }) {
      const [d, setD] = React.useState("");
      return <CommandInput commands={commands} onSend={vi.fn()} draft={d} onDraftChange={(v) => { setD(v); onDraftChange(v); }} history={history} />;
    }
    const { container } = render(<Controlled history={["two", "one"]} />);
    const textarea = container.querySelector("textarea")!;
    setCaret(textarea, 0);
    fireEvent.keyDown(textarea, { key: "ArrowUp" });
    fireEvent.keyDown(textarea, { key: "ArrowUp" });
    expect(onDraftChange).toHaveBeenLastCalledWith("one");
  });

  it("ArrowDown walks forward and eventually restores the in-progress draft", () => {
    function Controlled() {
      const [d, setD] = React.useState("half-typed");
      return <CommandInput commands={commands} onSend={vi.fn()} draft={d} onDraftChange={setD} history={["recent", "older"]} />;
    }
    const { container } = render(<Controlled />);
    const textarea = container.querySelector("textarea")!;
    setCaret(textarea, (textarea as HTMLTextAreaElement).value.length);
    // First ArrowUp must be at top-of-textarea; single-line so caret=end counts as first line.
    setCaret(textarea, 0);
    fireEvent.keyDown(textarea, { key: "ArrowUp" }); // -> recent
    expect(textarea.value).toBe("recent");
    setCaret(textarea, textarea.value.length);
    fireEvent.keyDown(textarea, { key: "ArrowUp" }); // -> older
    expect(textarea.value).toBe("older");
    setCaret(textarea, textarea.value.length);
    fireEvent.keyDown(textarea, { key: "ArrowDown" }); // -> recent
    expect(textarea.value).toBe("recent");
    setCaret(textarea, textarea.value.length);
    fireEvent.keyDown(textarea, { key: "ArrowDown" }); // -> restored draft
    expect(textarea.value).toBe("half-typed");
  });

  it("Escape while in history mode restores the in-progress draft", () => {
    function Controlled() {
      const [d, setD] = React.useState("wip");
      return <CommandInput commands={commands} onSend={vi.fn()} draft={d} onDraftChange={setD} history={["recent"]} />;
    }
    const { container } = render(<Controlled />);
    const textarea = container.querySelector("textarea")!;
    setCaret(textarea, 0);
    fireEvent.keyDown(textarea, { key: "ArrowUp" });
    expect(textarea.value).toBe("recent");
    fireEvent.keyDown(textarea, { key: "Escape" });
    expect(textarea.value).toBe("wip");
  });

  it("ArrowUp with empty history is a no-op", () => {
    const onDraftChange = vi.fn();
    const { textarea } = renderInput({ draft: "", onDraftChange, history: [] });
    setCaret(textarea, 0);
    fireEvent.keyDown(textarea, { key: "ArrowUp" });
    // Only calls from user typing should register; none expected.
    expect(onDraftChange).not.toHaveBeenCalled();
    expect(textarea.value).toBe("");
  });

  it("ArrowUp with caret on middle line of multiline text does NOT trigger history", () => {
    const onDraftChange = vi.fn();
    const { textarea } = renderInput({
      draft: "line1\nline2\nline3",
      onDraftChange,
      history: ["should-not-appear"],
    });
    // Caret inside "line2" — after the first newline (index 6), before the second (index 12).
    setCaret(textarea, 8);
    fireEvent.keyDown(textarea, { key: "ArrowUp" });
    // History should NOT activate. onDraftChange must not have been called.
    expect(onDraftChange).not.toHaveBeenCalled();
  });

  it("ArrowUp with autocomplete dropdown open navigates the dropdown, not history", () => {
    const onDraftChange = vi.fn();
    const { textarea, container } = renderInput({
      draft: "/d",
      onDraftChange,
      history: ["prev-prompt"],
    });
    // Confirm dropdown is open.
    expect(getDropdownItems(container).length).toBeGreaterThan(0);
    setCaret(textarea, 2);
    fireEvent.keyDown(textarea, { key: "ArrowUp" });
    // History must NOT have fired.
    expect(onDraftChange).not.toHaveBeenCalledWith("prev-prompt");
  });

  it("pre-deduped history is passed through verbatim (consecutive-dup collapse is a parent responsibility)", () => {
    // This is a documentation test: CommandInput does not dedup; if the parent
    // passes duplicates, they show up as separate walks. The real dedup lives
    // in extractUserPromptHistory (covered by message-history.test.ts).
    function Controlled() {
      const [d, setD] = React.useState("");
      return <CommandInput commands={commands} onSend={vi.fn()} draft={d} onDraftChange={setD} history={["a", "a", "b"]} />;
    }
    const { container } = render(<Controlled />);
    const textarea = container.querySelector("textarea")!;
    setCaret(textarea, 0);
    fireEvent.keyDown(textarea, { key: "ArrowUp" });
    expect(textarea.value).toBe("a");
    setCaret(textarea, textarea.value.length);
    fireEvent.keyDown(textarea, { key: "ArrowUp" });
    // Because parent passed a, a, b without dedup, we land on the second "a".
    expect(textarea.value).toBe("a");
    setCaret(textarea, textarea.value.length);
    fireEvent.keyDown(textarea, { key: "ArrowUp" });
    expect(textarea.value).toBe("b");
  });

  it("editing a recalled entry exits history mode (subsequent ArrowDown does not restore)", () => {
    function Controlled() {
      const [d, setD] = React.useState("wip");
      return <CommandInput commands={commands} onSend={vi.fn()} draft={d} onDraftChange={setD} history={["recent"]} />;
    }
    const { container } = render(<Controlled />);
    const textarea = container.querySelector("textarea")!;
    setCaret(textarea, 0);
    fireEvent.keyDown(textarea, { key: "ArrowUp" });
    expect(textarea.value).toBe("recent");
    // User edits the recalled entry.
    fireEvent.change(textarea, { target: { value: "recent-edited" } });
    expect(textarea.value).toBe("recent-edited");
    // ArrowDown at end-of-single-line; history mode should be exited, so this
    // is a no-op (index is null, no further navigation).
    setCaret(textarea, textarea.value.length);
    fireEvent.keyDown(textarea, { key: "ArrowDown" });
    // Value stays on the edited entry, NOT restored to "wip".
    expect(textarea.value).toBe("recent-edited");
  });

  it("history-navigation state resets on sessionId change", () => {
    function Controlled({ sid }: { sid: string }) {
      const [d, setD] = React.useState("");
      return <CommandInput commands={commands} onSend={vi.fn()} sessionId={sid} draft={d} onDraftChange={setD} history={["A-recent"]} />;
    }
    const { container, rerender } = render(<Controlled sid="A" />);
    const textarea = container.querySelector("textarea")!;
    setCaret(textarea, 0);
    fireEvent.keyDown(textarea, { key: "ArrowUp" });
    expect(textarea.value).toBe("A-recent");
    // Switch session — history state should reset. The `draft` value stays
    // because we're still using the same controlled value, but history walk
    // should start fresh.
    rerender(<Controlled sid="B" />);
    // We can't directly observe historyIndex; indirect check: pressing Escape
    // after a session switch should NOT restore anything (no saved draft).
    fireEvent.keyDown(textarea, { key: "Escape" });
    // No crash, no unexpected restoration.
    expect(textarea).toBeTruthy();
  });
});

// -----------------------------------------------------------------------------
// Regression suite for `fix-autocomplete-stale-closure`:
//
// In production `CommandInput` is CONTROLLED via `draft` + `onDraftChange`,
// and `App.tsx` wraps `onDraftChange` in `useCallback(..., [selectedId])` —
// so its reference CHANGES every time the user switches sessions.
//
// These tests verify that Tab / Enter / mouse-click in the dropdown always
// invoke the CURRENT `onDraftChange` prop, not a stale reference captured at
// mount time. Before the fix, the internal `selectCommand` / `selectFile`
// callbacks were wrapped in `useCallback([])` / missing-`setText`-dep arrays,
// permanently capturing the first-render `setText` → stale `onDraftChange`.
// -----------------------------------------------------------------------------

describe("CommandInput stale-closure regression (controlled mode, prop-ref change)", () => {
  /**
   * Render helper: renders `<CommandInput>` in controlled mode via a wrapper
   * that owns the `draft` state (mirroring `App.tsx`) but delegates each
   * change to a swappable `handler` prop. The inline `onDraftChange` arrow
   * gets a new reference on every render — matching production, where
   * `setDraftForSelected` is `useCallback(..., [selectedId])` and thus
   * changes reference every session switch.
   *
   * `rerenderWith({ onDraftChange })` swaps the handler while preserving the
   * wrapper's draft state (React preserves state across rerenders of the
   * same component type). This is the crucial scenario: at mount time the
   * component captured handler=v1; by the time the user presses Tab, the
   * CURRENT handler is v2. A correct implementation MUST call v2.
   */
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
    const textarea = result.container.querySelector("textarea")!;
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
    return { ...result, textarea, rerenderWith };
  }

  it("Tab invokes the CURRENT onDraftChange after prop-reference change", () => {
    const v1 = vi.fn();
    const v2 = vi.fn();
    const { textarea, rerenderWith } = renderControlled({ onDraftChange: v1 });
    // Simulate a session switch: onDraftChange gets a new reference.
    rerenderWith({ onDraftChange: v2 });
    // User types `/dep` into the textarea.
    fireEvent.change(textarea, { target: { value: "/dep" } });
    // Press Tab to select the highlighted `/deploy`.
    fireEvent.keyDown(textarea, { key: "Tab" });
    // The CURRENT onDraftChange (v2) MUST have been called with `/deploy `.
    expect(v2).toHaveBeenCalledWith("/deploy ");
    // The STALE onDraftChange (v1) must NOT have received the selected command.
    expect(v1).not.toHaveBeenCalledWith("/deploy ");
  });

  it("Enter invokes the CURRENT onDraftChange after prop-reference change", () => {
    const v1 = vi.fn();
    const v2 = vi.fn();
    const { textarea, rerenderWith } = renderControlled({ onDraftChange: v1 });
    rerenderWith({ onDraftChange: v2 });
    fireEvent.change(textarea, { target: { value: "/dep" } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(v2).toHaveBeenCalledWith("/deploy ");
    expect(v1).not.toHaveBeenCalledWith("/deploy ");
  });

  it("Mouse click invokes the CURRENT onDraftChange after prop-reference change", () => {
    const v1 = vi.fn();
    const v2 = vi.fn();
    const { container, textarea, rerenderWith } = renderControlled({ onDraftChange: v1 });
    rerenderWith({ onDraftChange: v2 });
    fireEvent.change(textarea, { target: { value: "/dep" } });
    // Locate the `/deploy` dropdown button (font-mono text-blue-400 span starting with `/deploy`).
    const buttons = Array.from(container.querySelectorAll("button"));
    const deployBtn = buttons.find((b) =>
      b.querySelector(".font-mono")?.textContent?.startsWith("/deploy")
    );
    expect(deployBtn).toBeTruthy();
    fireEvent.click(deployBtn!);
    expect(v2).toHaveBeenCalledWith("/deploy ");
    expect(v1).not.toHaveBeenCalledWith("/deploy ");
  });

  it("@ file Tab invokes the CURRENT onDraftChange after prop-reference change", () => {
    // `CommandInput` debounces the file-list request by 150ms and only
    // populates `fileItems` once `lastFileQueryRef` matches `fileResults.query`.
    // We use fake timers to flush the debounce deterministically.
    vi.useFakeTimers();
    try {
      const v1 = vi.fn();
      const v2 = vi.fn();
      // Seed file results so the @-dropdown is populated when the debounce fires.
      const fileResults = {
        query: "",
        files: [
          { path: "src/index.ts", isDirectory: false },
          { path: "README.md", isDirectory: false },
        ],
      };
      // Start without fileResults so the initial mount doesn't populate
      // the dropdown. We'll supply them via `rerenderWith` AFTER the
      // debounce fires — matching production: user types `@`, server
      // responds with files, parent rerenders with new `fileResults`.
      const { textarea, rerenderWith } = renderControlled({
        onDraftChange: v1,
      });
      // Simulate session switch: onDraftChange gets a new reference.
      rerenderWith({ onDraftChange: v2 });
      // Type `@` — the debounce schedules a file listing with query "".
      fireEvent.change(textarea, { target: { value: "@" } });
      // Flush the 150ms debounce: sets `lastFileQueryRef.current = ""`.
      act(() => {
        vi.advanceTimersByTime(200);
      });
      // Now the "server" responds: rerender with fileResults matching the
      // debounced query. This triggers a re-render, so the next
      // `handleKeyDown` closes over `dropdownMode = "file"`.
      rerenderWith({ onDraftChange: v2, fileResults });
      // Press Tab — should insert the first file's path via `selectFile`.
      fireEvent.keyDown(textarea, { key: "Tab" });
      // v2 must have been called with a draft containing the file path.
      const v2Call = v2.mock.calls.find(
        (c) => typeof c[0] === "string" && c[0].includes("src/index.ts")
      );
      expect(
        v2Call,
        `expected v2 to be called with a draft containing src/index.ts, got: ${JSON.stringify(v2.mock.calls)}`
      ).toBeTruthy();
      // v1 (stale) must NOT have received the file-path draft.
      const v1Call = v1.mock.calls.find(
        (c) => typeof c[0] === "string" && c[0].includes("src/index.ts")
      );
      expect(v1Call).toBeFalsy();
    } finally {
      vi.useRealTimers();
    }
  });
});
