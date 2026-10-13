/**
 * #E26 — the Settings Servers section hides mutation controls from a
 * non-operator and offers Update on a moved entry for an operator.
 * See change: stabilize-mdns-server-identity.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KnownServersSection } from "../KnownServersSection.js";

const { listKnownServersWithAccess, acceptKnownServerMove, addKnownServer, removeKnownServer } = vi.hoisted(() => ({
  listKnownServersWithAccess: vi.fn(),
  acceptKnownServerMove: vi.fn(),
  addKnownServer: vi.fn(),
  removeKnownServer: vi.fn(),
}));

vi.mock("../../../lib/api/known-servers-api.js", () => ({
  listKnownServersWithAccess,
  acceptKnownServerMove,
  addKnownServer,
  removeKnownServer,
}));

const ENTRY = {
  host: "home-imac-75112.local",
  port: 8000,
  label: "iMac",
  addedAt: "2026-01-01T00:00:00Z",
  movedTo: { host: "192.168.16.220", port: 8000 },
};

beforeEach(() => {
  acceptKnownServerMove.mockReset().mockResolvedValue(true);
});
afterEach(cleanup);

describe("KnownServersSection (#E26)", () => {
  it("canManage:false lists entries read-only — no add / remove / Update", async () => {
    listKnownServersWithAccess.mockResolvedValue({ servers: [ENTRY], canManage: false });
    render(<KnownServersSection />);
    await waitFor(() => expect(screen.getByText("iMac")).toBeTruthy());
    expect(screen.queryByRole("button", { name: /^Remove / })).toBeNull();
    expect(screen.queryByText("Add server manually")).toBeNull();
    expect(screen.queryByText("Update")).toBeNull();
  });

  it("canManage:true shows the suggested address and an Update that accepts the move", async () => {
    listKnownServersWithAccess.mockResolvedValue({ servers: [ENTRY], canManage: true });
    render(<KnownServersSection />);
    await waitFor(() => expect(screen.getByText(/Moved to 192\.168\.16\.220:8000/)).toBeTruthy());
    // the remove control now names its target (retro-ux F11); removal is two-step (F12)
    expect(screen.getByRole("button", { name: "Remove iMac (home-imac-75112.local:8000)" })).toBeTruthy();
    expect(screen.getByText("Add server manually")).toBeTruthy();
    fireEvent.click(screen.getByText("Update"));
    await waitFor(() => expect(acceptKnownServerMove).toHaveBeenCalledWith("home-imac-75112.local", 8000));
  });
});

// retro-ux-identity-connectivity (test-plan #E5, #E6, #F10, #X1–#X3)
const PINNED = { host: "office-mac.local", port: 8000, label: "office-mac", addedAt: "2026-01-01T00:00:00Z", fingerprint: "sha256:abc" };
const PLAIN = { host: "192.168.16.202", port: 8000, addedAt: "2026-01-01T00:00:00Z" };

describe("KnownServersSection retro-ux", () => {
  beforeEach(() => {
    listKnownServersWithAccess.mockReset();
    removeKnownServer.mockReset().mockResolvedValue(undefined);
  });

  it.each([true, false])("E5: only the pinned entry shows one Verified pill (canManage %s)", async (canManage) => {
    listKnownServersWithAccess.mockResolvedValue({ servers: [PINNED, PLAIN], canManage });
    render(<KnownServersSection />);
    await screen.findByText("office-mac");
    const pills = screen.getAllByText("Verified");
    expect(pills).toHaveLength(1);
    const described = document.getElementById(pills[0].getAttribute("aria-describedby")!);
    expect(described?.textContent).toMatch(/verified when this server was added/i);
    expect(pills[0].closest("div")?.textContent).toContain("office-mac");
  });

  it("E6: read-only viewer — no controls, a note says why, moved-to still shown", async () => {
    listKnownServersWithAccess.mockResolvedValue({ servers: [ENTRY, PLAIN], canManage: false });
    render(<KnownServersSection />);
    await screen.findByText("iMac");
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByText(/operator credential is needed to change servers/)).toBeTruthy();
    expect(screen.getByText(/Moved to 192\.168\.16\.220:8000/)).toBeTruthy();
  });

  it("F10: Remove then Cancel keeps the entry; Remove then Confirm deletes once", async () => {
    listKnownServersWithAccess.mockResolvedValueOnce({ servers: [PINNED], canManage: true }).mockResolvedValue({ servers: [], canManage: true });
    render(<KnownServersSection />);
    await screen.findByText("office-mac");
    const remove = () => screen.getByRole("button", { name: "Remove office-mac (office-mac.local:8000)" });
    fireEvent.click(remove());
    fireEvent.click(screen.getByText("Cancel"));
    expect(removeKnownServer).not.toHaveBeenCalled();
    expect(screen.getByText("office-mac")).toBeTruthy();
    fireEvent.click(remove());
    fireEvent.click(screen.getByText("Confirm remove"));
    await waitFor(() => expect(removeKnownServer).toHaveBeenCalledTimes(1));
    expect(removeKnownServer).toHaveBeenCalledWith("office-mac.local", 8000);
    await waitFor(() => expect(screen.queryByText("office-mac")).toBeNull());
  });

  it("X1: a failed load shows an error with Retry, not the empty text; Retry recovers", async () => {
    listKnownServersWithAccess.mockRejectedValueOnce(new Error("HTTP 503")).mockResolvedValue({ servers: [PINNED], canManage: true });
    render(<KnownServersSection />);
    expect((await screen.findByRole("alert")).textContent).toContain("HTTP 503");
    expect(screen.queryByText(/No remote servers saved/)).toBeNull();
    fireEvent.click(screen.getByText("Retry"));
    await screen.findByText("office-mac");
    expect(listKnownServersWithAccess).toHaveBeenCalledTimes(2);
  });

  it("X2: a failed remove keeps the entry and reports next to it", async () => {
    listKnownServersWithAccess.mockResolvedValue({ servers: [PINNED], canManage: true });
    removeKnownServer.mockRejectedValue(new Error("403"));
    render(<KnownServersSection />);
    await screen.findByText("office-mac");
    fireEvent.click(screen.getByRole("button", { name: /^Remove office-mac/ }));
    fireEvent.click(screen.getByText("Confirm remove"));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("403");
    expect(screen.getByText("office-mac")).toBeTruthy();
  });

  it("X3: a refused move acceptance leaves the entry and reports next to it", async () => {
    listKnownServersWithAccess.mockResolvedValue({ servers: [ENTRY], canManage: true });
    acceptKnownServerMove.mockResolvedValue(false);
    render(<KnownServersSection />);
    await screen.findByText(/Moved to/);
    fireEvent.click(screen.getByText("Update"));
    expect((await screen.findByRole("alert")).textContent).toMatch(/operator credential/);
    expect(screen.getByText(/Moved to 192\.168\.16\.220:8000/)).toBeTruthy();
    expect(listKnownServersWithAccess).toHaveBeenCalledTimes(1); // no reload on refusal
  });
});
