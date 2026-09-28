/**
 * ToolStopControl token fidelity + shape per state.
 * Test-plan #X3, #F18. See change: fix-chat-burst-tool-stop.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mdiAlert, mdiLoading, mdiStop, mdiTimerSand } from "@mdi/js";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { type StopController, ToolStopControl, type ToolStopState } from "../chat/ToolStopControl.js";

const here = dirname(fileURLToPath(import.meta.url));
const TOOL_CALL_STEP_SRC = readFileSync(resolve(here, "../chat/ToolCallStep.tsx"), "utf8");

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});
afterEach(() => cleanup());

const STATES: ToolStopState[] = ["idle", "arming", "aborting", "killing"];
const ctrl = (state: ToolStopState): StopController => ({ state, stop: vi.fn(), forceKill: vi.fn() });
const button = (state: ToolStopState) =>
  render(<ToolStopControl controller={ctrl(state)} labeled />).container.querySelector("button") as HTMLButtonElement;

describe("ToolStopControl", () => {
  it("#X3 uses severity tokens only, no raw red/orange literals", () => {
    expect(button("idle").className).toContain("--severity-error-fg");
    cleanup();
    expect(button("aborting").className).toContain("--severity-warning-fg");
    for (const s of STATES) {
      cleanup();
      expect(button(s).className).not.toMatch(/(red|orange)-\d/);
    }
    expect(TOOL_CALL_STEP_SRC).not.toContain("severity-exempt");
  });

  it("#F18 distinct glyph per state, arming labelled Stopping…", () => {
    const expected: Record<ToolStopState, string> = {
      idle: mdiStop,
      arming: mdiTimerSand,
      aborting: mdiAlert,
      killing: mdiLoading,
    };
    for (const s of STATES) {
      cleanup();
      const b = button(s);
      expect(b.querySelector("svg path")?.getAttribute("d")).toBe(expected[s]);
      if (s === "arming") expect(b.getAttribute("aria-label")).toBe("Stopping…");
    }
  });

  it("renders nothing for a null controller", () => {
    const { container } = render(<ToolStopControl controller={null} />);
    expect(container.firstChild).toBeNull();
  });
});
