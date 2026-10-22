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
    fireEvent.click(screen.getByRole("button", { name: "Add Studio" }));
    await waitFor(() => expect(addKnownServer).toHaveBeenCalledWith("studio.local", 8000, "Studio", G));
    expect(onAdded).toHaveBeenCalled();
  });

  it("reports that an existing entry was updated", async () => {
    addKnownServer.mockResolvedValue({ updated: true });
    await scan();
    fireEvent.click(screen.getByText("Add"));
    fireEvent.click(screen.getByRole("button", { name: "Add Studio" }));
    await waitFor(() => expect(screen.getByText(/updated existing entry/i)).toBeTruthy());
  });
});

// retro-ux-identity-connectivity (test-plan #E11, #E12, #F11, #X5, #X6)
describe("NetworkDiscoverySection retro-ux", () => {
  const renderEmpty = async (known: typeof KNOWN = []) => {
    discoverServers.mockReset().mockResolvedValue([]);
    render(<NetworkDiscoverySection knownServers={known} onServerAdded={vi.fn()} />);
    fireEvent.click(screen.getByText("Scan network"));
    await screen.findByText(/No dashboards found via mDNS/);
  };

  it("E11: headline visible, the 5 reasons collapsed in <details>, labelled Address input visible", async () => {
    await renderEmpty();
    const reason = screen.getByText(/AP\/client isolation/).closest("li")!;
    const details = reason.closest("details")!;
    expect(details).toBeTruthy();
    expect(details.open).toBe(false);
    expect(details.querySelectorAll("li")).toHaveLength(5);
    expect(screen.getByText("Why does discovery fail?").closest("details")).toBe(details);
    const input = screen.getByLabelText("Address");
    expect(input.closest("details")).toBeNull();
  });

  it("E12: invalid → aria-invalid + described error, no POST; duplicate names host:port; valid posts once and clears", async () => {
    await renderEmpty([{ host: "192.168.16.202", port: 8000, addedAt: "2026-01-01T00:00:00Z" }] as never);
    const input = screen.getByLabelText("Address") as HTMLInputElement;
    const submit = () => fireEvent.click(screen.getByRole("button", { name: "Add" }));

    fireEvent.change(input, { target: { value: "[::1" } }); // unparseable (note: "192.168.16" parses as a host)
    submit();
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(input.getAttribute("aria-describedby")!)?.textContent).toMatch(/Enter a host like 192\.168\.1\.42:8000/);
    expect(addKnownServer).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "192.168.16.202:8000" } });
    submit();
    expect(document.getElementById(input.getAttribute("aria-describedby")!)?.textContent).toContain("192.168.16.202:8000");
    expect(addKnownServer).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "http://lab-mini.local:8000" } });
    submit();
    await waitFor(() => expect(addKnownServer).toHaveBeenCalledTimes(1));
    expect(addKnownServer).toHaveBeenCalledWith("lab-mini.local", 8000, undefined);
    await waitFor(() => expect(input.value).toBe(""));
  });

  it("F11: the polite live region reads Scanning… then Found 2 dashboards.", async () => {
    let resolve!: (v: unknown[]) => void;
    discoverServers.mockReset().mockReturnValue(new Promise((r) => { resolve = r; }));
    render(<NetworkDiscoverySection knownServers={[]} onServerAdded={vi.fn()} />);
    const region = () => document.querySelector('[aria-live="polite"]')!;
    expect(region()).toBeTruthy();
    fireEvent.click(screen.getByText("Scan network"));
    await waitFor(() => expect(region().textContent).toBe("Scanning…"));
    resolve([
      { ...base, host: "a.local", port: 8000 },
      { ...base, host: "b.local", port: 8000 },
    ]);
    await waitFor(() => expect(region().textContent).toBe("Found 2 dashboards."));
  });

  it("X5: a failed scan shows a severity-error callout with Retry, and the empty diagnostic too", async () => {
    discoverServers.mockReset().mockRejectedValueOnce(new Error("connection refused")).mockResolvedValue([]);
    render(<NetworkDiscoverySection knownServers={[]} onServerAdded={vi.fn()} />);
    fireEvent.click(screen.getByText("Scan network"));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Scan failed: connection refused");
    expect(alert.className).toContain("--severity-error");
    expect(screen.getByText(/No dashboards found via mDNS/)).toBeTruthy();
    fireEvent.click(screen.getByText("Retry"));
    await waitFor(() => expect(discoverServers).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("X6: a failed add-confirm reports next to the server and never shows Already added", async () => {
    discoverServers.mockReset().mockResolvedValue([{ ...base, host: "new.local", port: 8000 }]);
    addKnownServer.mockReset().mockRejectedValue(new Error("403"));
    render(<NetworkDiscoverySection knownServers={[]} onServerAdded={vi.fn()} />);
    fireEvent.click(screen.getByText("Scan network"));
    fireEvent.click(await screen.findByRole("button", { name: /^Add new\.local/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add new.local" }));
    expect((await screen.findByRole("alert")).textContent).toContain("403");
    expect(screen.queryByText("Already added")).toBeNull();
  });
});

// add-lan-knock-pairing — Connect on remote rows (test-plan #E27, known-servers delta).
describe("NetworkDiscoverySection Connect (E27)", () => {
  let open: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    open = vi.fn();
    vi.stubGlobal("open", open);
    discoverServers.mockReset().mockResolvedValue([
      { ...base, host: "192.168.16.204", port: 8000, name: "home-imac" },
      { ...base, host: "fd12::4", port: 8000 },
      { ...base, host: "robson-mbp.local", port: 8000, name: "robson-mbp", isLocal: true },
    ]);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  const scanThree = async () => {
    render(<NetworkDiscoverySection knownServers={[]} onServerAdded={vi.fn()} />);
    fireEvent.click(screen.getByText("Scan network"));
    await screen.findByText("home-imac");
  };

  it("a remote IPv4 row opens its /pair?request in a new context with noopener", async () => {
    await scanThree();
    fireEvent.click(screen.getByRole("button", { name: "Connect to home-imac (opens in a new tab)" }));
    expect(open).toHaveBeenCalledWith("http://192.168.16.204:8000/pair?request", "_blank", "noopener,noreferrer");
  });

  it("a remote IPv6 literal is bracketed in the opened URL", async () => {
    await scanThree();
    fireEvent.click(screen.getByRole("button", { name: "Connect to fd12::4 (opens in a new tab)" }));
    expect(open).toHaveBeenCalledWith("http://[fd12::4]:8000/pair?request", "_blank", "noopener,noreferrer");
  });

  it("a hostile advertised host offers no Connect (the URL must round-trip to the advertised host)", async () => {
    discoverServers.mockReset().mockResolvedValue([
      { ...base, host: "evil.example/x?", port: 8000, name: "sneaky-a" },
      { ...base, host: "a@evil.example", port: 8000, name: "sneaky-b" },
      { ...base, host: "192.168.16.204", port: 8000, name: "home-imac" },
    ]);
    await scanThree();
    expect(screen.getByRole("button", { name: "Connect to home-imac (opens in a new tab)" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Connect to sneaky/ })).toBeNull();
  });

  it("a local row offers no Connect", async () => {
    await scanThree();
    expect(screen.getAllByTestId("discovery-connect")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /Connect to robson-mbp/ })).toBeNull();
  });

  it("Connect sits before Add in its row and keeps the 32 px small-button recipe", async () => {
    await scanThree();
    const connect = screen.getByRole("button", { name: "Connect to home-imac (opens in a new tab)" });
    const add = screen.getByRole("button", { name: "Add home-imac (192.168.16.204:8000)" });
    expect(connect.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(connect.className).toContain("min-h-[32px]");
    expect(connect.textContent).toBe("Connect");
    expect(connect.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("Connect stays available on an already-added remote row, before 'Already added'", async () => {
    discoverServers.mockResolvedValue([{ ...base, host: "192.168.16.204", port: 8000, name: "home-imac" }]);
    render(
      <NetworkDiscoverySection
        knownServers={[{ host: "192.168.16.204", port: 8000, addedAt: "2026-01-01T00:00:00Z" }]}
        onServerAdded={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("Scan network"));
    const connect = await screen.findByRole("button", { name: "Connect to home-imac (opens in a new tab)" });
    const known = screen.getByText("Already added");
    expect(connect.compareDocumentPosition(known) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("actions wrap below the name on narrow widths (name block has a basis, actions wrap)", async () => {
    await scanThree();
    const connect = screen.getByRole("button", { name: "Connect to home-imac (opens in a new tab)" });
    expect(connect.parentElement?.className).toContain("flex-wrap");
    const main = screen.getByText("home-imac").closest("div.min-w-0");
    expect(main?.className).toContain("flex-[1_1_12rem]");
  });
});
