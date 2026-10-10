/**
 * Settings → Users. See change: add-passkey-user-auth (passkey-user-auth ›
 * User directory, › Invite by QR, › Relying-party ID (orphaned), › Passkeys
 * gated on a stable origin — disabled with reason, not hidden; task 4B.5, 3.3).
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UsersSection } from "../UsersSection.js";

const api = vi.hoisted(() => ({
  listUsers: vi.fn(),
  createUser: vi.fn(),
  setUserTier: vi.fn(),
  revokeUser: vi.fn(),
  mintInvite: vi.fn(),
  credentialImpact: vi.fn(),
}));
vi.mock("../../../lib/users/users-api.js", () => api);

const ANNA = {
  id: "a1",
  name: "Anna",
  tier: "observe",
  status: "active",
  createdAt: 1,
  credentials: [
    { rpId: "host.ts.net", orphaned: false },
    { rpId: "old.zrok.io", orphaned: true },
  ],
  invites: [],
};
const stableState = {
  enabled: true,
  rp: { rpId: "host.ts.net", rpOrigin: "https://host.ts.net", stable: true },
  bootstrapRequired: false,
  users: [ANNA],
};

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  api.listUsers.mockResolvedValue(stableState);
  api.createUser.mockResolvedValue(ANNA);
  api.setUserTier.mockResolvedValue(ANNA);
  api.revokeUser.mockResolvedValue(ANNA);
  api.mintInvite.mockResolvedValue({
    inviteId: "i1",
    url: "https://host.ts.net/auth/invite#tok",
    qrDataUrl: "data:image/svg+xml;base64,PHN2Zy8+",
    expiresAt: Date.now() + 86_400_000,
    maxUses: 1,
  });
});
afterEach(cleanup);

describe("UsersSection", () => {
  it("lists users with status and orphaned credential count", async () => {
    render(<UsersSection />);
    expect(await screen.findByText("Anna")).toBeTruthy();
    expect(screen.getByTestId("user-status-a1").textContent).toBe("active");
    expect(screen.getByTestId("user-orphaned-a1").textContent).toContain("1");
  });

  it("adds a user with the chosen tier", async () => {
    render(<UsersSection />);
    await screen.findByText("Anna");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Bob" } });
    fireEvent.change(screen.getByLabelText("Capability"), { target: { value: "control" } });
    fireEvent.submit(screen.getByTestId("users-add-form"));
    await waitFor(() => expect(api.createUser).toHaveBeenCalledWith("Bob", "control"));
  });

  it("mints an invite and shows its QR and link", async () => {
    render(<UsersSection />);
    fireEvent.click(await screen.findByTestId("user-invite-a1"));
    const panel = await screen.findByTestId("users-invite");
    expect(panel.querySelector("img")?.getAttribute("src")).toMatch(/^data:image\/svg\+xml/);
    expect(panel.textContent).toContain("https://host.ts.net/auth/invite#tok");
  });

  it("re-tiers and revokes (two-click)", async () => {
    render(<UsersSection />);
    await screen.findByText("Anna");
    fireEvent.change(screen.getByLabelText("Tier for Anna"), { target: { value: "operate" } });
    await waitFor(() => expect(api.setUserTier).toHaveBeenCalledWith("a1", "operate"));
    fireEvent.click(screen.getByText("Revoke"));
    expect(api.revokeUser).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Confirm revoke"));
    await waitFor(() => expect(api.revokeUser).toHaveBeenCalledWith("a1"));
  });

  it("unstable origin: invite is shown disabled with the reason", async () => {
    api.listUsers.mockResolvedValue({
      ...stableState,
      rp: { rpId: "x.share.zrok.io", rpOrigin: "https://x.share.zrok.io", stable: false, reason: "ephemeral_tunnel" },
    });
    render(<UsersSection />);
    const btn = (await screen.findByTestId("user-invite-a1")) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute("aria-describedby")).toBe("users-unstable-reason");
    expect(screen.getByTestId("users-unstable").textContent).toMatch(/ephemeral/);
  });

  it("disabled feature explains how to enable it", async () => {
    api.listUsers.mockResolvedValue({ ...stableState, enabled: false });
    render(<UsersSection />);
    expect((await screen.findByTestId("users-disabled")).textContent).toContain("auth.passkeys.enabled");
  });

  it("empty directory offers first-operator bootstrap without a tier picker", async () => {
    api.listUsers.mockResolvedValue({ ...stableState, bootstrapRequired: true, users: [] });
    render(<UsersSection />);
    expect(await screen.findByPlaceholderText("Your name (first operator)")).toBeTruthy();
    expect(screen.queryByLabelText("Capability")).toBeNull();
  });
});
