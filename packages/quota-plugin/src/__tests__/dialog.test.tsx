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

function renderDialog(initial: string, onClose = vi.fn()) {
  return render(
    withUiPrimitiveProvider(
      { [UI_PRIMITIVE_KEYS.dialog]: Dialog as never },
      <QuotaDialog providers={PROVIDERS} initial={initial} onClose={onClose} />,
    ),
  );
}

afterEach(cleanup);

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
});
