/**
 * #E25 — discovery recognises a renamed server by identity, prefills the
 * advertised name, forwards the fingerprint as a hint and reports an update.
 * See change: stabilize-mdns-server-identity.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NetworkDiscoverySection } from "../NetworkDiscoverySection.js";

const { discoverServers, addKnownServer } = vi.hoisted(() => ({
  discoverServers: vi.fn(),
  addKnownServer: vi.fn(),
}));

vi.mock("../../../lib/api/known-servers-api.js", () => ({ discoverServers, addKnownServer }));

const F = "sha256:FFFF";
const G = "sha256:GGGG";
const base = { piPort: 9999, version: "0.9.0", pid: 1, isLocal: false };
const KNOWN = [{ host: "old.local", port: 8000, addedAt: "2026-01-01T00:00:00Z", fingerprint: F }];

beforeEach(() => {
  discoverServers.mockReset().mockResolvedValue([
    { ...base, host: "new.local", port: 8000, fingerprint: F },
    { ...base, host: "old.local", port: 8000 },
    { ...base, host: "studio.local", port: 8000, fingerprint: G, name: "Studio" },
  ]);
  addKnownServer.mockReset().mockResolvedValue({ updated: false });
});
afterEach(cleanup);

async function scan(onServerAdded = vi.fn()) {
  render(<NetworkDiscoverySection knownServers={KNOWN} onServerAdded={onServerAdded} />);
  fireEvent.click(screen.getByText("Scan network"));
  await waitFor(() => expect(screen.getAllByText("Already added")).toHaveLength(2));
  return onServerAdded;
}

describe("NetworkDiscoverySection (#E25)", () => {
  it("shows 'Already added' for a renamed identity and for a host:port match; offers Add otherwise", async () => {
    await scan();
    expect(screen.getAllByText("Add")).toHaveLength(1);
  });

  it("prefills the advertised name and sends the fingerprint hint", async () => {
    const onAdded = await scan();
    fireEvent.click(screen.getByText("Add"));
    expect((screen.getByPlaceholderText("Label") as HTMLInputElement).value).toBe("Studio");
    fireEvent.click(screen.getByTitle("Confirm"));
    await waitFor(() => expect(addKnownServer).toHaveBeenCalledWith("studio.local", 8000, "Studio", G));
    expect(onAdded).toHaveBeenCalled();
  });

  it("reports that an existing entry was updated", async () => {
    addKnownServer.mockResolvedValue({ updated: true });
    await scan();
    fireEvent.click(screen.getByText("Add"));
    fireEvent.click(screen.getByTitle("Confirm"));
    await waitFor(() => expect(screen.getByText(/updated existing entry/i)).toBeTruthy());
  });
});
