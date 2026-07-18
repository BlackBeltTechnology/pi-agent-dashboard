import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import React from "react";
import { StatePill, STATE_PILL_CLASS, stateToLabel } from "../session/StatePill.js";
import { ChangeState } from "@blackbelt-technology/pi-dashboard-shared/types.js";

afterEach(() => cleanup());

describe("StatePill", () => {
  const cases: Array<{ state: ChangeState; colorToken: string }> = [
    { state: ChangeState.PLANNING, colorToken: "zinc" },
    { state: ChangeState.READY, colorToken: "blue" },
    { state: ChangeState.IMPLEMENTING, colorToken: "amber" },
    { state: ChangeState.COMPLETE, colorToken: "green" },
  ];

  for (const { state, colorToken } of cases) {
    it(`renders ${state} label with ${colorToken} color class`, () => {
      render(<StatePill state={state} />);
      const el = screen.getByTestId("state-pill");
      expect(el.textContent).toBe(stateToLabel(state));
      expect(el.className).toContain(colorToken);
      expect(el.getAttribute("data-state")).toBe(state);
    });
  }

  it("stateToLabel returns the enum value as-is", () => {
    expect(stateToLabel(ChangeState.IMPLEMENTING)).toBe("IMPLEMENTING");
  });

  it("STATE_PILL_CLASS covers every ChangeState value", () => {
    for (const v of Object.values(ChangeState)) {
      expect(typeof STATE_PILL_CLASS[v as ChangeState]).toBe("string");
      expect(STATE_PILL_CLASS[v as ChangeState].length).toBeGreaterThan(0);
    }
  });
});
