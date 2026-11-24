/**
 * Tier-5 base-path hint: accessible copy button, announced failure, no execCommand fallback.
 * See change: serve-live-previews-on-capability-origin (D7, task 10.4).
 */
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BasePathHint } from "../live/LiveFrameParts.js";

const BASE = `/preview/${"A".repeat(22)}/`;
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("BasePathHint", () => {
  it("shows the base as selectable text with a named copy button; copy announces success", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<BasePathHint base={BASE} />);
    expect(screen.getByTestId("live-base-path").textContent).toBe(BASE);
    const btn = screen.getByRole("button", { name: /copy base path/i });
    fireEvent.click(btn);
    expect(writeText).toHaveBeenCalledWith(BASE);
    await waitFor(() => expect(screen.getByTestId("live-base-copy-status").textContent).toBe("Copied"));
    expect(screen.getByTestId("live-base-copy-status").getAttribute("aria-live")).toBe("polite");
  });
  it("a rejected or missing clipboard announces 'Copy failed — select the path' and keeps the path as text", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    const { unmount } = render(<BasePathHint base={BASE} />);
    fireEvent.click(screen.getByTestId("live-base-copy"));
    await waitFor(() => expect(screen.getByTestId("live-base-copy-status").textContent).toBe("Copy failed — select the path"));
    expect(screen.getByTestId("live-base-path").textContent).toBe(BASE);
    unmount();
    vi.stubGlobal("navigator", {});
    render(<BasePathHint base={BASE} />);
    fireEvent.click(screen.getByTestId("live-base-copy"));
    expect(screen.getByTestId("live-base-copy-status").textContent).toBe("Copy failed — select the path");
  });
  it("restartRequired says the base changed", () => {
    render(<BasePathHint base={BASE} restartRequired />);
    expect(screen.getByTestId("live-hint-base-path").textContent).toContain("base path changed");
    expect(screen.getByTestId("live-hint-base-path").getAttribute("role")).toBe("status");
  });
});
