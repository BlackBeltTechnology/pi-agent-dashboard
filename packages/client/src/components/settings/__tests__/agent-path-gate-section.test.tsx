import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentPathGateSection } from "../AgentPathGateSection.js";
import { computeConfigPartial } from "../SettingsPanel.js";

afterEach(() => cleanup());

describe("AgentPathGateSection (#F9 toggle surface)", () => {
  it("edits the draft through onChange (no writes of its own)", () => {
    const onChange = vi.fn();
    render(<AgentPathGateSection value={{ enabled: true, timeoutSeconds: 120 }} envOverride={null} onChange={onChange} />);
    fireEvent.click(screen.getByTestId("agent-path-gate-enabled"));
    expect(onChange).toHaveBeenCalledWith({ enabled: false, timeoutSeconds: 120 });
    fireEvent.change(screen.getByTestId("agent-path-gate-timeout"), { target: { value: "45" } });
    expect(onChange).toHaveBeenLastCalledWith({ enabled: true, timeoutSeconds: 45 });
  });

  it("is inert with the reason under an env override and shows the effective value", () => {
    render(<AgentPathGateSection value={{ enabled: true, timeoutSeconds: 120 }} envOverride="off" onChange={() => {}} />);
    const box = screen.getByTestId("agent-path-gate-enabled") as HTMLInputElement;
    expect(box.disabled).toBe(true);
    expect(box.checked).toBe(false);
    expect(screen.getByTestId("agent-path-gate-locked").textContent).toContain("PI_DASHBOARD_AGENT_PATH_GATE");
  });

  it("computeConfigPartial emits agentPathGate only when it changed", () => {
    const base: any = { port: 1, piPort: 2, tunnel: { enabled: false }, memoryLimits: {}, agentPathGate: { enabled: true, timeoutSeconds: 120 } };
    expect(computeConfigPartial(base, JSON.parse(JSON.stringify(base))).agentPathGate).toBeUndefined();
    const next = { ...base, agentPathGate: { enabled: false, timeoutSeconds: 120 } };
    expect(computeConfigPartial(next, base).agentPathGate).toEqual({ enabled: false, timeoutSeconds: 120 });
  });
});
