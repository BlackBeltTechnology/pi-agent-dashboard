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
    expect(screen.queryByTitle("Remove server")).toBeNull();
    expect(screen.queryByText("Add server manually")).toBeNull();
    expect(screen.queryByText("Update")).toBeNull();
  });

  it("canManage:true shows the suggested address and an Update that accepts the move", async () => {
    listKnownServersWithAccess.mockResolvedValue({ servers: [ENTRY], canManage: true });
    render(<KnownServersSection />);
    await waitFor(() => expect(screen.getByText(/Moved to 192\.168\.16\.220:8000/)).toBeTruthy());
    expect(screen.getByTitle("Remove server")).toBeTruthy();
    expect(screen.getByText("Add server manually")).toBeTruthy();
    fireEvent.click(screen.getByText("Update"));
    await waitFor(() => expect(acceptKnownServerMove).toHaveBeenCalledWith("home-imac-75112.local", 8000));
  });
});
