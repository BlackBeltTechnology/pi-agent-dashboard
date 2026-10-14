/**
 * "Stop after turn" button in CommandInput.
 *
 * Visible only while streaming; click invokes onStopAfterTurn and swaps to an
 * optimistic "stopping after this turn…" pill. Absent when idle.
 *
 * See change: adopt-pi-071-072-073-features (B.2).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { CommandInput } from "../components/chat/CommandInput.js";

afterEach(() => cleanup());

function renderInput(props: Partial<React.ComponentProps<typeof CommandInput>> = {}) {
  const onSend = vi.fn();
  return render(<CommandInput commands={[]} onSend={onSend} {...props} />);
}

describe("StopAfterTurn button", () => {
  it("is visible while streaming and hidden when idle", () => {
    const streaming = renderInput({ sessionStatus: "streaming", onStopAfterTurn: vi.fn() });
    expect(streaming.queryByTestId("stop-after-turn-button")).toBeTruthy();
    cleanup();

    const idle = renderInput({ sessionStatus: "idle", onStopAfterTurn: vi.fn() });
    expect(idle.queryByTestId("stop-after-turn-button")).toBeNull();
  });

  it("click invokes onStopAfterTurn and shows the optimistic pill", () => {
    const onStopAfterTurn = vi.fn();
    const { getByTestId, queryByTestId } = renderInput({ sessionStatus: "streaming", onStopAfterTurn });

    fireEvent.click(getByTestId("stop-after-turn-button"));

    expect(onStopAfterTurn).toHaveBeenCalledTimes(1);
    expect(queryByTestId("stop-after-turn-button")).toBeNull();
    expect(queryByTestId("stop-after-turn-pill")).toBeTruthy();
  });
});

// See change: fix-composer-liveness-on-reload (D7, test-plan #E14 / #F14).
describe("StopAfterTurn button — reconciled liveness", () => {
  it.each([
    ["streaming", false, true],
    ["idle", true, true],
    ["ended", true, false],
    ["idle", false, false],
  ] as const)("#E14 status=%s retrying=%s → visible=%s, co-present with stop-button", (status, retrying, visible) => {
    const { queryByTestId } = renderInput({ sessionStatus: status, retrying, onStopAfterTurn: vi.fn(), onAbort: vi.fn() });
    expect(!!queryByTestId("stop-after-turn-button")).toBe(visible);
    expect(!!queryByTestId("stop-button")).toBe(visible);
  });

  it("#F14 pill persists while status stays streaming and clears when it leaves streaming", () => {
    const props = { commands: [], onSend: vi.fn(), onStopAfterTurn: vi.fn(), onAbort: vi.fn() };
    const { getByTestId, queryByTestId, rerender } = render(<CommandInput {...props} sessionStatus="streaming" />);
    fireEvent.click(getByTestId("stop-after-turn-button"));
    rerender(<CommandInput {...props} sessionStatus="streaming" />);
    expect(queryByTestId("stop-after-turn-pill")).toBeTruthy();
    rerender(<CommandInput {...props} sessionStatus="idle" />);
    expect(queryByTestId("stop-after-turn-pill")).toBeNull();
  });
});
