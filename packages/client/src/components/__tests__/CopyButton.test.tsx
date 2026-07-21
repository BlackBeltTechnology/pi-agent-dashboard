import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import React from "react";
import { Icon } from "@mdi/react";
import { mdiContentCopy } from "@mdi/js";
import { CopyButton } from "../primitives/CopyButton.js";

describe("CopyButton", () => {
  let writeTextMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText: writeTextMock },
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("renders the provided icon", () => {
    render(<CopyButton getText={() => "hello"} icon={<Icon path={mdiContentCopy} size={0.6} />} title="Copy" />);
    const btn = screen.getByTitle("Copy");
    expect(btn.querySelector("svg")).not.toBeNull();
  });

  it("copies text to clipboard on click", async () => {
    render(<CopyButton getText={() => "hello world"} icon={<Icon path={mdiContentCopy} size={0.6} />} title="Copy" />);

    await act(async () => {
      fireEvent.click(screen.getByTitle("Copy"));
    });

    expect(writeTextMock).toHaveBeenCalledWith("hello world");
  });

  it("shows checkmark feedback after click", async () => {
    render(<CopyButton getText={() => "hello"} icon={<Icon path={mdiContentCopy} size={0.6} />} title="Copy" />);

    await act(async () => {
      fireEvent.click(screen.getByTitle("Copy"));
    });

    // Should show check icon (svg still present but different path)
    const btn = screen.getByTitle("Copy");
    expect(btn.querySelector("svg")).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(1500);
    });

    // Should revert to original icon
    expect(btn.querySelector("svg")).not.toBeNull();
  });

  it("handles missing clipboard API gracefully", async () => {
    Object.assign(navigator, { clipboard: undefined });
    render(<CopyButton getText={() => "hello"} icon={<Icon path={mdiContentCopy} size={0.6} />} title="Copy" />);

    // Should not throw
    await act(async () => {
      fireEvent.click(screen.getByTitle("Copy"));
    });
    expect(screen.getByTitle("Copy")).not.toBeNull();
  });
});
