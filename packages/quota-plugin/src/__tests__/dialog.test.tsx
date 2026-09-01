import { withUiPrimitiveProvider } from "@blackbelt-technology/dashboard-plugin-runtime/test-support";
import { Dialog } from "@blackbelt-technology/pi-dashboard-client-utils/Dialog";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QuotaDialog } from "../client.js";
import type { ProviderQuota } from "../types.js";

const WINDOW = 5 * 3600;
const resetIn = (f: number) => new Date(Date.now() + WINDOW * f * 1000).toISOString();

const PROVIDERS: ProviderQuota[] = [
  { provider: "openai-codex", windows: [{ label: "7d", usedPercent: 30, resetsAt: resetIn(0.5), windowSeconds: WINDOW }] },
  { provider: "github-copilot", windows: [{ label: "month", usedPercent: 10, resetsAt: resetIn(0.5), windowSeconds: 30 * 86400 }] },
];

function renderDialog(initial: string, onClose = vi.fn(), providers = PROVIDERS) {
  return render(
    withUiPrimitiveProvider(
      { [UI_PRIMITIVE_KEYS.dialog]: Dialog as never },
      <QuotaDialog providers={providers} initial={initial} onClose={onClose} />,
    ),
  );
}

afterEach(cleanup);

describe("QuotaDialog retained-snapshot badge", () => {
  // Retained (stale) figures are surfaced HERE ONLY — the footer bar renders
  // them identically to fresh ones, by explicit product decision.
  // See change: publish-quota-plugin.
  const RETAINED: ProviderQuota[] = [{ ...PROVIDERS[0], stale: true }];

  it("flags a retained snapshot so the figures are not read as live", () => {
    renderDialog("openai-codex", vi.fn(), RETAINED);
    expect(screen.getByTestId("quota-stale-openai-codex")).toBeTruthy();
  });

  it("shows no badge for a fresh snapshot", () => {
    renderDialog("openai-codex");
    expect(screen.queryByTestId("quota-stale-openai-codex")).toBeNull();
  });

  it("still renders the retained figures themselves", () => {
    renderDialog("openai-codex", vi.fn(), RETAINED);
    expect(screen.getByTestId("quota-card-openai-codex").textContent).toContain("30%");
  });
});

describe("QuotaDialog", () => {
  it("opens the shared Dialog primitive pre-selected to the clicked provider", () => {
    renderDialog("openai-codex");
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(screen.getByTestId("quota-card-openai-codex")).toBeTruthy();
    expect(screen.queryByTestId("quota-card-github-copilot")).toBeNull();
  });

  it("selector switches to All → a card per provider", () => {
    renderDialog("openai-codex");
    fireEvent.click(screen.getByText("All"));
    expect(screen.getByTestId("quota-card-openai-codex")).toBeTruthy();
    expect(screen.getByTestId("quota-card-github-copilot")).toBeTruthy();
  });

  it("selector switches to another single provider", () => {
    renderDialog("openai-codex");
    fireEvent.click(screen.getByText("Copilot"));
    expect(screen.getByTestId("quota-card-github-copilot")).toBeTruthy();
    expect(screen.queryByTestId("quota-card-openai-codex")).toBeNull();
  });

  it("Esc closes via the primitive", () => {
    const onClose = vi.fn();
    renderDialog("openai-codex", onClose);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("shows when each window resets", () => {
    renderDialog("openai-codex");
    // 5h window, half remaining → ~2h30m out.
    expect(screen.getByTestId("quota-resets-in").textContent).toMatch(/^resets in 2h 2\dm$/);
  });

  it("omits the reset caption for a past/sentinel timestamp", () => {
    render(
      withUiPrimitiveProvider(
        { [UI_PRIMITIVE_KEYS.dialog]: Dialog as never },
        <QuotaDialog
          providers={[
            {
              provider: "zai",
              // Epoch-zero sentinel, as Z.ai actually ships for its 5h window.
              windows: [{ label: "5h", usedPercent: 0, resetsAt: "1970-01-01T00:00:00.000Z", windowSeconds: WINDOW }],
            },
          ]}
          initial="zai"
          onClose={vi.fn()}
        />,
      ),
    );
    expect(screen.getByTestId("quota-card-zai")).toBeTruthy();
    expect(screen.queryByTestId("quota-resets-in")).toBeNull();
  });
});
