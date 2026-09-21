import { mdiCheck, mdiContentCopy } from "@mdi/js";
import { Icon } from "@mdi/react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CopyButton } from "../primitives/CopyButton.js";

/** The rendered icon path (`d` attr) — distinguishes the base icon from mdiCheck. */
function iconPath(btn: HTMLElement): string | null {
  return btn.querySelector("svg path")?.getAttribute("d") ?? null;
}

function renderButton(getText: () => string = () => "hello") {
  return render(<CopyButton getText={getText} icon={<Icon path={mdiContentCopy} size={0.6} />} title="Copy" />);
}

describe("CopyButton", () => {
  let writeTextMock: ReturnType<typeof vi.fn>;
  let originalExecCommand: typeof document.execCommand | undefined;

  beforeEach(() => {
    writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText: writeTextMock },
    });
    originalExecCommand = document.execCommand;
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Object.assign(navigator, { clipboard: undefined });
    if (originalExecCommand) {
      Object.assign(document, { execCommand: originalExecCommand });
    } else {
      Reflect.deleteProperty(document, "execCommand");
    }
  });

  it("renders the provided icon", () => {
    renderButton();
    const btn = screen.getByTitle("Copy");
    expect(iconPath(btn)).toBe(mdiContentCopy);
  });

  it("copies text to clipboard on click", async () => {
    renderButton(() => "hello world");

    await act(async () => {
      fireEvent.click(screen.getByTitle("Copy"));
    });

    expect(writeTextMock).toHaveBeenCalledWith("hello world");
  });

  // E9 — the success path must not touch the fallback at all.
  it("shows ✓ on success without ever creating the fallback textarea", async () => {
    const createSpy = vi.spyOn(document, "createElement");
    renderButton();

    await act(async () => {
      fireEvent.click(screen.getByTitle("Copy"));
    });

    expect(iconPath(screen.getByTitle("Copy"))).toBe(mdiCheck);
    expect(createSpy.mock.calls.some(([tag]) => (tag as string) === "textarea")).toBe(false);
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("reverts the ✓ after 1500ms", async () => {
    renderButton();

    await act(async () => {
      fireEvent.click(screen.getByTitle("Copy"));
    });
    expect(iconPath(screen.getByTitle("Copy"))).toBe(mdiCheck);

    act(() => {
      vi.advanceTimersByTime(1500);
    });

    expect(iconPath(screen.getByTitle("Copy"))).toBe(mdiContentCopy);
  });

  // X1 — Clipboard API rejects (plain-http tunnel); the shared `copyText`
  // fallback (hidden textarea + execCommand) must recover, show ✓, and leave
  // no residual node.
  it("falls back to the textarea path and shows ✓ when writeText rejects", async () => {
    writeTextMock.mockRejectedValue(new Error("not allowed"));
    const seen = { present: false, value: "" };
    const execCommand = vi.fn(() => {
      const ta = document.querySelector("textarea");
      seen.present = ta !== null;
      seen.value = ta?.value ?? "";
      return true;
    });
    Object.assign(document, { execCommand });

    renderButton();

    await act(async () => {
      fireEvent.click(screen.getByTitle("Copy"));
    });

    expect(execCommand).toHaveBeenCalledWith("copy");
    // The hidden textarea existed at the moment execCommand ran...
    expect(seen.present).toBe(true);
    expect(seen.value).toBe("hello");
    // ...and did not leak into the DOM afterwards.
    expect(document.querySelector("textarea")).toBeNull();
    expect(iconPath(screen.getByTitle("Copy"))).toBe(mdiCheck);
  });

  // X2 — every copy path fails: silent, and no false ✓.
  it("fails silently when execCommand returns false", async () => {
    writeTextMock.mockRejectedValue(new Error("not allowed"));
    Object.assign(document, { execCommand: vi.fn(() => false) });

    renderButton();

    await act(async () => {
      fireEvent.click(screen.getByTitle("Copy"));
    });

    expect(iconPath(screen.getByTitle("Copy"))).toBe(mdiContentCopy);
    expect(document.querySelector("textarea")).toBeNull();
  });

  // Teardown race: the 1500 ms revert is a REAL timer in every suite that
  // clicks a copy button without fake timers (MarkdownContent, ChatView,
  // SkillInvocationCard, SessionBanner, ToolsSection). Those files finish in
  // far less than 1500 ms, so an uncleared timer fires after vitest tore the
  // jsdom environment down — `ReferenceError: window is not defined`, charged
  // to whichever suite happened to be draining. Unmount must cancel it.
  it("cancels the pending revert timer on unmount", async () => {
    const view = renderButton();

    await act(async () => {
      fireEvent.click(screen.getByTitle("Copy"));
    });
    expect(vi.getTimerCount()).toBe(1);

    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  // Rapid re-click must not leave the first timer orphaned either.
  it("keeps a single revert timer across repeated clicks", async () => {
    renderButton();

    await act(async () => {
      fireEvent.click(screen.getByTitle("Copy"));
    });
    await act(async () => {
      fireEvent.click(screen.getByTitle("Copy"));
    });

    expect(vi.getTimerCount()).toBe(1);
  });

  it("fails silently when neither path is available", async () => {
    Object.assign(navigator, { clipboard: undefined });
    Reflect.deleteProperty(document, "execCommand");

    renderButton();

    // Must not throw.
    await act(async () => {
      fireEvent.click(screen.getByTitle("Copy"));
    });

    expect(iconPath(screen.getByTitle("Copy"))).toBe(mdiContentCopy);
    expect(document.querySelector("textarea")).toBeNull();
  });
});
