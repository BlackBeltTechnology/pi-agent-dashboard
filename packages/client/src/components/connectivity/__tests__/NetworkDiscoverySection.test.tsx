/**
 * Network discovery as a source of the merged Servers section: scan button, live region, scan error,
 * empty diagnostic + manual add, results joining identity cards, Add / Already added, Request access.
 *
 * Lineage: #E25 (stabilize-mdns-server-identity), #E11 #E12 #F11 #X5 #X6 (retro-ux-identity-connectivity),
 * #E27 (add-lan-knock-pairing), #F6 (group-servers-by-identity — merged list).
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KnownServersSection } from "../KnownServersSection.js";

const { listKnownServersWithAccess, discoverServers, addKnownServer, check } = vi.hoisted(() => ({
  listKnownServersWithAccess: vi.fn(),
  discoverServers: vi.fn(),
  addKnownServer: vi.fn(),
  check: vi.fn(),
}));

vi.mock("../../../lib/api/known-servers-api.js", () => ({
  listKnownServersWithAccess,
  discoverServers,
  addKnownServer,
  acceptKnownServerMove: vi.fn(),
  removeKnownServer: vi.fn(),
  probeKnownServer: vi.fn().mockResolvedValue(null),
}));
vi.mock("../../../lib/server-route-check.js", async (orig) => ({
  ...(await orig<typeof import("../../../lib/server-route-check.js")>()),
  createRouteChecker: () => ({ check }),
}));

const F = `sha256:${"F".repeat(43)}`;
const G = `sha256:${"G".repeat(43)}`;
const base = { piPort: 9999, version: "0.9.0", pid: 1, isLocal: false };
const saved = (host: string, extra: Record<string, unknown> = {}) => ({
  host,
  port: 8000,
  addedAt: "2026-01-01T00:00:00Z",
  routes: [{ host, port: 8000, scheme: "http", source: "saved" }],
  ...extra,
});
const KNOWN = [saved("old.local", { fingerprint: F })];

const mountWith = (known: unknown[] = KNOWN, canManage = true) => {
  listKnownServersWithAccess.mockResolvedValue({ servers: known, canManage });
  const view = render(<KnownServersSection />);
  return view;
};
const scan = async () => {
  fireEvent.click(await screen.findByText("Scan network"));
};

beforeEach(() => {
  listKnownServersWithAccess.mockReset().mockResolvedValue({ servers: KNOWN, canManage: true });
  discoverServers.mockReset().mockResolvedValue([
    { ...base, host: "new.local", port: 8000, fingerprint: F },
    { ...base, host: "old.local", port: 8000 },
    { ...base, host: "studio.local", port: 8000, fingerprint: G, name: "Studio" },
  ]);
  addKnownServer.mockReset().mockResolvedValue({ updated: false });
  check.mockReset().mockImplementation(async (_r: unknown, expected?: string) => ({ kind: "proven", fingerprint: expected ?? F, latencyMs: 5, access: "ok" }));
});
afterEach(cleanup);

describe("#F6 merged Servers list", () => {
  it("a saved route and a discovered route proving one identity are ONE card with both routes", async () => {
    mountWith();
    await scan();
    await screen.findByText("Studio");
    const cards = screen.getAllByRole("article");
    // F: old.local (saved) + new.local (discovered); G: Studio; (old.local also discovered without fp → same saved route)
    expect(cards).toHaveLength(2);
    const fCard = cards.find((c) => c.getAttribute("data-fingerprint") === F)!;
    expect(within(fCard).getAllByTestId("route-row").map((r) => r.textContent)).toEqual([
      expect.stringContaining("old.local:8000"),
      expect.stringContaining("new.local:8000"),
    ]);
  });

  it("a discovered server that advertises no fingerprint is its own card: 'identity not advertised'", async () => {
    mountWith([]);
    discoverServers.mockResolvedValue([{ ...base, host: "mystery.local", port: 8000 }]);
    await scan();
    const card = await screen.findByRole("article", { name: "mystery.local:8000" });
    expect(card.textContent).toContain("identity not advertised");
  });

  it("shows 'Already added' for a host:port match and for a fingerprint + port match; Add otherwise", async () => {
    mountWith();
    await scan();
    await screen.findByText("Studio");
    expect(screen.getAllByText("Already added")).toHaveLength(2); // old.local (host:port) and new.local (F + 8000)
    expect(screen.getAllByRole("button", { name: /^Add .+ \(.+\)$/ })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Add Studio (studio.local:8000)" })).toBeTruthy();
  });

  it("the Servers section holds no separate 'Network Discovery' list or heading", async () => {
    mountWith();
    await scan();
    await screen.findByText("Studio");
    expect(screen.queryByText("Network Discovery")).toBeNull();
    expect(screen.queryByText("Known Servers")).toBeNull();
  });

  it("a local discovered server is a Local card with no pair action; a remote one offers Request access", async () => {
    mountWith([]);
    discoverServers.mockResolvedValue([
      { ...base, host: "192.168.16.204", port: 8000, name: "home-imac", fingerprint: F },
      { ...base, host: "robson-mbp.local", port: 8000, name: "robson-mbp", isLocal: true, fingerprint: G },
    ]);
    await scan();
    const remote = await screen.findByRole("article", { name: "home-imac" });
    const local = screen.getByRole("article", { name: "robson-mbp" });
    expect(within(remote).getByText("Remote")).toBeTruthy();
    expect(within(local).getByText("Local")).toBeTruthy();
    expect(within(remote).getByTestId("pair-action")).toBeTruthy();
    expect(within(local).queryByTestId("pair-action")).toBeNull();
  });

  it("the polite live region reads Scanning… then Found 2 dashboards. (#F11)", async () => {
    let resolve!: (v: unknown[]) => void;
    discoverServers.mockReset().mockReturnValue(new Promise((r) => { resolve = r; }));
    mountWith([]);
    await screen.findByText("Scan network");
    const region = () => document.querySelector('[aria-live="polite"]')!;
    expect(region()).toBeTruthy();
    await scan();
    await waitFor(() => expect(region().textContent).toBe("Scanning…"));
    resolve([
      { ...base, host: "a.local", port: 8000 },
      { ...base, host: "b.local", port: 8000 },
    ]);
    await waitFor(() => expect(region().textContent).toBe("Found 2 dashboards."));
  });
});

describe("#E25 Add a discovered server", () => {
  it("prefills the advertised name and sends the fingerprint hint", async () => {
    mountWith();
    await scan();
    fireEvent.click(await screen.findByRole("button", { name: "Add Studio (studio.local:8000)" }));
    expect((screen.getByPlaceholderText("Label") as HTMLInputElement).value).toBe("Studio");
    fireEvent.click(screen.getByRole("button", { name: "Add Studio" }));
    await waitFor(() => expect(addKnownServer).toHaveBeenCalledWith("studio.local", 8000, "Studio", G));
    expect(listKnownServersWithAccess).toHaveBeenCalledTimes(2); // the parent list is re-read
  });

  it("reports that an existing entry was updated", async () => {
    addKnownServer.mockResolvedValue({ updated: true });
    mountWith();
    await scan();
    fireEvent.click(await screen.findByRole("button", { name: "Add Studio (studio.local:8000)" }));
    fireEvent.click(screen.getByRole("button", { name: "Add Studio" }));
    await waitFor(() => expect(screen.getByText(/updated existing entry/i)).toBeTruthy());
  });

  it("X6: a failed add-confirm reports next to the server and never shows Already added for it", async () => {
    mountWith([]);
    discoverServers.mockResolvedValue([{ ...base, host: "new.local", port: 8000 }]);
    addKnownServer.mockRejectedValue(new Error("403"));
    await scan();
    fireEvent.click(await screen.findByRole("button", { name: /^Add new\.local/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add new.local" }));
    expect((await screen.findByRole("alert")).textContent).toContain("403");
    expect(screen.queryByText("Already added")).toBeNull();
  });

  it("a read-only viewer sees discovered servers without an Add control", async () => {
    mountWith(KNOWN, false);
    await scan();
    await screen.findByText("Studio");
    expect(screen.queryByRole("button", { name: /^Add .+ \(.+\)$/ })).toBeNull();
  });
});

describe("empty scan and failed scan", () => {
  const renderEmpty = async (known: unknown[] = []) => {
    discoverServers.mockReset().mockResolvedValue([]);
    mountWith(known);
    await scan();
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
    await renderEmpty([saved("192.168.16.202")]);
    const input = screen.getByLabelText("Address") as HTMLInputElement;
    const submit = () => fireEvent.click(screen.getByRole("button", { name: "Add server" }));
    const described = () => document.getElementById(input.getAttribute("aria-describedby")!)?.textContent;

    fireEvent.change(input, { target: { value: "[::1" } });
    submit();
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(described()).toMatch(/Enter a host like 192\.168\.1\.42:8000/);
    expect(addKnownServer).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "192.168.16.202:8000" } });
    submit();
    expect(described()).toContain("192.168.16.202:8000");
    expect(described()).toMatch(/already added/);
    expect(addKnownServer).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "http://lab-mini.local:8000" } });
    submit();
    await waitFor(() => expect(addKnownServer).toHaveBeenCalledTimes(1));
    expect(addKnownServer).toHaveBeenCalledWith("lab-mini.local", 8000, undefined);
    await waitFor(() => expect(input.value).toBe(""));
  });

  it("E12: an https address in the diagnostic form posts https on 443", async () => {
    await renderEmpty();
    fireEvent.change(screen.getByLabelText("Address"), { target: { value: "https://lab.example.org" } });
    fireEvent.click(screen.getByRole("button", { name: "Add server" }));
    await waitFor(() => expect(addKnownServer).toHaveBeenCalledWith("lab.example.org", 443, undefined, undefined, "https"));
  });

  it("X5: a failed scan shows a severity-error callout with Retry, and the empty diagnostic too", async () => {
    discoverServers.mockReset().mockRejectedValueOnce(new Error("connection refused")).mockResolvedValue([]);
    mountWith([]);
    await scan();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Scan failed: connection refused");
    expect(alert.className).toContain("--severity-error");
    expect(screen.getByText(/No dashboards found via mDNS/)).toBeTruthy();
    fireEvent.click(screen.getByText("Retry"));
    await waitFor(() => expect(discoverServers).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });
});

describe("#E27 Request access (browser)", () => {
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
  afterEach(() => vi.unstubAllGlobals());

  const scanThree = async (known: unknown[] = []) => {
    mountWith(known);
    await scan();
    await screen.findByRole("article", { name: "home-imac" });
  };

  it("a remote IPv4 card opens its /pair?request in a new context with noopener", async () => {
    await scanThree();
    fireEvent.click(screen.getByRole("button", { name: "Request access… home-imac (opens in a new tab)" }));
    expect(open).toHaveBeenCalledWith("http://192.168.16.204:8000/pair?request", "_blank", "noopener");
  });

  it("a remote IPv6 literal is bracketed in the opened URL", async () => {
    await scanThree();
    fireEvent.click(screen.getByRole("button", { name: "Request access… fd12::4:8000 (opens in a new tab)" }));
    expect(open).toHaveBeenCalledWith("http://[fd12::4]:8000/pair?request", "_blank", "noopener");
  });

  it("a hostile advertised host offers no action (the URL must round-trip to the advertised host)", async () => {
    discoverServers.mockResolvedValue([
      { ...base, host: "evil.example/x?", port: 8000, name: "sneaky-a" },
      { ...base, host: "a@evil.example", port: 8000, name: "sneaky-b" },
      { ...base, host: "192.168.16.204", port: 8000, name: "home-imac" },
    ]);
    await scanThree();
    expect(screen.getByRole("button", { name: /Request access… home-imac/ })).toBeTruthy();
    expect(within(screen.getByRole("article", { name: "sneaky-a" })).queryByTestId("pair-action")).toBeNull();
    expect(within(screen.getByRole("article", { name: "sneaky-b" })).queryByTestId("pair-action")).toBeNull();
  });

  it("a local card offers no Request access", async () => {
    await scanThree();
    expect(screen.getAllByTestId("pair-action")).toHaveLength(2);
    expect(within(screen.getByRole("article", { name: "robson-mbp" })).queryByTestId("pair-action")).toBeNull();
  });

  it("a saved on-link route that is not discovered offers the same action", async () => {
    discoverServers.mockResolvedValue([]);
    mountWith([saved("192.168.16.77", { label: "studio-mbp" })]);
    fireEvent.click(await screen.findByRole("button", { name: /^Request access… studio-mbp/ }));
    expect(open).toHaveBeenCalledWith("http://192.168.16.77:8000/pair?request", "_blank", "noopener");
  });

  it("sits before the remove control in its card and keeps the 32 px small-button recipe", async () => {
    await scanThree();
    const action = screen.getByRole("button", { name: "Request access… home-imac (opens in a new tab)" });
    expect(action.className).toContain("min-h-[32px]");
    expect(action.textContent).toBe("Request access…");
    expect(action.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(action.parentElement?.className).toContain("flex-wrap");
  });
});
