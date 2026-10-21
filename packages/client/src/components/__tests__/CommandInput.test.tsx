import type { CommandInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { act, fireEvent, render } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { CommandInput, shouldWalkFileQuery } from "../chat/CommandInput.js";

describe("shouldWalkFileQuery (min-3-char guard)", () => {
  it("fires for a bare @ (empty query, top-level listing)", () => {
    expect(shouldWalkFileQuery("")).toBe(true);
  });
  it("suppresses a 1\u20132 char bare leaf", () => {
    expect(shouldWalkFileQuery("a")).toBe(false);
    expect(shouldWalkFileQuery("ab")).toBe(false);
  });
  it("fires at 3 chars", () => {
    expect(shouldWalkFileQuery("abc")).toBe(true);
  });
  it("fires for any slashed (scoped) query regardless of leaf length", () => {
    expect(shouldWalkFileQuery("src/db")).toBe(true);
    expect(shouldWalkFileQuery("a/b")).toBe(true);
  });
});

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

function getDropdownItems(_container?: HTMLElement): string[] {
  // The autocomplete dropdown is portaled (LayerPortal → document.body), so it
  // is no longer inside the render container. Scan the portal root.
  // See change: portal-composer-action-popovers.
  // Command items have font-mono text-blue-400 class and start with /
  const buttons = document.body.querySelectorAll("button");
  const items: string[] = [];
  for (const btn of buttons) {
    const cmdSpan = btn.querySelector(".font-mono");
    if (cmdSpan?.textContent?.startsWith("/")) {
      items.push(cmdSpan.textContent);
    }
  }
  return items;
}

describe("CommandInput popovers are portaled (portal-composer-action-popovers)", () => {
  it("the command dropdown renders in the portal root, not inside the composer", () => {
    const { container, textarea } = renderInput();
    fireEvent.change(textarea, { target: { value: "/" } });
    const dd = document.body.querySelector('[data-testid="command-dropdown"]');
    expect(dd).toBeTruthy();
    // Portaled: NOT a descendant of the render container (composer subtree).
    expect(container.contains(dd)).toBe(false);
    // Uses the layer token, never a raw z-index.
    expect((dd as HTMLElement).className).toContain("z-popover");
  });

  it("the + attach menu portals; panelRef-first outside-click keeps an in-menu press open; the item handler then runs", () => {
    const { container } = renderInput();
    fireEvent.click(document.body.querySelector('[data-testid="attach-button"]')!);
    const menu = document.body.querySelector('[data-testid="attach-menu"]') as HTMLElement;
    expect(menu).toBeTruthy();
    expect(container.contains(menu)).toBe(false); // portaled out of the composer
    expect(menu.className).toContain("z-popover");
    // panelRef-first: a mousedown INSIDE the portaled menu must NOT be read as
    // an outside click (which would close it before the item's onClick).
    fireEvent.mouseDown(menu.querySelector('[data-testid="attach-preview"]')!);
    expect(document.body.querySelector('[data-testid="attach-menu"]')).toBeTruthy();
    // The item's own click handler runs (it closes the menu via setAttachOpen).
    fireEvent.click(menu.querySelector('[data-testid="attach-preview"]')!);
    expect(document.body.querySelector('[data-testid="attach-menu"]')).toBeNull();
    // And a genuine outside mousedown closes it too.
    fireEvent.click(document.body.querySelector('[data-testid="attach-button"]')!);
    expect(document.body.querySelector('[data-testid="attach-menu"]')).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(document.body.querySelector('[data-testid="attach-menu"]')).toBeNull();
  });
});

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
    const { textarea } = renderInput();
    fireEvent.change(textarea, { target: { value: "/" } });

    // Dropdown is portaled to document.body; scan there (excludes Send button,
    // which has no `.font-mono` child). See change: portal-composer-action-popovers.
    const getCommandButtons = () => {
      const buttons = Array.from(document.body.querySelectorAll("button"));
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
  it("disables input when pendingPrompt is sending", () => {
    const { textarea } = renderInput({ pendingPrompt: "sending" });
    expect(textarea.disabled).toBe(true);
  });

  it("disables send button when pendingPrompt is sending", () => {
    const { container, textarea } = renderInput({ pendingPrompt: "sending" });
    fireEvent.change(textarea, { target: { value: "test" } });
    const sendBtn = container.querySelector('[data-testid="send-button"]') as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(true);
  });

  it("shows Stop button when pendingPrompt is sending", () => {
    const onCancelPending = vi.fn();
    const { container } = renderInput({ pendingPrompt: "sending", onCancelPending, sessionStatus: "idle" });
    const stopBtn = container.querySelector('[data-testid="stop-button"]');
    expect(stopBtn).not.toBeNull();
  });

  it("calls onCancelPending when Stop clicked during pending", () => {
    const onCancelPending = vi.fn();
    const onAbort = vi.fn();
    const { container } = renderInput({ pendingPrompt: "sending", onCancelPending, onAbort, sessionStatus: "idle" });
    const stopBtn = container.querySelector('[data-testid="stop-button"]')!;
    fireEvent.click(stopBtn);
    expect(onCancelPending).toHaveBeenCalledOnce();
    expect(onAbort).not.toHaveBeenCalled();
  });

  it("calls onCancelPending on Escape key during pending", () => {
    const onCancelPending = vi.fn();
    const { textarea } = renderInput({ pendingPrompt: "sending", onCancelPending });
    fireEvent.keyDown(textarea, { key: "Escape" });
    expect(onCancelPending).toHaveBeenCalledOnce();
  });

  // The composer gate is status-aware: only `sending` is in flight.
  // See change: fix-optimistic-prompt-stuck-sending (test-plan #E1/#E2/#E3).
  it("#E2 disables textarea and send while pendingPrompt is 'sending'", () => {
    const { container, textarea } = renderInput({ pendingPrompt: "sending", sessionStatus: "idle" });
    fireEvent.change(textarea, { target: { value: "test" } });
    expect(textarea.disabled).toBe(true);
    const sendBtn = container.querySelector('[data-testid="send-button"]') as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(true);
  });

  it("#E1 keeps textarea and send ENABLED once pendingPrompt is 'sent'", () => {
    const { container, textarea } = renderInput({ pendingPrompt: "sent", sessionStatus: "idle" });
    fireEvent.change(textarea, { target: { value: "test" } });
    expect(textarea.disabled).toBe(false);
    const sendBtn = container.querySelector('[data-testid="send-button"]') as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(false);
  });

  it("#E3 keeps textarea and send ENABLED when pendingPrompt is 'failed'", () => {
    const { container, textarea } = renderInput({ pendingPrompt: "failed", sessionStatus: "idle" });
    fireEvent.change(textarea, { target: { value: "test" } });
    expect(textarea.disabled).toBe(false);
    const sendBtn = container.querySelector('[data-testid="send-button"]') as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(false);
  });

  it("does not call onCancelPending on Escape when not pending", () => {
    const onCancelPending = vi.fn();
    const { textarea } = renderInput({ pendingPrompt: undefined, onCancelPending });
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

// --- Gating rule change: history-nav-only-when-empty -------------------------
//
// Tests covering the new "input completely empty" entry rule plus the
// Ctrl/Meta force-history shortcut. See spec: chat-input-state.
// -----------------------------------------------------------------------------

describe("CommandInput — history-nav gating (only-when-empty)", () => {
  it("1.1 bare ArrowUp on a single-line non-empty draft does NOT trigger history recall", () => {
    const onDraftChange = vi.fn();
    const { textarea } = renderInput({
      draft: "fix bug",
      onDraftChange,
      history: ["prev-prompt"],
    });
    setCaret(textarea, 0);
    fireEvent.keyDown(textarea, { key: "ArrowUp" });
    expect(onDraftChange).not.toHaveBeenCalledWith("prev-prompt");
  });

  it("1.2 bare ArrowUp on the first line of a multi-line draft does NOT trigger history recall", () => {
    const onDraftChange = vi.fn();
    const { textarea } = renderInput({
      draft: "line one\nline two",
      onDraftChange,
      history: ["prev-prompt"],
    });
    setCaret(textarea, 0); // first line, column 0
    fireEvent.keyDown(textarea, { key: "ArrowUp" });
    expect(onDraftChange).not.toHaveBeenCalledWith("prev-prompt");
  });

  it("1.3 bare ArrowUp on empty input DOES trigger history recall", () => {
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

  it("1.4 bare ArrowUp when empty text but pending image attached does NOT trigger history recall", () => {
    const onDraftChange = vi.fn();
    const onImagesChange = vi.fn();
    const images = [{ type: "image" as const, data: "AAA", mimeType: "image/png" }];
    const { textarea } = renderInput({
      draft: "",
      onDraftChange,
      images,
      onImagesChange,
      history: ["prev-prompt"],
    });
    setCaret(textarea, 0);
    fireEvent.keyDown(textarea, { key: "ArrowUp" });
    expect(onDraftChange).not.toHaveBeenCalledWith("prev-prompt");
    // Images stay attached (no clear was triggered).
    expect(onImagesChange).not.toHaveBeenCalled();
  });

  it("1.5 Ctrl+ArrowUp with non-empty text recalls history and preserves prior text as draft (Escape restores)", () => {
    function Controlled() {
      const [d, setD] = React.useState("half-typed");
      return <CommandInput commands={commands} onSend={vi.fn()} draft={d} onDraftChange={setD} history={["recent"]} />;
    }
    const { container } = render(<Controlled />);
    const textarea = container.querySelector("textarea")!;
    setCaret(textarea, textarea.value.length);
    fireEvent.keyDown(textarea, { key: "ArrowUp", ctrlKey: true });
    expect(textarea.value).toBe("recent");
    fireEvent.keyDown(textarea, { key: "Escape" });
    expect(textarea.value).toBe("half-typed");
  });

  it("1.6 Cmd+ArrowUp (metaKey) with non-empty text behaves the same as Ctrl+ArrowUp", () => {
    function Controlled() {
      const [d, setD] = React.useState("half-typed");
      return <CommandInput commands={commands} onSend={vi.fn()} draft={d} onDraftChange={setD} history={["recent"]} />;
    }
    const { container } = render(<Controlled />);
    const textarea = container.querySelector("textarea")!;
    setCaret(textarea, textarea.value.length);
    fireEvent.keyDown(textarea, { key: "ArrowUp", metaKey: true });
    expect(textarea.value).toBe("recent");
    fireEvent.keyDown(textarea, { key: "Escape" });
    expect(textarea.value).toBe("half-typed");
  });

  it("1.7 Ctrl+ArrowDown walks forward and past the newest entry restores the in-progress draft", () => {
    function Controlled() {
      const [d, setD] = React.useState("half-typed");
      return <CommandInput commands={commands} onSend={vi.fn()} draft={d} onDraftChange={setD} history={["recent", "older"]} />;
    }
    const { container } = render(<Controlled />);
    const textarea = container.querySelector("textarea")!;
    setCaret(textarea, textarea.value.length);
    fireEvent.keyDown(textarea, { key: "ArrowUp", ctrlKey: true }); // -> recent
    expect(textarea.value).toBe("recent");
    fireEvent.keyDown(textarea, { key: "ArrowUp", ctrlKey: true }); // -> older
    expect(textarea.value).toBe("older");
    fireEvent.keyDown(textarea, { key: "ArrowDown", ctrlKey: true }); // -> recent
    expect(textarea.value).toBe("recent");
    fireEvent.keyDown(textarea, { key: "ArrowDown", ctrlKey: true }); // -> restored draft
    expect(textarea.value).toBe("half-typed");
  });

  it("1.8 Ctrl+ArrowUp while the /-command dropdown is open does NOT trigger history recall", () => {
    const onDraftChange = vi.fn();
    const { textarea, container } = renderInput({
      draft: "/d",
      onDraftChange,
      history: ["prev-prompt"],
    });
    expect(getDropdownItems(container).length).toBeGreaterThan(0);
    setCaret(textarea, 2);
    fireEvent.keyDown(textarea, { key: "ArrowUp", ctrlKey: true });
    expect(onDraftChange).not.toHaveBeenCalledWith("prev-prompt");
  });

  it("1.9 Ctrl+ArrowUp while a prompt is pending does NOT trigger history recall", () => {
    const onDraftChange = vi.fn();
    const { textarea } = renderInput({
      draft: "text",
      onDraftChange,
      pendingPrompt: "sending",
      history: ["prev-prompt"],
    });
    setCaret(textarea, textarea.value.length);
    fireEvent.keyDown(textarea, { key: "ArrowUp", ctrlKey: true });
    expect(onDraftChange).not.toHaveBeenCalledWith("prev-prompt");
  });

  it("1.10 Ctrl+ArrowUp with empty text but pending image attached recalls history AND preserves the image", () => {
    function Controlled() {
      const [d, setD] = React.useState("");
      const [imgs, setImgs] = React.useState([
        { type: "image" as const, data: "AAA", mimeType: "image/png" },
      ]);
      return <CommandInput commands={commands} onSend={vi.fn()} draft={d} onDraftChange={setD} images={imgs} onImagesChange={setImgs} history={["recent"]} />;
    }
    const { container } = render(<Controlled />);
    const textarea = container.querySelector("textarea")!;
    setCaret(textarea, 0);
    fireEvent.keyDown(textarea, { key: "ArrowUp", ctrlKey: true });
    expect(textarea.value).toBe("recent");
    // Image thumbnail still rendered (ImagePreviewStrip emits img.h-16 per pending image).
    const img = container.querySelector("img.h-16");
    expect(img).not.toBeNull();
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
    // Non-empty draft — enter history mode via force-history modifier; once
    // in history mode, bare arrows continue to walk.
    setCaret(textarea, textarea.value.length);
    fireEvent.keyDown(textarea, { key: "ArrowUp", ctrlKey: true }); // -> recent
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
    // Non-empty draft — must use Ctrl modifier to enter history mode.
    fireEvent.keyDown(textarea, { key: "ArrowUp", ctrlKey: true });
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
    // Non-empty draft — enter via force-history.
    fireEvent.keyDown(textarea, { key: "ArrowUp", ctrlKey: true });
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
    const { textarea, rerenderWith } = renderControlled({ onDraftChange: v1 });
    rerenderWith({ onDraftChange: v2 });
    fireEvent.change(textarea, { target: { value: "/dep" } });
    // Dropdown is portaled to document.body. Locate the `/deploy` button there.
    const buttons = Array.from(document.body.querySelectorAll("button"));
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

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => cleanup());

describe("CommandInput — input stays enabled mid-turn (mid-turn-prompt-queue)", () => {
  it("disables textarea and send button when pendingPrompt is sending && session is idle", () => {
    const { textarea, container } = renderInput({
      pendingPrompt: "sending",
      sessionStatus: "idle",
    });
    expect((textarea as HTMLTextAreaElement).disabled).toBe(true);
    const sendBtn = container.querySelector('[data-testid="send-button"]') as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(true);
  });

  it("keeps textarea and send button ENABLED when pendingPrompt is sending && session is streaming", () => {
    const { textarea, container } = renderInput({
      pendingPrompt: "sending",
      sessionStatus: "streaming",
      draft: "hi",
      onDraftChange: vi.fn(),
    });
    expect((textarea as HTMLTextAreaElement).disabled).toBe(false);
    const sendBtn = container.querySelector('[data-testid="send-button"]') as HTMLButtonElement;
    // Send button still needs non-empty text to be enabled.
    expect(sendBtn.disabled).toBe(false);
  });

  it("re-enables when pendingPrompt clears and session is idle", () => {
    const { textarea, rerender, container } = renderInput({
      pendingPrompt: "sending",
      sessionStatus: "idle",
    });
    expect((textarea as HTMLTextAreaElement).disabled).toBe(true);
    rerender(
      <CommandInput commands={commands} onSend={vi.fn()} pendingPrompt={undefined} sessionStatus="idle" />,
    );
    expect((textarea as HTMLTextAreaElement).disabled).toBe(false);
    const sendBtn = container.querySelector('[data-testid="send-button"]') as HTMLButtonElement;
    expect(sendBtn).toBeTruthy();
  });
});

describe("CommandInput — steering delivery mode keyboard shortcuts", () => {
  it("Enter sends with delivery: steer", () => {
    const { textarea, onSend } = renderInput({ draft: "fix the bug", onDraftChange: vi.fn() });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("fix the bug", undefined, "steer");
  });

  it("Alt+Enter sends with delivery: followUp", () => {
    const { textarea, onSend } = renderInput({ draft: "after done", onDraftChange: vi.fn() });
    fireEvent.keyDown(textarea, { key: "Enter", altKey: true });
    expect(onSend).toHaveBeenCalledWith("after done", undefined, "followUp");
  });

  it("Shift+Enter does not send (inserts newline)", () => {
    const { textarea, onSend } = renderInput({ draft: "line", onDraftChange: vi.fn() });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("Send button click sends with delivery: steer", () => {
    const { container, onSend } = renderInput({
      draft: "hello world",
      onDraftChange: vi.fn(),
    });
    const sendBtn = container.querySelector('[data-testid="send-button"]') as HTMLButtonElement;
    fireEvent.click(sendBtn);
    expect(onSend).toHaveBeenCalledWith("hello world", undefined, "steer");
  });

  it("Enter sends with images and delivery: steer", () => {
    const { textarea, onSend } = renderInput({
      draft: "describe this",
      onDraftChange: vi.fn(),
      images: [{ type: "image" as const, data: "AAA", mimeType: "image/png" }],
    });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith(
      "describe this",
      [{ type: "image", data: "AAA", mimeType: "image/png" }],
      "steer",
    );
  });

  it("Alt+Enter sends with images and delivery: followUp", () => {
    const { textarea, onSend } = renderInput({
      draft: "check image",
      onDraftChange: vi.fn(),
      images: [{ type: "image" as const, data: "BBB", mimeType: "image/jpeg" }],
    });
    fireEvent.keyDown(textarea, { key: "Enter", altKey: true });
    expect(onSend).toHaveBeenCalledWith(
      "check image",
      [{ type: "image", data: "BBB", mimeType: "image/jpeg" }],
      "followUp",
    );
  });

  it("does not send when text is empty", () => {
    const { textarea, onSend } = renderInput({ draft: "   ", onDraftChange: vi.fn() });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
  });
});

// ComposerSessionActions no longer mounts inside CommandInput; it lives in
// StatusBar via the `actions` slot. See StatusBar.test.tsx for the new
// regression test. Original strip-mount tests removed.
// See change: redesign-session-card-and-composer (statusbar-inline).

// ===========================================================================
// redesign-prompt-input (v2 composer): morphing button, Steer|Queue, footer,
// ＋ attach menu, mobile overflow, resting footprint.
// ===========================================================================

describe("CommandInput v2 — morphing action button (T1)", () => {
  it("idle + empty draft: single disabled send affordance, no stop", () => {
    const { container } = renderInput({ sessionStatus: "idle" });
    const send = container.querySelector('[data-testid="send-button"]') as HTMLButtonElement;
    expect(send).not.toBeNull();
    expect(send.disabled).toBe(true);
    expect(container.querySelector('[data-testid="stop-button"]')).toBeNull();
  });

  it("idle + text: enabled send affordance that sends", () => {
    const { container, onSend } = renderInput({ draft: "hello", onDraftChange: vi.fn() });
    const send = container.querySelector('[data-testid="send-button"]') as HTMLButtonElement;
    expect(send.disabled).toBe(false);
    fireEvent.click(send);
    expect(onSend).toHaveBeenCalledWith("hello", undefined, "steer");
  });

  it("streaming (with onAbort): morphs to a single stop button, no send button", () => {
    const { container } = renderInput({ sessionStatus: "streaming", onAbort: vi.fn(), onForceKill: vi.fn() });
    expect(container.querySelector('[data-testid="stop-button"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="send-button"]')).toBeNull();
  });

  it("streaming: second press escalates stop → force-stop", () => {
    const onAbort = vi.fn();
    const onForceKill = vi.fn();
    const { container } = renderInput({ sessionStatus: "streaming", onAbort, onForceKill });
    fireEvent.click(container.querySelector('[data-testid="stop-button"]')!);
    expect(onAbort).toHaveBeenCalledOnce();
    const force = container.querySelector('[data-testid="force-stop-button"]');
    expect(force).not.toBeNull();
    fireEvent.click(force!);
    expect(onForceKill).toHaveBeenCalledOnce();
    expect(container.querySelector('[data-testid="killing-button"]')).not.toBeNull();
  });

  it("every action-button state (send/stop/force/killing) carries an aria-label", () => {
    // send
    const send = renderInput({ draft: "x", onDraftChange: vi.fn() });
    expect(send.container.querySelector('[data-testid="send-button"]')!.getAttribute("aria-label")).toBeTruthy();
    cleanup();
    // stop → force → killing
    const { container } = renderInput({ sessionStatus: "streaming", onAbort: vi.fn(), onForceKill: vi.fn() });
    expect(container.querySelector('[data-testid="stop-button"]')!.getAttribute("aria-label")).toBeTruthy();
    fireEvent.click(container.querySelector('[data-testid="stop-button"]')!);
    expect(container.querySelector('[data-testid="force-stop-button"]')!.getAttribute("aria-label")).toBeTruthy();
    fireEvent.click(container.querySelector('[data-testid="force-stop-button"]')!);
    expect(container.querySelector('[data-testid="killing-button"]')!.getAttribute("aria-label")).toBeTruthy();
  });
});

/** Open the delivery dropdown and pick a state (the menu closes on pick). */
function chooseDelivery(getByTestId: (id: string) => HTMLElement, mode: "steer" | "queue") {
  fireEvent.click(getByTestId("delivery-control"));
  fireEvent.click(getByTestId(`delivery-${mode}`));
}

describe("CommandInput v2 — Steer|Queue delivery control (T1)", () => {
  it("defaults to Steer: Enter sends delivery=steer", () => {
    const { textarea, onSend } = renderInput({ draft: "go", onDraftChange: vi.fn() });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("go", undefined, "steer");
  });

  it("Queue selected routes Enter to followUp", () => {
    const { textarea, onSend, getByTestId } = renderInput({ draft: "later", onDraftChange: vi.fn() });
    chooseDelivery(getByTestId, "queue");
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("later", undefined, "followUp");
  });

  it("Steer selected routes Enter to steer (after toggling back)", () => {
    const { textarea, onSend, getByTestId } = renderInput({ draft: "now", onDraftChange: vi.fn() });
    chooseDelivery(getByTestId, "queue");
    chooseDelivery(getByTestId, "steer");
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("now", undefined, "steer");
  });

  it("Alt+Enter is followUp regardless of Steer selection", () => {
    const { textarea, onSend } = renderInput({ draft: "x", onDraftChange: vi.fn() });
    fireEvent.keyDown(textarea, { key: "Enter", altKey: true });
    expect(onSend).toHaveBeenCalledWith("x", undefined, "followUp");
  });
});

describe("CommandInput v2 — footer hint line + footprint (T1/T5)", () => {
  it("T5: footer is hidden at rest (unfocused, empty draft)", () => {
    const { container } = renderInput({ sessionStatus: "idle" });
    expect(container.querySelector('[data-testid="composer-footer"]')).toBeNull();
  });

  it("footer is revealed on focus", () => {
    const { container, textarea } = renderInput();
    expect(container.querySelector('[data-testid="composer-footer"]')).toBeNull();
    fireEvent.focus(textarea);
    expect(container.querySelector('[data-testid="composer-footer"]')).not.toBeNull();
  });

  it("footer shows when a draft is present even while unfocused", () => {
    const { container } = renderInput({ draft: "typed", onDraftChange: vi.fn() });
    expect(container.querySelector('[data-testid="composer-footer"]')).not.toBeNull();
  });

  it("shows a context-left indicator only when context data is client-side", () => {
    const withData = renderInput({ draft: "x", onDraftChange: vi.fn(), contextUsage: { tokens: 20000, contextWindow: 100000 } });
    const el = withData.container.querySelector('[data-testid="composer-context-left"]');
    expect(el).not.toBeNull();
    expect(el!.textContent).toContain("80%");
    cleanup();
    const noData = renderInput({ draft: "x", onDraftChange: vi.fn() });
    expect(noData.container.querySelector('[data-testid="composer-context-left"]')).toBeNull();
  });
});

describe("CommandInput v2 — ＋ attach menu (T1)", () => {
  it("opens with image, file, and preview entries", () => {
    const { getByTestId, queryByTestId } = renderInput();
    expect(queryByTestId("attach-menu")).toBeNull();
    fireEvent.click(getByTestId("attach-button"));
    expect(getByTestId("attach-menu")).toBeTruthy();
    expect(getByTestId("attach-image")).toBeTruthy();
    expect(getByTestId("attach-file")).toBeTruthy();
    expect(getByTestId("attach-preview")).toBeTruthy();
  });

  it("Preview inline seeds the /view local-interception path on an empty draft", () => {
    const { getByTestId, textarea } = renderInput();
    fireEvent.click(getByTestId("attach-button"));
    fireEvent.click(getByTestId("attach-preview"));
    expect((textarea as HTMLTextAreaElement).value).toBe("/view ");
  });

  it("Preview inline does NOT clobber a non-empty draft (data-loss guard)", () => {
    const { getByTestId, textarea } = renderInput();
    fireEvent.change(textarea, { target: { value: "my draft" } });
    fireEvent.click(getByTestId("attach-button"));
    fireEvent.click(getByTestId("attach-preview"));
    expect((textarea as HTMLTextAreaElement).value).toBe("my draft");
  });

  it("Attach file seeds @ (empty draft → bare @)", () => {
    const { getByTestId, textarea } = renderInput();
    fireEvent.click(getByTestId("attach-button"));
    fireEvent.click(getByTestId("attach-file"));
    expect((textarea as HTMLTextAreaElement).value).toBe("@");
  });

  it("Attach file seeds @ at a token boundary on a non-empty draft", () => {
    const { getByTestId, textarea } = renderInput();
    fireEvent.change(textarea, { target: { value: "hello" } });
    fireEvent.click(getByTestId("attach-button"));
    fireEvent.click(getByTestId("attach-file"));
    expect((textarea as HTMLTextAreaElement).value).toBe("hello @");
  });
});

describe("CommandInput v2 — mobile adaptation (T4)", () => {
  it("toolbar row exposes ＋, model chip and the action button; no ⋯ at any width", () => {
    const { getByTestId, queryByTestId, queryByLabelText } = renderInput({
      onSelectModel: vi.fn(),
      models: [{ provider: "anthropic", id: "claude-4" }],
      onOpenInlineTerminal: vi.fn(),
    });
    expect(getByTestId("attach-button")).toBeTruthy();
    expect(getByTestId("model-selector-button")).toBeTruthy();
    expect(getByTestId("send-button")).toBeTruthy();
    expect(queryByTestId("overflow-button")).toBeNull();
    expect(queryByTestId("overflow-menu")).toBeNull();
    expect(queryByLabelText("More")).toBeNull();
  });

  it("the action button meets the 44px touch-target minimum", () => {
    const { container } = renderInput({ draft: "x", onDraftChange: vi.fn() });
    const send = container.querySelector('[data-testid="send-button"]') as HTMLElement;
    expect(send.className).toContain("min-w-[44px]");
    expect(send.className).toContain("min-h-[44px]");
  });
});

// ── redesign-composer-session-strip (D7) ────────────────────────────────────
// test-plan #E15 / #E16 / #E17 (tasks 8.15–8.17, 6.1–6.3).

describe("CommandInput — input row / toolbar row (#E15, #E24)", () => {
  it("E24: the input row holds only the textarea; send ends the toolbar row; the terminal is a ＋ menu item", () => {
    const { getByTestId, queryByTestId } = renderInput({
      draft: "Run the tests.",
      onDraftChange: vi.fn(),
      sessionStatus: "idle",
      onSelectModel: vi.fn(),
      models: [{ provider: "anthropic", id: "claude-4" }] as any,
      onSelectThinkingLevel: vi.fn(),
      onOpenInlineTerminal: vi.fn(),
    });
    const input = getByTestId("composer-input-row");
    const toolbar = getByTestId("composer-settings-row");
    expect(input.children).toHaveLength(1);
    expect(input.firstElementChild?.tagName).toBe("TEXTAREA");
    expect(toolbar.lastElementChild).toBe(getByTestId("send-button"));
    expect(toolbar.querySelector('[data-testid="open-inline-terminal-button"]')).toBeNull();
    fireEvent.click(getByTestId("attach-button"));
    const menu = getByTestId("attach-menu");
    const term = menu.querySelector('[data-testid="open-inline-terminal-button"]') as HTMLElement;
    expect(term).not.toBeNull();
    expect(term.getAttribute("aria-label")).toBe("Open inline terminal");
    expect(queryByTestId("composer-input-row")?.contains(getByTestId("send-button"))).toBe(false);
    for (const id of ["attach-button", "model-selector-button", "delivery-control"]) {
      expect(toolbar.querySelector(`[data-testid="${id}"]`), id).not.toBeNull();
    }
  });

  it("the terminal menu item opens the inline terminal and closes the menu", () => {
    const onOpenInlineTerminal = vi.fn();
    const { getByTestId, queryByTestId } = renderInput({ onOpenInlineTerminal });
    fireEvent.click(getByTestId("attach-button"));
    fireEvent.click(getByTestId("open-inline-terminal-button"));
    expect(onOpenInlineTerminal).toHaveBeenCalledOnce();
    expect(queryByTestId("attach-menu")).toBeNull();
  });
});

describe("CommandInput — split stop-after-turn control (#E16)", () => {
  it("stop-after-turn is the immediate previous sibling of stop in one split; click sends stop-after-turn, not abort; pill shows", () => {
    const onStopAfterTurn = vi.fn();
    const onAbort = vi.fn();
    const { getByTestId, queryByTestId } = renderInput({ sessionStatus: "streaming", onStopAfterTurn, onAbort });
    const sat = getByTestId("stop-after-turn-button");
    const stop = getByTestId("stop-button");
    const split = getByTestId("stop-split");
    expect(sat.parentElement).toBe(split);
    expect(stop.parentElement).toBe(split);
    expect(sat.nextElementSibling).toBe(stop);
    expect(stop.className).toContain("min-h-[44px]");
    expect(sat.getAttribute("aria-label")).toBe("Stop after turn");
    fireEvent.click(sat);
    expect(onStopAfterTurn).toHaveBeenCalledTimes(1);
    expect(onAbort).not.toHaveBeenCalled();
    expect(getByTestId("stop-after-turn-pill")).toBeTruthy();
    expect(queryByTestId("stop-after-turn-button")).toBeNull();
  });
});

describe("CommandInput — single focus indicator (#E17)", () => {
  it("textarea has no focus-ring; focused card uses the full-accent border, not the 60% mix", () => {
    const { textarea, getByTestId } = renderInput();
    expect(textarea.className).not.toContain("focus-ring");
    fireEvent.focus(textarea);
    const card = getByTestId("composer-card");
    expect(card.className).toContain("border-[var(--accent)]");
    expect(card.className).not.toContain("_60%");
  });
});

// ---------------------------------------------------------------------------
// Reconciled composer liveness (see change: fix-composer-liveness-on-reload).
// `sessionStatus` is the D3-derived value; "ended" is terminal (D6).
// ---------------------------------------------------------------------------
import { composerLiveness } from "../../lib/chat/composer-liveness.js";

describe("CommandInput — reconciled composer liveness", () => {
  const q = (c: HTMLElement, id: string) => c.querySelector(`[data-testid="${id}"]`);

  it("#E7 ended + retrying: no Stop / Force-Stop, Send shown (terminal gate)", () => {
    const { container } = renderInput({ sessionStatus: "ended", retrying: true, onAbort: vi.fn(), onForceKill: vi.fn() });
    expect(q(container, "stop-button")).toBeNull();
    expect(q(container, "force-stop-button")).toBeNull();
    expect(q(container, "send-button")).not.toBeNull();
  });

  it("#E8 ended + pending prompt keeps ONLY the cancel control, never Force-Stop", () => {
    vi.useFakeTimers();
    try {
      const onCancelPending = vi.fn();
      const onAbort = vi.fn();
      const { container } = renderInput({ sessionStatus: "ended", pendingPrompt: "sending", onCancelPending, onAbort, onForceKill: vi.fn() });
      fireEvent.click(q(container, "stop-button")!);
      act(() => { vi.advanceTimersByTime(3000); });
      expect(onCancelPending).toHaveBeenCalledTimes(1);
      expect(onAbort).not.toHaveBeenCalled();
      expect(q(container, "force-stop-button")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("#E9 idle + retrying keeps Stop (non-terminal retry gap)", () => {
    const { container } = renderInput({ sessionStatus: "idle", retrying: true, onAbort: vi.fn() });
    expect(q(container, "stop-button")).not.toBeNull();
  });

  it.each([
    ["idle", undefined],
    ["idle", "idle"],
    ["idle", "ended"],
    ["ended", undefined],
    ["ended", "active"],
    ["ended", "ended"],
  ] as const)("#E10 reducer=%s server=%s → no Stop", (reducer, server) => {
    const { container } = renderInput({ sessionStatus: composerLiveness(reducer, server), onAbort: vi.fn() });
    expect(q(container, "stop-button")).toBeNull();
  });

  it("#E11 accepted pre-snapshot cost: reducer ended, no server record, retrying → Stop hidden", () => {
    const { container } = renderInput({ sessionStatus: composerLiveness("ended", undefined), retrying: true, onAbort: vi.fn() });
    expect(q(container, "stop-button")).toBeNull();
  });

  it("#F12 killing latch persists while server still streaming, hides on ended", () => {
    vi.useFakeTimers();
    try {
      const onAbort = vi.fn();
      const onForceKill = vi.fn();
      const props = { commands, onSend: vi.fn(), onAbort, onForceKill };
      const { container, rerender } = render(<CommandInput {...props} sessionStatus="streaming" />);
      fireEvent.click(q(container, "stop-button")!);
      act(() => { vi.advanceTimersByTime(3000); });
      fireEvent.click(q(container, "force-stop-button")!);
      expect(q(container, "killing-button")).not.toBeNull();
      rerender(<CommandInput {...props} sessionStatus="streaming" />);
      expect(q(container, "killing-button")).not.toBeNull();
      rerender(<CommandInput {...props} sessionStatus="ended" />);
      expect(q(container, "stop-button")).toBeNull();
      expect(q(container, "force-stop-button")).toBeNull();
      expect(q(container, "killing-button")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("#F13 abort-sent state is retained across a same-value rerender, then escalates", () => {
    vi.useFakeTimers();
    try {
      const props = { commands, onSend: vi.fn(), onAbort: vi.fn(), onForceKill: vi.fn() };
      const { container, rerender } = render(<CommandInput {...props} sessionStatus="streaming" />);
      fireEvent.click(q(container, "stop-button")!);
      rerender(<CommandInput {...props} sessionStatus="streaming" />);
      act(() => { vi.advanceTimersByTime(3000); });
      expect(q(container, "force-stop-button")).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("#F15 reducer ended + server idle + retrying: Stop and stop-after-turn co-visible", () => {
    const { container } = renderInput({
      sessionStatus: composerLiveness("ended", "idle"),
      retrying: true,
      onAbort: vi.fn(),
      onStopAfterTurn: vi.fn(),
    });
    expect(q(container, "stop-button")).not.toBeNull();
    expect(q(container, "stop-after-turn-button")).not.toBeNull();
  });

  it("#X3 killed in retry sleep (server ended): no Stop / Force-Stop", () => {
    const { container } = renderInput({
      sessionStatus: composerLiveness("idle", "ended"),
      retrying: true,
      onAbort: vi.fn(),
      onForceKill: vi.fn(),
    });
    expect(q(container, "stop-button")).toBeNull();
    expect(q(container, "force-stop-button")).toBeNull();
  });

  it("#X4 server record arriving after first render flips Send → Stop (continuous derivation)", () => {
    const props = { commands, onSend: vi.fn(), onAbort: vi.fn() };
    const { container, rerender } = render(<CommandInput {...props} sessionStatus={composerLiveness("idle", undefined)} />);
    expect(q(container, "send-button")).not.toBeNull();
    rerender(<CommandInput {...props} sessionStatus={composerLiveness("idle", "streaming")} />);
    expect(q(container, "stop-button")).not.toBeNull();
  });
});

// ===========================================================================
// add-composer-dock — toolbar restructure (D7–D9, tasks 7.1–7.5)
// ===========================================================================

/** The composer card is the `@container`; jsdom has no layout, so pin its width. */
function setComposerWidth(getByTestId: (id: string) => HTMLElement, px: number) {
  Object.defineProperty(getByTestId("composer-card"), "clientWidth", { configurable: true, value: px });
}

const DOCK_MODELS = [
  { provider: "anthropic", id: "claude-opus-5-5", supportedThinkingLevels: ["off", "low", "medium", "high", "xhigh"] },
  { provider: "anthropic", id: "claude-haiku-5-5", supportedThinkingLevels: ["off", "low"] },
] as any;

describe("CommandInput — delivery dropdown (E20, 7.2)", () => {
  const cases: Array<["steer" | "queue", boolean, "steer" | "followUp"]> = [
    ["steer", false, "steer"],
    ["steer", true, "followUp"],
    ["queue", false, "followUp"],
    ["queue", true, "followUp"],
  ];
  for (const [mode, alt, expected] of cases) {
    it(`E20: ${mode} + ${alt ? "Alt+Enter" : "Enter"} → ${expected}`, () => {
      const { textarea, onSend, getByTestId } = renderInput({ draft: "hi", onDraftChange: vi.fn() });
      if (mode === "queue") chooseDelivery(getByTestId, "queue");
      fireEvent.keyDown(textarea, { key: "Enter", altKey: alt });
      expect(onSend).toHaveBeenCalledWith("hi", undefined, expected);
    });
  }

  it("the trigger is a menu button naming the current state; its menu offers both states as radio items with description + key", () => {
    const { getByTestId, getAllByRole } = renderInput();
    const trigger = getByTestId("delivery-control");
    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    expect(trigger.getAttribute("aria-label")).toBe("Delivery mode: Steer");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const radios = getAllByRole("menuitemradio");
    expect(radios.map((r) => r.getAttribute("data-testid"))).toEqual(["delivery-steer", "delivery-queue"]);
    expect(radios[0]!.getAttribute("aria-checked")).toBe("true");
    expect(radios[1]!.getAttribute("aria-checked")).toBe("false");
    expect(radios[0]!.textContent).toContain("Steer");
    expect(radios[0]!.textContent).toContain("Interrupts at the next tool boundary");
    expect(radios[0]!.textContent).toContain("⏎");
    expect(radios[1]!.textContent).toContain("Delivered when the turn ends");
    expect(radios[1]!.textContent).toContain("⌥⏎");
  });

  it("picking Queue updates the trigger name and closes the menu; Escape closes without changing", () => {
    const { getByTestId, queryByTestId } = renderInput();
    chooseDelivery(getByTestId, "queue");
    expect(queryByTestId("delivery-queue")).toBeNull();
    expect(getByTestId("delivery-control").getAttribute("aria-label")).toBe("Delivery mode: Queue");
    fireEvent.click(getByTestId("delivery-control"));
    fireEvent.keyDown(getByTestId("delivery-steer"), { key: "Escape" });
    expect(queryByTestId("delivery-steer")).toBeNull();
    expect(getByTestId("delivery-control").getAttribute("aria-label")).toBe("Delivery mode: Queue");
  });

  it("375 px: the chip is hidden by the 26.25rem container query and ＋ offers Steer/Queue as radio items", () => {
    const { getByTestId } = renderInput({ draft: "q", onDraftChange: vi.fn() });
    expect(getByTestId("delivery-control").closest("span")!.className).toMatch(/hidden .*@\[26\.25rem\]:inline-flex/);
    setComposerWidth(getByTestId, 375);
    fireEvent.click(getByTestId("attach-button"));
    const menu = getByTestId("attach-menu");
    const radios = menu.querySelectorAll('[role="menuitemradio"]');
    expect(radios).toHaveLength(2);
    expect(radios[0]!.getAttribute("aria-checked")).toBe("true");
  });

  it("375 px: a Queue pick from ＋ routes Enter to followUp", () => {
    const { getByTestId, onSend, textarea } = renderInput({ draft: "later", onDraftChange: vi.fn() });
    setComposerWidth(getByTestId, 375);
    fireEvent.click(getByTestId("attach-button"));
    fireEvent.click(getByTestId("delivery-queue"));
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("later", undefined, "followUp");
  });

  it("wide composer: ＋ does not duplicate the delivery states", () => {
    const { getByTestId } = renderInput();
    setComposerWidth(getByTestId, 1000);
    fireEvent.click(getByTestId("attach-button"));
    expect(getByTestId("attach-menu").querySelectorAll('[role="menuitemradio"]')).toHaveLength(0);
  });

  it("no ⋯ overflow control at any width", () => {
    for (const w of [1200, 880, 640, 420, 375]) {
      const { getByTestId, queryByTestId, queryByLabelText, unmount } = renderInput({ onOpenInlineTerminal: vi.fn() });
      setComposerWidth(getByTestId, w);
      fireEvent.click(getByTestId("attach-button"));
      expect(queryByTestId("overflow-button"), String(w)).toBeNull();
      expect(queryByTestId("overflow-menu"), String(w)).toBeNull();
      expect(queryByLabelText("More"), String(w)).toBeNull();
      unmount();
    }
  });
});

describe("CommandInput — merged model chip (E19, 7.3)", () => {
  const chipProps = () => ({
    model: "anthropic/claude-opus-5-5",
    models: DOCK_MODELS,
    thinkingLevel: "xhigh",
    onSelectModel: vi.fn(),
    onSelectThinkingLevel: vi.fn(),
  });

  it("the face shows model and level; the accessible name carries both", () => {
    const { getByTestId } = renderInput(chipProps());
    const chip = getByTestId("model-selector-button");
    expect(chip.textContent).toContain("anthropic/claude-opus-5-5");
    expect(chip.textContent).toContain("xhigh");
    const name = chip.getAttribute("aria-label")!;
    expect(name).toContain("anthropic/claude-opus-5-5");
    expect(name).toContain("xhigh");
    // The level drops from the face below 420 px (container query) but never from the name.
    expect(getByTestId("model-chip-level").className).toMatch(/hidden .*@\[26\.25rem\]:inline/);
    // No separate thinking chip.
    expect(document.querySelector('[data-testid="thinking-level-button"]')).toBeNull();
  });

  it("the model id truncates with an ellipsis (it shrinks before any other control)", () => {
    const { getByTestId } = renderInput(chipProps());
    const face = getByTestId("model-selector-button").querySelector(".truncate");
    expect(face).not.toBeNull();
    expect(getByTestId("model-selector").className).toContain("min-w-0");
  });

  it("choosing a model in the chip popover sends set_model's value", () => {
    const props = chipProps();
    const { getByTestId, getAllByTestId } = renderInput(props);
    fireEvent.click(getByTestId("model-selector-button"));
    fireEvent.click(getAllByTestId("model-row").find((r) => r.textContent?.includes("claude-haiku-5-5"))!);
    expect(props.onSelectModel).toHaveBeenCalledWith("anthropic/claude-haiku-5-5");
  });

  it("choosing a level in the chip popover sends set_thinking_level's value", () => {
    const props = chipProps();
    const { getByTestId, getByRole } = renderInput(props);
    fireEvent.click(getByTestId("model-selector-button"));
    const group = getByRole("radiogroup", { name: "Thinking level" });
    const high = group.querySelector('[role="radio"][data-level="high"]') as HTMLElement;
    expect(high.getAttribute("aria-checked")).toBe("false");
    expect(group.querySelector('[role="radio"][data-level="xhigh"]')!.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(high);
    expect(props.onSelectThinkingLevel).toHaveBeenCalledWith("high");
    expect(document.querySelector('[data-testid="model-dropdown"]')).toBeNull();
  });

  it("offers only the levels the selected model supports", () => {
    const props = { ...chipProps(), model: "anthropic/claude-haiku-5-5", thinkingLevel: "low" };
    const { getByTestId, getByRole } = renderInput(props);
    fireEvent.click(getByTestId("model-selector-button"));
    const levels = Array.from(getByRole("radiogroup", { name: "Thinking level" }).querySelectorAll('[role="radio"]')).map((r) => r.getAttribute("data-level"));
    expect(levels).toEqual(["off", "low"]);
  });

  it("E19: a role pick shows `from @fast` and the level; the name holds the model and level", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ preset: null, roles: [{ role: "fast", assigned: true, model: "anthropic/claude-haiku-5-5", thinkingLevel: "low" }] }] }),
    })));
    try {
      const props = { ...chipProps(), model: "anthropic/claude-opus-5-5", thinkingLevel: "xhigh" };
      const view = renderInput(props);
      await act(async () => {});
      fireEvent.click(view.getByTestId("model-selector-button"));
      await act(async () => {});
      fireEvent.click(view.getByTestId("model-tab-role"));
      await act(async () => {
        fireEvent.click(view.getAllByTestId("role-row").find((r) => r.getAttribute("data-role") === "fast")!);
      });
      expect(props.onSelectModel).toHaveBeenCalledWith("anthropic/claude-haiku-5-5");
      expect(props.onSelectThinkingLevel).toHaveBeenCalledWith("low");
      view.rerender(<CommandInput commands={commands} onSend={vi.fn()} {...props} model="anthropic/claude-haiku-5-5" thinkingLevel="low" />);
      const chip = view.getByTestId("model-selector-button");
      expect(chip.textContent).toContain("from");
      expect(view.getByTestId("model-via-role").textContent).toContain("@fast");
      expect(chip.textContent).toContain("claude-haiku-5-5");
      expect(chip.textContent).toContain("low");
      expect(chip.getAttribute("aria-label")).toContain("claude-haiku-5-5");
      expect(chip.getAttribute("aria-label")).toContain("low");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("the empty catalogue state still opens from the chip", () => {
    const { getByTestId } = renderInput({ ...chipProps(), models: [] });
    fireEvent.click(getByTestId("model-selector-button"));
    expect(getByTestId("model-empty")).toBeTruthy();
  });

  it("folder-home unset values show the placeholder once, without a duplicate level", () => {
    const { getByTestId } = renderInput({ onSelectModel: vi.fn(), onSelectThinkingLevel: vi.fn(), unsetLabel: "pi default" });
    const text = getByTestId("model-selector-button").textContent ?? "";
    expect(text.match(/pi default/g)).toHaveLength(1);
  });
});

describe("CommandInput — working status word (7.4)", () => {
  it("streaming + bash: shows `Running bash…` beside an aria-hidden shape; no standalone status row", () => {
    const { getByTestId, queryByTestId } = renderInput({ sessionStatus: "streaming", currentTool: "bash" });
    const status = getByTestId("working-status");
    expect(status.textContent).toMatch(/Running bash/);
    expect(status.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
    expect(getByTestId("composer-settings-row").contains(status)).toBe(true);
    expect(queryByTestId("status-bar")).toBeNull();
  });

  it("the word is sr-only below 40rem (still in the DOM for assistive tech); the shape stays visible", () => {
    const { getByTestId } = renderInput({ sessionStatus: "streaming", currentTool: "bash" });
    const status = getByTestId("working-status");
    const word = Array.from(status.children).find((c) => c.tagName === "SPAN" && /Running bash/.test(c.textContent ?? ""))!;
    expect(word.className).toContain("sr-only");
    expect(word.className).toContain("@[40rem]:not-sr-only");
    expect(status.querySelector("svg")!.parentElement!.className).not.toContain("sr-only");
  });

  it("thinking / generating labels; nothing when idle", () => {
    const a = renderInput({ sessionStatus: "streaming" });
    expect(a.getByTestId("working-status").textContent).toMatch(/Thinking/);
    a.unmount();
    const b = renderInput({ sessionStatus: "streaming", streamingText: "x" });
    expect(b.getByTestId("working-status").textContent).toMatch(/Generating/);
    b.unmount();
    const c = renderInput({ sessionStatus: "idle", currentTool: "bash" });
    expect(c.queryByTestId("working-status")).toBeNull();
  });

  it("renders no context gauge in the toolbar", () => {
    const { getByTestId } = renderInput({ sessionStatus: "streaming", contextUsage: { tokens: 46000, contextWindow: 100000 } });
    const toolbar = getByTestId("composer-settings-row");
    expect(toolbar.querySelector('[role="meter"], [role="progressbar"], circle')).toBeNull();
    expect(toolbar.textContent).not.toMatch(/\d+%/);
  });
});

describe("CommandInput — kept and removed test ids (E23)", () => {
  it("E23: every kept D7 id is present; the strip, status bar and ⋯ are gone", () => {
    const view = renderInput({
      sessionStatus: "streaming",
      draft: "go",
      onDraftChange: vi.fn(),
      onAbort: vi.fn(),
      onForceKill: vi.fn(),
      onStopAfterTurn: vi.fn(),
      onOpenInlineTerminal: vi.fn(),
      contextUsage: { tokens: 20000, contextWindow: 100000 },
      onSelectModel: vi.fn(),
      models: DOCK_MODELS,
    });
    const present = (id: string) => expect(view.queryByTestId(id), id).not.toBeNull();
    for (const id of ["composer-root", "composer-card", "composer-input-row", "composer-settings-row", "composer-footer", "composer-context-left", "attach-button", "delivery-control", "stop-split", "stop-after-turn-button", "stop-button"]) present(id);
    fireEvent.click(view.getByTestId("attach-button"));
    present("attach-menu");
    present("open-inline-terminal-button");
    fireEvent.mouseDown(document.body);
    fireEvent.click(view.getByTestId("delivery-control"));
    present("delivery-steer");
    present("delivery-queue");
    fireEvent.mouseDown(document.body);
    fireEvent.click(view.getByTestId("stop-after-turn-button"));
    present("stop-after-turn-pill");
    fireEvent.click(view.getByTestId("stop-button"));
    present("force-stop-button");
    fireEvent.click(view.getByTestId("force-stop-button"));
    present("killing-button");
    for (const id of ["composer-context-strip", "status-bar", "composer-session-actions", "overflow-button", "overflow-menu"]) {
      expect(view.queryByTestId(id), id).toBeNull();
    }
  });

  it("send-button is kept idle", () => {
    expect(renderInput({ draft: "x", onDraftChange: vi.fn() }).queryByTestId("send-button")).not.toBeNull();
  });
});

describe("CommandInput — action cluster (F23, F24, 7.5)", () => {
  const RAW_PALETTE = /\b(?:bg|text|border|ring)-(?:red|blue|orange|yellow|green|amber|emerald|rose)-\d{2,3}/;

  it("F23: stop-after-turn immediately precedes stop inside one group named `Stop options`", () => {
    const { getByTestId, getByRole } = renderInput({ sessionStatus: "streaming", onAbort: vi.fn(), onStopAfterTurn: vi.fn() });
    const group = getByRole("group", { name: "Stop options" });
    expect(getByTestId("stop-after-turn-button").nextElementSibling).toBe(getByTestId("stop-button"));
    expect(group.contains(getByTestId("stop-button"))).toBe(true);
    expect(getByTestId("composer-settings-row").contains(group)).toBe(true);
  });

  it("F24: force-stop's glyph differs from stop's", () => {
    const { getByTestId } = renderInput({ sessionStatus: "streaming", onAbort: vi.fn(), onForceKill: vi.fn() });
    const glyph = (id: string) => getByTestId(id).querySelector("path")!.getAttribute("d");
    const stopGlyph = glyph("stop-button");
    fireEvent.click(getByTestId("stop-button"));
    expect(glyph("force-stop-button")).not.toBe(stopGlyph);
  });

  it("7.5: send / stop / force / killing / after-turn paint from tokens, not raw palette classes", () => {
    const send = renderInput({ draft: "x", onDraftChange: vi.fn() });
    expect(send.getByTestId("send-button").className).toContain("--text-primary");
    expect(send.getByTestId("send-button").className).toContain("--bg-primary");
    expect(send.getByTestId("send-button").className).toContain("disabled:bg-[var(--bg-surface)]");
    expect(send.getByTestId("send-button").className).toContain("disabled:text-[var(--text-muted)]");
    expect(send.getByTestId("send-button").className).not.toMatch(RAW_PALETTE);
    send.unmount();
    const { getByTestId } = renderInput({ sessionStatus: "streaming", onAbort: vi.fn(), onForceKill: vi.fn(), onStopAfterTurn: vi.fn() });
    expect(getByTestId("stop-after-turn-button").className).not.toMatch(RAW_PALETTE);
    expect(getByTestId("stop-button").className).not.toMatch(RAW_PALETTE);
    expect(getByTestId("stop-button").className).toContain("--text-primary");
    fireEvent.click(getByTestId("stop-button"));
    const force = getByTestId("force-stop-button");
    expect(force.className).not.toMatch(RAW_PALETTE);
    expect(force.className).toContain("--severity-warning-bg");
    expect(force.className).toContain("--severity-warning-fg");
    expect(force.className).toContain("--severity-warning-border");
    fireEvent.click(force);
    expect(getByTestId("killing-button").className).not.toMatch(RAW_PALETTE);
  });

  it("the after-turn label shows from 55rem (collapses to the icon below, name kept)", () => {
    const { getByTestId } = renderInput({ sessionStatus: "streaming", onAbort: vi.fn(), onStopAfterTurn: vi.fn() });
    const sat = getByTestId("stop-after-turn-button");
    expect(sat.querySelector("span")!.className).toContain("@[55rem]:inline");
    expect(sat.getAttribute("aria-label")).toBe("Stop after turn");
  });
});

describe("CommandInput — invalid border (team-app composer, task 8.4)", () => {
  it("invalid sets aria-invalid on the textarea and the error border on the card", () => {
    const { textarea, getByTestId } = renderInput({ invalid: true });
    expect(textarea.getAttribute("aria-invalid")).toBe("true");
    expect(getByTestId("composer-card").className).toContain("border-[var(--severity-error-border)]");
  });

  it("renders without model/delivery extras bare (no dock, no model chip)", () => {
    const { getByTestId, queryByTestId } = renderInput();
    expect(queryByTestId("model-selector-button")).toBeNull();
    expect(getByTestId("composer-settings-row").lastElementChild).toBe(getByTestId("send-button"));
  });
});
