/**
 * Prompt-answer drafts through the renderers + hooks. See change:
 * fix-input-state-consistency (#1117). Test-plan rows S28, S45, S51-S54, S76.
 * (No JSX: this file keeps the `.test.ts` name the change's tasks reference.)
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement as h } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InputRenderer } from "../../components/interactive-renderers/InputRenderer.js";
import { SelectRenderer } from "../../components/interactive-renderers/SelectRenderer.js";
import type { InteractiveRendererProps } from "../../components/interactive-renderers/types.js";
import {
  getPromptDraftImages,
  PROMPT_DRAFT_DEBOUNCE_MS,
  PROMPT_DRAFT_KEY_PREFIX,
  resetPromptDraftMemory,
} from "../../lib/state/prompt-draft-storage.js";

const mirrored = () => Object.keys(sessionStorage).filter((k) => k.startsWith(PROMPT_DRAFT_KEY_PREFIX));

beforeEach(() => {
  sessionStorage.clear();
  resetPromptDraftMemory();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  resetPromptDraftMemory();
});

const noop = () => {};
const inputProps = (over: Partial<InteractiveRendererProps> = {}): InteractiveRendererProps => ({
  requestId: "p1",
  sessionId: "s1",
  method: "input",
  params: { title: "Name?" },
  status: "pending",
  onRespond: noop,
  onCancel: noop,
  ...over,
});
const selectProps = (over: Partial<InteractiveRendererProps> = {}): InteractiveRendererProps => ({
  requestId: "p1",
  sessionId: "s1",
  method: "select",
  params: { title: "Pick", options: ["A", "B"], allowOther: true },
  status: "pending",
  onRespond: noop,
  onCancel: noop,
  ...over,
});
const textbox = () => screen.getByRole("textbox") as HTMLTextAreaElement;
const type = (value: string) => fireEvent.change(textbox(), { target: { value } });

/** Paste a 1x1 PNG through the real `handlePaste` path. */
async function pasteImage() {
  let pendingOnload: (() => void) | null = null;
  vi.stubGlobal(
    "FileReader",
    class {
      result = "data:image/png;base64,iVBORw0KGgo=";
      onload: (() => void) | null = null;
      readAsDataURL() {
        pendingOnload = () => this.onload?.();
      }
    },
  );
  const file = new File([new Uint8Array([137, 80, 78, 71])], "t.png", { type: "image/png" });
  fireEvent.paste(textbox(), { clipboardData: { items: [{ type: "image/png", getAsFile: () => file, kind: "file" }] } });
  await act(async () => {
    pendingOnload?.();
  });
}
const thumbs = (c: HTMLElement) => c.querySelectorAll("img.h-16").length;

describe("prompts without both ids are ephemeral", () => {
  it("S28: two id-less prompts in one session neither persist nor restore nor share a bucket", () => {
    for (const text of ["first", "second"]) {
      const m = render(h(InputRenderer, inputProps({ requestId: "" })));
      type(text);
      expect(textbox().value).toBe(text); // ephemeral state still works while mounted
      m.unmount();
      const again = render(h(InputRenderer, inputProps({ requestId: "" })));
      expect(textbox().value).toBe("");
      again.unmount();
    }
    expect(mirrored()).toEqual([]);
  });

  it("S76: a renderer mounted without a sessionId is ephemeral too (no ask-draft:undefined:p1 / ask-draft::p1)", () => {
    vi.useFakeTimers();
    const m = render(h(InputRenderer, inputProps({ sessionId: undefined })));
    type("typed");
    expect(textbox().value).toBe("typed");
    vi.advanceTimersByTime(PROMPT_DRAFT_DEBOUNCE_MS * 2);
    m.unmount();
    expect(mirrored()).toEqual([]);
    render(h(InputRenderer, inputProps({ sessionId: undefined })));
    expect(textbox().value).toBe("");
  });
});

describe("restore + flush", () => {
  it("S45: typing then unmounting inside the write delay loses nothing across a reload", () => {
    vi.useFakeTimers();
    const m = render(h(InputRenderer, inputProps()));
    type("half-typed");
    vi.advanceTimersByTime(100);
    m.unmount(); // session switch: flush
    resetPromptDraftMemory(); // reload
    render(h(InputRenderer, inputProps()));
    expect(textbox().value).toBe("half-typed");
  });

  it("a surface that never edited never writes", () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(Storage.prototype, "setItem");
    const m = render(h(SelectRenderer, selectProps()));
    vi.advanceTimersByTime(PROMPT_DRAFT_DEBOUNCE_MS * 2);
    m.unmount();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("images are memory-only and per (session, prompt) (S51, S52)", () => {
  it("S51: an image survives a session switch but not a reload; the mirror never holds base64", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const first = render(h(InputRenderer, inputProps()));
    await pasteImage();
    type("with picture");
    expect(thumbs(first.container)).toBe(1);
    first.unmount(); // (a) session switch
    const second = render(h(InputRenderer, inputProps()));
    expect(thumbs(second.container)).toBe(1);
    expect(textbox().value).toBe("with picture");
    second.unmount();
    const stored = sessionStorage.getItem("ask-draft:s1:p1") ?? "";
    expect(stored).toContain("with picture");
    expect(stored).not.toContain("data:");
    expect(stored).not.toContain("iVBORw0KGgo");
    resetPromptDraftMemory(); // (b) reload
    const third = render(h(InputRenderer, inputProps()));
    expect(thumbs(third.container)).toBe(0);
    expect(textbox().value).toBe("with picture");
  });

  it("S52: the same promptId in another session shows no image; the map key is the full draft key", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const a = render(h(InputRenderer, inputProps({ sessionId: "A" })));
    await pasteImage();
    expect(getPromptDraftImages("A", "p1")).toHaveLength(1);
    a.unmount();
    expect(getPromptDraftImages("B", "p1")).toEqual([]);
    const b = render(h(InputRenderer, inputProps({ sessionId: "B" })));
    expect(thumbs(b.container)).toBe(0);
  });

  it("restoreImages={false} neither reads nor writes the image map", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const card = render(h(InputRenderer, inputProps()));
    await pasteImage();
    card.unmount();
    const dialog = render(h(InputRenderer, inputProps({ restoreImages: false })));
    expect(thumbs(dialog.container)).toBe(0);
    await pasteImage();
    expect(thumbs(dialog.container)).toBe(1);
    dialog.unmount();
    // The card's image entry is untouched by the dialog's paste.
    expect(getPromptDraftImages("s1", "p1")).toHaveLength(1);
  });
});

describe("prompt identity (S53, S54)", () => {
  it("S53: a reused renderer element re-initialises when the prompt changes — never shows p1's text on p2", () => {
    vi.useFakeTimers();
    const m = render(h(InputRenderer, inputProps({ requestId: "p1" })));
    type("x");
    m.rerender(h(InputRenderer, inputProps({ requestId: "p2" })));
    expect(textbox().value).toBe("");
    type("y");
    m.rerender(h(InputRenderer, inputProps({ requestId: "p1" })));
    expect(textbox().value).toBe("x");
    m.rerender(h(InputRenderer, inputProps({ requestId: "p2" })));
    expect(textbox().value).toBe("y");
  });

  it("S54: another session's prompt shows nothing from this draft, and writes no key unless edited", () => {
    vi.useFakeTimers();
    const a = render(h(InputRenderer, inputProps({ sessionId: "A", requestId: "p1" })));
    type("secret");
    vi.advanceTimersByTime(PROMPT_DRAFT_DEBOUNCE_MS);
    a.unmount();
    const b = render(h(InputRenderer, inputProps({ sessionId: "B", requestId: "p2" })));
    expect(textbox().value).toBe("");
    vi.advanceTimersByTime(PROMPT_DRAFT_DEBOUNCE_MS * 2);
    b.unmount();
    expect(sessionStorage.getItem("ask-draft:B:p2")).toBeNull();
    expect(mirrored()).toEqual(["ask-draft:A:p1"]);
  });
});
