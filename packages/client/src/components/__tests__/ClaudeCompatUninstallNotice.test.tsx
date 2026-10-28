/**
 * One-time "you can uninstall pi-anthropic-messages" notice.
 * See change: retire-anthropic-messages-bridge (test-plan #E14).
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { claudeCompatStore } from "../../lib/claude-compat/claude-compat-store.js";
import { ClaudeCompatUninstallNotice, isAnthropicMessagesSource } from "../settings/ClaudeCompatControls.js";

const installed = vi.fn<() => { source: string }[]>();
vi.mock("../../hooks/useInstalledPackages.js", () => ({
  useInstalledPackages: () => ({ packages: installed(), isLoading: false, error: null, refresh: vi.fn() }),
}));

beforeEach(() => {
  localStorage.clear();
  claudeCompatStore.__resetForTests();
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  claudeCompatStore.__resetForTests();
});

const SOURCES = {
  scoped: "npm:@blackbelt-technology/pi-anthropic-messages",
  legacy: "npm:@pi/anthropic-messages@0.3.4",
  fork: "npm:pi-anthropic-messages-fork",
  none: null,
} as const;

describe("ClaudeCompatUninstallNotice (E14)", () => {
  for (const on of [true, false]) {
    for (const [name, source] of Object.entries(SOURCES)) {
      it(`switch on=${on} × installed=${name}`, () => {
        installed.mockReturnValue(source ? [{ source }] : []);
        act(() => claudeCompatStore.__setForTests(on));
        render(<ClaudeCompatUninstallNotice />);
        const want = on && (name === "scoped" || name === "legacy");
        expect(!!screen.queryByTestId("claude-compat-uninstall-notice")).toBe(want);
      });
    }
  }

  it("dismissal survives a remount in the same browser", () => {
    installed.mockReturnValue([{ source: SOURCES.scoped }]);
    act(() => claudeCompatStore.__setForTests(true));
    render(<ClaudeCompatUninstallNotice />);
    fireEvent.click(screen.getByLabelText(/dismiss/i));
    expect(screen.queryByTestId("claude-compat-uninstall-notice")).toBeNull();
    cleanup();
    render(<ClaudeCompatUninstallNotice />);
    expect(screen.queryByTestId("claude-compat-uninstall-notice")).toBeNull();
  });

  it("matches normalized package names exactly", () => {
    expect(isAnthropicMessagesSource("npm:@blackbelt-technology/pi-anthropic-messages@0.3.5")).toBe(true);
    expect(isAnthropicMessagesSource("@pi/anthropic-messages")).toBe(true);
    expect(isAnthropicMessagesSource("npm:@blackbelt-technology/pi-anthropic-messages-extra")).toBe(false);
    expect(isAnthropicMessagesSource("npm:pi-anthropic-messages")).toBe(false);
  });
});
