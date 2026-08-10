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
