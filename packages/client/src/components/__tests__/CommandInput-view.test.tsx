/**
 * Tests for the `/view` interception and `@`-URL autocomplete additions to
 * CommandInput. See change: render-file-previews.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import React from "react";
import { CommandInput, DASHBOARD_LOCAL_COMMANDS, parseViewCommand } from "../CommandInput.js";
import type { CommandInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { ChatMessage } from "../../lib/event-reducer.js";

afterEach(() => cleanup());

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
});

describe("parseViewCommand", () => {
  it("parses @-file form", () => {
    expect(parseViewCommand("/view @docs/foo.md", "/home/u/proj")).toEqual({
      kind: "file",
      cwd: "/home/u/proj",
      path: "docs/foo.md",
    });
  });

  it("parses URL form", () => {
    expect(parseViewCommand("/view https://youtu.be/abc", "/x")).toEqual({
      kind: "url",
      url: "https://youtu.be/abc",
    });
  });

  it("returns null for no arg", () => {
    expect(parseViewCommand("/view", "/x")).toBeNull();
    expect(parseViewCommand("/view   ", "/x")).toBeNull();
  });

  it("returns null for multi-token arg", () => {
    expect(parseViewCommand("/view foo bar", "/x")).toBeNull();
  });

  it("returns null for bare non-URL non-@ token", () => {
    expect(parseViewCommand("/view foo.md", "/x")).toBeNull();
  });

  it("returns null when @-form has no cwd", () => {
    expect(parseViewCommand("/view @x.md", undefined)).toBeNull();
  });

  it("rejects non-/view text", () => {
    expect(parseViewCommand("hello", "/x")).toBeNull();
    expect(parseViewCommand("/viewing", "/x")).toBeNull();
  });
});

describe("DASHBOARD_LOCAL_COMMANDS", () => {
  it("contains a view entry with source builtin", () => {
    const view = DASHBOARD_LOCAL_COMMANDS.find((c) => c.name === "view");
    expect(view).toBeTruthy();
    expect(view?.source).toBe("builtin");
  });
});

const emptyCommands: CommandInfo[] = [];

function renderInput(props: Partial<React.ComponentProps<typeof CommandInput>> = {}) {
  const onSend = vi.fn();
  const onViewLocal = vi.fn();
  const result = render(
    <CommandInput
      commands={emptyCommands}
      onSend={onSend}
      onViewLocal={onViewLocal}
      currentCwd="/home/u/proj"
      {...props}
    />,
  );
  const textarea = result.container.querySelector("textarea")!;
  return { ...result, textarea, onSend, onViewLocal };
}

describe("CommandInput — /view interception", () => {
  it("lists /view in command dropdown when typing /v", () => {
    const { container, textarea } = renderInput();
    fireEvent.change(textarea, { target: { value: "/v" } });
    const text = container.textContent ?? "";
    expect(text).toContain("/view");
  });

  it("`/view @foo.md` submit calls onViewLocal with file target and NOT onSend", () => {
    const { textarea, onSend, onViewLocal } = renderInput();
    fireEvent.change(textarea, { target: { value: "/view @foo.md" } });
    // Bypass autocomplete: blur first so dropdown closes, then submit via Enter.
    // The dropdown intercepts Enter when open — but `/view @foo.md` is past
    // the `/v` substring autocomplete; the dropdown for `/view ` doesn't open
    // (commandFilter wouldn't match anything). Easier path: click send button.
    const sendBtn = textarea.parentElement!.querySelector('[data-testid="send-button"]') as HTMLButtonElement;
    fireEvent.click(sendBtn);
    expect(onSend).not.toHaveBeenCalled();
    expect(onViewLocal).toHaveBeenCalledTimes(1);
    expect(onViewLocal).toHaveBeenCalledWith({
      kind: "file",
      cwd: "/home/u/proj",
      path: "foo.md",
    });
  });

  it("`/view https://youtu.be/x` calls onViewLocal with url target", () => {
    const { textarea, onSend, onViewLocal } = renderInput();
    fireEvent.change(textarea, { target: { value: "/view https://youtu.be/x" } });
    const sendBtn = textarea.parentElement!.querySelector('[data-testid="send-button"]') as HTMLButtonElement;
    fireEvent.click(sendBtn);
    expect(onSend).not.toHaveBeenCalled();
    expect(onViewLocal).toHaveBeenCalledWith({ kind: "url", url: "https://youtu.be/x" });
  });

  it("bare `/view` is a no-op (no onSend, no onViewLocal, draft preserved)", () => {
    let draft = "/view";
    const onDraftChange = vi.fn((v: string) => { draft = v; });
    const { textarea, onSend, onViewLocal } = renderInput({ draft, onDraftChange });
    const sendBtn = textarea.parentElement!.querySelector('[data-testid="send-button"]') as HTMLButtonElement;
    fireEvent.click(sendBtn);
    expect(onSend).not.toHaveBeenCalled();
    expect(onViewLocal).not.toHaveBeenCalled();
    // Draft must remain — onDraftChange was NEVER called with "".
    expect(onDraftChange).not.toHaveBeenCalledWith("");
  });

  it("non-view slash still routes to onSend", () => {
    const { textarea, onSend, onViewLocal } = renderInput();
    fireEvent.change(textarea, { target: { value: "/compact" } });
    const sendBtn = textarea.parentElement!.querySelector('[data-testid="send-button"]') as HTMLButtonElement;
    fireEvent.click(sendBtn);
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend.mock.calls[0][0]).toBe("/compact");
    expect(onViewLocal).not.toHaveBeenCalled();
  });
});

describe("CommandInput — `@` URL autocomplete", () => {
  function msg(id: string, content: string): ChatMessage {
    return { id, role: "assistant", content, timestamp: 0 } as ChatMessage;
  }

  it("surfaces URLs from sessionMessages when in @ mode", () => {
    const sessionMessages: ChatMessage[] = [
      msg("a", "check https://youtu.be/abc"),
      msg("b", "and https://example.com/spec.pdf"),
    ];
    const { container, textarea } = renderInput({ sessionMessages });
    fireEvent.change(textarea, { target: { value: "@" } });
    const text = container.textContent ?? "";
    expect(text).toContain("youtu.be");
    expect(text).toContain("example.com");
  });

  it("filters URLs by host substring", () => {
    const sessionMessages: ChatMessage[] = [
      msg("a", "https://youtu.be/abc"),
      msg("b", "https://example.com/x"),
    ];
    const { container, textarea } = renderInput({ sessionMessages });
    fireEvent.change(textarea, { target: { value: "@youtu" } });
    const text = container.textContent ?? "";
    expect(text).toContain("youtu.be");
    expect(text).not.toContain("example.com");
  });

  it("dropdown is empty when no URLs in session and no file results", () => {
    const { container, textarea } = renderInput({ sessionMessages: [] });
    fireEvent.change(textarea, { target: { value: "@foo" } });
    // No URL items and no file items → dropdown should NOT render at all.
    // We assert no preview-card-style dropdown buttons appear with the
    // cyan URL style.
    expect(container.querySelector(".text-cyan-400")).toBeNull();
  });
});
