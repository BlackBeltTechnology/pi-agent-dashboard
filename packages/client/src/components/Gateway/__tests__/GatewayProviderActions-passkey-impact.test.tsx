/**
 * Primary switch warns how many passkeys it orphans.
 * See change: add-passkey-user-auth (passkey-user-auth › Primary switch warns
 * about orphaned passkeys; task 3.2).
 */
import type { ProviderReadiness } from "@blackbelt-technology/pi-dashboard-shared/tunnel-provider.js";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GatewayProviderActions } from "../GatewayProviderActions.js";

const { credentialImpact } = vi.hoisted(() => ({ credentialImpact: vi.fn() }));
vi.mock("../../../lib/users/users-api.js", () => ({ credentialImpact }));

const CONNECTED: ProviderReadiness = {
  provider: "tailscale",
  state: "connected",
  endpoints: [{ kind: "public", url: "https://ts.example.com", tls: true }],
};

function renderWith(config: Record<string, unknown>) {
  render(
    <GatewayProviderActions readiness={CONNECTED} isPrimary={false} configLoaded config={config as never} onConfigChange={() => {}} />,
  );
  fireEvent.click(screen.getByTestId("gateway-make-primary-tailscale"));
}

beforeEach(() => credentialImpact.mockReset());
afterEach(cleanup);

describe("primary switch passkey impact", () => {
  it("states that N passkeys for M users will stop working", async () => {
    credentialImpact.mockResolvedValue({ currentRpId: "a.zrok.io", nextRpId: "ts.example.com", orphaned: 3, users: 2 });
    renderWith({ gateways: [], tunnel: { provider: "zrok" } });
    const note = await screen.findByTestId("gateway-make-primary-passkey-impact-tailscale");
    expect(note.textContent).toContain("3 passkey");
    expect(note.textContent).toContain("2 user");
    expect(credentialImpact).toHaveBeenCalledWith({ url: "https://ts.example.com" });
  });

  it("says nothing when no passkey would be orphaned", async () => {
    credentialImpact.mockResolvedValue({ currentRpId: "x", nextRpId: "y", orphaned: 0, users: 0 });
    renderWith({ gateways: [], tunnel: { provider: "zrok" } });
    await waitFor(() => expect(credentialImpact).toHaveBeenCalled());
    expect(screen.queryByTestId("gateway-make-primary-passkey-impact-tailscale")).toBeNull();
  });

  it("does not ask when auth.redirectBaseUrl pins the origin", () => {
    renderWith({ gateways: [], tunnel: { provider: "zrok" }, auth: { redirectBaseUrl: "https://dash.example.com" } });
    expect(credentialImpact).not.toHaveBeenCalled();
  });
});
