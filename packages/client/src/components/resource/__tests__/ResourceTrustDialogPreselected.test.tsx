/**
 * Resource trust dialog with a dashboard pre-selection (test-plan #F4): "Trust" starts
 * selected, the lasting-effect text is visible, Esc sends nothing, confirm sends one choice.
 * See change: mirror-dashboard-trust-to-pi.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResourceTrustDialog } from "../ResourceTrustDialog.js";

afterEach(() => cleanup());

const OPTIONS = [
  { id: "trust", label: "Trust", trusted: true },
  { id: "trust-parent", label: "Trust parent folder (/Users/me)", trusted: true },
  { id: "decline", label: "Do not trust", trusted: false },
] as never;
const MESSAGE =
  "The dashboard already trusts this folder (pinned folder). Approving writes a lasting pi trust decision that terminal pi also honours; unpinning or revoking the dashboard entry does not remove it.";

function open(onChoose = vi.fn(), onDismiss = vi.fn()) {
  render(
    <ResourceTrustDialog
      cwd="/Users/me/Documents/app"
      message={MESSAGE}
      options={OPTIONS}
      preselected="trust"
      dashboardSource="pinned folder"
      onChoose={onChoose}
      onDismiss={onDismiss}
    />,
  );
  return { onChoose, onDismiss };
}

describe("#F4 pre-selected trust option", () => {
  it("shows trust pre-selected with the source and the lasting effect", () => {
    open();
    const trust = screen.getByTestId("resource-trust-option-trust");
    expect(trust.getAttribute("data-preselected")).toBe("true");
    expect(trust.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("resource-trust-option-decline").getAttribute("aria-pressed")).toBe("false");
    expect(document.activeElement).toBe(trust);
    expect(screen.getByTestId("resource-trust-preselected-note").textContent).toContain("pinned folder");
    expect(screen.getByTestId("resource-trust-message").textContent).toMatch(/lasting pi trust decision/);
  });

  it("Esc sends no choice; confirming sends exactly one", () => {
    const { onChoose, onDismiss } = open();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onChoose).not.toHaveBeenCalled();
    expect(onDismiss).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("resource-trust-option-trust"));
    expect(onChoose).toHaveBeenCalledTimes(1);
    expect(onChoose).toHaveBeenCalledWith("trust");
  });
});
