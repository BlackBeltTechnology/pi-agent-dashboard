import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { computeConfigPartial } from "../SettingsPanel.js";
import { SudoCredentialSection } from "../SudoCredentialSection.js";

afterEach(() => cleanup());

const stored = { enabled: true, timeoutMs: 120_000, cacheMinutes: 5 };

describe("SudoCredentialSection (S45)", () => {
  it("shows the toggle on by default and edits the draft through onChange only", () => {
    const onChange = vi.fn();
    render(<SudoCredentialSection value={stored} onChange={onChange} />);
    const box = screen.getByTestId("sudo-credential-enabled") as HTMLInputElement;
    expect(box.checked).toBe(true);
    fireEvent.click(box);
    expect(onChange).toHaveBeenLastCalledWith({ ...stored, enabled: false });
  });

  it.each([
    ["-1", 0],
    ["0", 0],
    ["60", 60],
    ["61", 60],
    ["1.5", 1],
    ["abc", 5],
  ])("cacheMinutes %s is clamped to %s", (raw, expected) => {
    const onChange = vi.fn();
    render(<SudoCredentialSection value={{ ...stored, cacheMinutes: 30 }} onChange={onChange} />);
    fireEvent.change(screen.getByTestId("sudo-credential-cache-minutes"), { target: { value: raw } });
    expect(onChange).toHaveBeenLastCalledWith({ ...stored, cacheMinutes: expected });
  });

  it("timeout is edited in seconds and clamped to [5 s, 600 s]", () => {
    const onChange = vi.fn();
    render(<SudoCredentialSection value={stored} onChange={onChange} />);
    const input = screen.getByTestId("sudo-credential-timeout");
    fireEvent.change(input, { target: { value: "30" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...stored, timeoutMs: 30_000 });
    fireEvent.change(input, { target: { value: "1" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...stored, timeoutMs: 5_000 });
    fireEvent.change(input, { target: { value: "9999" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...stored, timeoutMs: 600_000 });
  });

  it("computeConfigPartial emits sudoCredentialPrompt only when it changed (off persists enabled:false)", () => {
    const base: any = { port: 1, piPort: 2, tunnel: { enabled: false }, memoryLimits: {}, sudoCredentialPrompt: { ...stored } };
    expect(computeConfigPartial(base, JSON.parse(JSON.stringify(base))).sudoCredentialPrompt).toBeUndefined();
    const next = { ...base, sudoCredentialPrompt: { ...stored, enabled: false } };
    expect(computeConfigPartial(next, base).sudoCredentialPrompt).toEqual({ ...stored, enabled: false });
  });
});
