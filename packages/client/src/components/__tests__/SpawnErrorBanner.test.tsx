/**
 * Tests for the migrated SpawnErrorBanner (change: redesign-directory-card).
 * It now renders via the shared `InlineMessage` primitive; stderr renders in a
 * `LogBlock` (collapsible, closed by default); the timeout case is an
 * `InlineMessage severity="warning"` (no separate `TimeoutBanner` component).
 * Test ids `spawn-error-banner`, `spawn-timeout-banner`, `spawn-error-dismiss`
 * are preserved.
 */
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SpawnErrorDetail } from "../../hooks/useMessageHandler.js";
import { SpawnErrorBanner } from "../session/SpawnErrorBanner.js";

afterEach(() => cleanup());

describe("SpawnErrorBanner (InlineMessage migration)", () => {
  it("renders an error surface with the code hint and preserves spawn-error-banner id", () => {
    const detail: SpawnErrorDetail = { kind: "error", message: "boom", code: "PI_NOT_FOUND" };
    const { getByTestId } = render(<SpawnErrorBanner detail={detail} />);
    const el = getByTestId("spawn-error-banner");
    expect(el).toBeTruthy();
    expect(el.textContent).toContain("Pi binary not found.");
    // Severity tokens, not raw literals.
    expect(el.outerHTML).toContain("--severity-error");
    expect(el.outerHTML).not.toMatch(/\bred-500\b/);
  });

  it("renders stderr inside a collapsible LogBlock (closed by default), not <details>", () => {
    const detail: SpawnErrorDetail = { kind: "error", message: "crash", code: "PI_CRASHED", stderr: "Error: nope" };
    const { getByTestId, queryByTestId } = render(<SpawnErrorBanner detail={detail} />);
    expect(getByTestId("log-block")).toBeTruthy();
    // Collapsed by default → no body until toggled.
    expect(queryByTestId("log-block-body")).toBeNull();
    fireEvent.click(getByTestId("log-block-toggle"));
    expect(getByTestId("log-block-body").textContent).toContain("Error: nope");
  });

  it("timeout renders as a warning InlineMessage under spawn-timeout-banner id", () => {
    const detail: SpawnErrorDetail = { kind: "timeout", message: "", pid: 4242, timeoutMs: 30000 };
    const { getByTestId } = render(<SpawnErrorBanner detail={detail} />);
    const el = getByTestId("spawn-timeout-banner");
    expect(el).toBeTruthy();
    expect(el.outerHTML).toContain("--severity-warning");
    expect(el.outerHTML).not.toMatch(/\bamber-500\b/);
    expect(el.textContent).toMatch(/4242/);
  });

  it("dismiss fires onDismiss only", () => {
    const onDismiss = vi.fn();
    const detail: SpawnErrorDetail = { kind: "error", message: "boom" };
    const { getByTestId } = render(<SpawnErrorBanner detail={detail} onDismiss={onDismiss} />);
    fireEvent.click(getByTestId("spawn-error-dismiss"));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
