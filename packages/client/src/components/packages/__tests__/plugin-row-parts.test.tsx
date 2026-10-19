/**
 * The plugin list's status pill and error notice are the shared runtime-kit parts
 * (test-plan #E8, adapted: the list's pill states are unknown / error / disabled /
 * not loaded / enabled; `waiting_peers` is not a state this list renders).
 * See change: align-ui-contract-recipes (design D4).
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginRow } from "../../../lib/package/plugins-api.js";
import { PluginErrorNotice, StatusPill } from "../plugin-row-parts.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const row = (status: Partial<NonNullable<PluginRow["status"]>> | null): PluginRow =>
  ({
    id: "demo",
    displayName: "Demo",
    priority: 100,
    hasServer: false,
    hasBridge: false,
    hasClient: true,
    claims: [],
    requires: null,
    status: status && { id: "demo", displayName: "Demo", enabled: true, loaded: true, claims: 0, ...status },
  }) as unknown as PluginRow;

describe("plugin list StatusPill", () => {
  it.each([
    ["unknown", null, "Status unknown", "neutral"],
    ["error", { error: "Error: Cannot find module 'x'\n    at load (a.js:1:1)" }, "Failed to load", "error"],
    ["disabled", { enabled: false, loaded: false }, "Off", "neutral"],
    ["not-loaded", { loaded: false }, "Not loaded", "warning"],
    ["enabled", {}, "On", "success"],
  ] as const)("%s shows a human word; the raw state stays in data-status", (raw, status, word, tone) => {
    const { container } = render(<StatusPill row={row(status)} />);
    const pill = container.querySelector("[data-tone]") as HTMLElement;
    expect(pill.textContent).toBe(word);
    expect(pill.getAttribute("data-tone")).toBe(tone);
    expect(pill.getAttribute("data-status")).toBe(raw);
    expect(pill.className).not.toContain("text-[10px]");
    expect(pill.className).toContain(`bg-[var(--severity-${tone}-bg)]`);
    // Non-neutral tones carry the kit's default icon; neutral is word-only by design.
    expect(pill.querySelector("svg") !== null).toBe(tone !== "neutral");
  });

  it("never shows the raw error text, not even as a tooltip", () => {
    const { container } = render(<StatusPill row={row({ error: "Error: boom\n    at x" })} />);
    expect(container.textContent).not.toContain("boom");
    expect(container.querySelector("[title]")).toBeNull();
  });

});

describe("PluginErrorNotice", () => {
  it("shows one sentence; the raw text is only in the Copy-details payload", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const stack = "Error: Cannot find module 'x'\n    at load (a.js:1:1)";
    render(<PluginErrorNotice text={stack} testId="plugin-status-error-demo" />);
    const notice = screen.getByTestId("plugin-status-error-demo");
    expect(notice.getAttribute("role")).toBe("alert");
    expect(notice.textContent).toContain("This plugin failed to load.");
    expect(notice.textContent).not.toContain("Cannot find module");
    await act(async () => {
      fireEvent.click(screen.getByTestId("plugin-status-error-demo-copy-details"));
    });
    expect(writeText).toHaveBeenCalledWith(stack);
  });

  it("a caller-supplied sentence replaces the default", () => {
    render(<PluginErrorNotice text="HTTP 500" sentence="Couldn't change this plugin." testId="e" />);
    expect(screen.getByTestId("e").textContent).toContain("Couldn't change this plugin.");
    expect(screen.getByTestId("e").textContent).not.toContain("HTTP 500");
  });
});
