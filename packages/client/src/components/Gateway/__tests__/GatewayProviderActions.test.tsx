/**
 * `GatewayProviderActions` — the state that must NOT survive a readiness tick.
 *
 * The board re-polls every 5s and the row is keyed by provider, so this
 * component instance outlives the facts that justified an open panel. Every
 * assertion here is about that gap: a two-click gate is only a gate if the
 * second click is still required after the state changes underneath it.
 *
 * See change: add-zrok-custom-reserved-name (D9/D10).
 */
import type { ProviderReadiness } from "@blackbelt-technology/pi-dashboard-shared/tunnel-provider.js";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "../../../lib/gateway/gateway-api.js";
import { GatewayProviderActions } from "../GatewayProviderActions.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const CONNECTED: ProviderReadiness = {
  provider: "tailscale",
  state: "connected",
  endpoints: [{ kind: "public", url: "https://ts.example.com", tls: true }],
};
const DISCONNECTED: ProviderReadiness = { provider: "tailscale", state: "disconnected", endpoints: [] };

function renderActions(readiness: ProviderReadiness, isPrimary = false) {
  return render(
    <GatewayProviderActions
      readiness={readiness}
      isPrimary={isPrimary}
      config={{ gateways: [], tunnel: { provider: "zrok" } } as never}
      onConfigChange={() => {}}
    />,
  );
}

describe("an open panel does not survive the state that justified it", () => {
  it("closes the primary confirmation when the provider stops being connected", () => {
    const { rerender } = renderActions(CONNECTED);
    fireEvent.click(screen.getByTestId("gateway-make-primary-tailscale"));
    expect(screen.getByTestId("gateway-make-primary-confirm-tailscale")).toBeDefined();

    rerender(
      <GatewayProviderActions
        readiness={DISCONNECTED}
        isPrimary={false}
        config={{ gateways: [], tunnel: { provider: "zrok" } } as never}
        onConfigChange={() => {}}
      />,
    );
    // The whole group is gone — and when the provider reconnects the panel must
    // come back CLOSED, not re-open pre-confirmed.
    expect(screen.queryByTestId("gateway-make-primary-confirm-tailscale")).toBeNull();

    rerender(
      <GatewayProviderActions
        readiness={CONNECTED}
        isPrimary={false}
        config={{ gateways: [], tunnel: { provider: "zrok" } } as never}
        onConfigChange={() => {}}
      />,
    );
    expect(screen.queryByTestId("gateway-make-primary-confirm-tailscale")).toBeNull();
    expect(screen.getByTestId("gateway-make-primary-tailscale")).toBeDefined();
  });

  it("clears a typed offer selection when the URL stops being offerable", () => {
    const { rerender } = renderActions(CONNECTED);
    fireEvent.click(screen.getByTestId("gateway-register-offer-tailscale"));
    fireEvent.click(screen.getByTestId("gateway-offer-mode-pairing"));
    expect((screen.getByTestId("gateway-offer-mode-pairing") as HTMLInputElement).checked).toBe(true);

    // Registered from another surface → no longer offerable.
    const registered = {
      gateways: [{ url: "https://ts.example.com", authModes: ["pairing"], wrote: {} }],
      tunnel: { provider: "zrok" },
    };
    rerender(
      <GatewayProviderActions
        readiness={CONNECTED}
        isPrimary={false}
        config={registered as never}
        onConfigChange={() => {}}
      />,
    );
    expect(screen.queryByTestId("gateway-offer-panel-tailscale")).toBeNull();
    expect(screen.queryByTestId("gateway-register-offer-tailscale")).toBeNull();

    // Deregistered again (the record removed elsewhere): the offer returns, and
    // it must return EMPTY. A retained tick would re-open with `pairing` still
    // checked and one click away from a write the operator never chose.
    rerender(
      <GatewayProviderActions
        readiness={CONNECTED}
        isPrimary={false}
        config={{ gateways: [], tunnel: { provider: "zrok" } } as never}
        onConfigChange={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("gateway-register-offer-tailscale"));
    expect((screen.getByTestId("gateway-offer-mode-pairing") as HTMLInputElement).checked).toBe(false);
  });
});

describe("D9: a stale oauth selection cannot reach the write", () => {
  it("refuses to save once the provider is no longer primary", async () => {
    const putConfig = vi.spyOn(api, "putConfig").mockResolvedValue(undefined);
    vi.spyOn(api, "getConfig").mockResolvedValue({ gateways: [] } as never);

    // Primary → oauth is legal, so it can be selected.
    const { rerender } = renderActions(CONNECTED, true);
    fireEvent.click(screen.getByTestId("gateway-register-offer-tailscale"));
    fireEvent.click(screen.getByTestId("gateway-offer-mode-oauth"));
    expect((screen.getByTestId("gateway-offer-mode-oauth") as HTMLInputElement).checked).toBe(true);

    // A tick demotes it. The checkbox goes disabled but STAYS CHECKED — which
    // is exactly why `disabled` is not the guard.
    rerender(
      <GatewayProviderActions
        readiness={CONNECTED}
        isPrimary={false}
        config={{ gateways: [], tunnel: { provider: "zrok" } } as never}
        onConfigChange={() => {}}
      />,
    );
    expect((screen.getByTestId("gateway-offer-mode-oauth") as HTMLInputElement).disabled).toBe(true);

    const save = screen.getByTestId("gateway-offer-save-tailscale") as HTMLButtonElement;
    expect(save.disabled, "a selection containing an unavailable mode cannot save").toBe(true);
    fireEvent.click(save);
    await waitFor(() => {
      expect(putConfig).not.toHaveBeenCalled();
    });
  });
});
