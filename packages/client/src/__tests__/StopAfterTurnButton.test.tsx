/**
 * Stop-after-turn affordance in CommandInput.
 *
 * Hidden from composer to avoid duplicate stop buttons next to the red Stop.
 *
 * See change: adopt-pi-071-072-073-features (B.2).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { CommandInput } from "../components/CommandInput.js";

afterEach(() => cleanup());

function renderInput(props: Partial<React.ComponentProps<typeof CommandInput>> = {}) {
  const onSend = vi.fn();
  return render(<CommandInput commands={[]} onSend={onSend} {...props} />);
}

describe("StopAfterTurn button", () => {
  it("does not render a second stop button while streaming", () => {
    const streaming = renderInput({ sessionStatus: "streaming", onStopAfterTurn: vi.fn() });
    expect(streaming.queryByTestId("stop-after-turn-button")).toBeNull();
    expect(streaming.queryByTestId("stop-after-turn-pill")).toBeNull();
  });
});
