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
    expect(screen.getByTestId("user-status-a1").textContent).toBe("Active");
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

  // retro-ux-identity-connectivity (test-plan #E9, #E10, #X7)
  const user = (id: string, name: string, status: string, creds: Array<{ rpId: string; orphaned: boolean }> = []) => ({
    ...ANNA,
    id,
    name,
    status,
    credentials: creds,
  });

  it("E9: status pills read Active / Invite pending / Revoked; orphaned is its own warning pill", async () => {
    api.listUsers.mockResolvedValue({
      ...stableState,
      users: [
        user("u1", "Anna", "active", [{ rpId: "host.ts.net", orphaned: false }]),
        user("u2", "Bence", "invited"),
        user("u3", "Gabor", "revoked"),
        user("u4", "Dora", "active", [
          { rpId: "host.ts.net", orphaned: false },
          { rpId: "old", orphaned: true },
          { rpId: "older", orphaned: true },
        ]),
      ],
    });
    render(<UsersSection />);
    await screen.findByText("Anna");
    expect(screen.getByTestId("user-status-u1").textContent).toBe("Active");
    expect(screen.getByTestId("user-status-u2").textContent).toBe("Invite pending");
    expect(screen.getByTestId("user-status-u3").textContent).toBe("Revoked");
    const orphaned = screen.getByTestId("user-orphaned-u4");
    expect(orphaned.textContent).toBe("2 orphaned");
    expect(orphaned).not.toBe(screen.getByTestId("user-status-u4")); // separate element
    expect(screen.queryByTestId("user-orphaned-u1")).toBeNull();
  });

  it("E10: every pre-existing testid renders in its state", async () => {
    // list + invite open
    render(<UsersSection />);
    await screen.findByTestId("user-a1");
    expect(screen.getByTestId("users-add-form")).toBeTruthy();
    expect(screen.getByTestId("user-status-a1")).toBeTruthy();
    expect(screen.getByTestId("user-orphaned-a1")).toBeTruthy();
    fireEvent.click(screen.getByTestId("user-invite-a1"));
    expect(await screen.findByTestId("users-invite")).toBeTruthy();
    cleanup();
    // disabled
    api.listUsers.mockResolvedValue({ ...stableState, enabled: false });
    render(<UsersSection />);
    expect(await screen.findByTestId("users-disabled")).toBeTruthy();
    cleanup();
    // unstable
    api.listUsers.mockResolvedValue({
      ...stableState,
      rp: { rpId: "x.share.zrok.io", rpOrigin: "https://x.share.zrok.io", stable: false, reason: "ephemeral_tunnel" },
    });
    render(<UsersSection />);
    expect(await screen.findByTestId("users-unstable")).toBeTruthy();
  });

  it("X7: copy failure is shown in the error severity colour as a status message", async () => {
    const clip = await import("../../../lib/util/clipboard.js");
    vi.spyOn(clip, "copyText").mockResolvedValue(false);
    render(<UsersSection />);
    fireEvent.click(await screen.findByTestId("user-invite-a1"));
    await screen.findByTestId("users-invite");
    fireEvent.click(screen.getByText("Copy link"));
    const msg = await screen.findByText(/Copy failed/);
    expect(msg.getAttribute("role")).toBe("status");
    expect(msg.className).toContain("--severity-error-fg");
    expect(msg.className).not.toContain("--status-error");
  });

  it("a failed load shows an error with Retry that reloads", async () => {
    api.listUsers.mockRejectedValueOnce(new Error("503")).mockResolvedValue(stableState);
    render(<UsersSection />);
    expect((await screen.findByRole("alert")).textContent).toContain("503");
    fireEvent.click(screen.getByText("Retry"));
    expect(await screen.findByText("Anna")).toBeTruthy();
  });
});
