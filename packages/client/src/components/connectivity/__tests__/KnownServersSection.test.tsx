/**
 * Settings ▸ Servers (the merged section): cards by identity, route table, refused route, operator-only
 * controls, two-step removes, load / remove / move failures.
 *
 * Lineage: #E26 (stabilize-mdns-server-identity), #E5 #E6 #F10 #X1–#X3 (retro-ux-identity-connectivity),
 * #F7 (group-servers-by-identity — error and mutation paths).
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KnownServersSection } from "../KnownServersSection.js";

const { listKnownServersWithAccess, acceptKnownServerMove, addKnownServer, removeKnownServer, discoverServers, probeKnownServer, check } = vi.hoisted(() => ({
  listKnownServersWithAccess: vi.fn(),
  acceptKnownServerMove: vi.fn(),
  addKnownServer: vi.fn(),
  removeKnownServer: vi.fn(),
  discoverServers: vi.fn(),
  probeKnownServer: vi.fn(),
  check: vi.fn(),
}));

vi.mock("../../../lib/api/known-servers-api.js", () => ({
  listKnownServersWithAccess,
  acceptKnownServerMove,
  addKnownServer,
  removeKnownServer,
  discoverServers,
  probeKnownServer,
}));
vi.mock("../../../lib/server-route-check.js", async (orig) => ({
  ...(await orig<typeof import("../../../lib/server-route-check.js")>()),
  createRouteChecker: () => ({ check }),
}));

const F = `sha256:${"A".repeat(43)}`;
const G = `sha256:${"G".repeat(43)}`;
const route = (host: string, port = 8000, scheme: "http" | "https" = "http", source: "saved" | "mdns" | "pairing" = "saved") => ({ host, port, scheme, source });
const entry = (host: string, extra: Record<string, unknown> = {}) => ({
  host,
  port: 8000,
  addedAt: "2026-01-01T00:00:00Z",
  routes: [route(host)],
  ...extra,
});

const ENTRY = entry("home-imac-75112.local", { label: "iMac", movedTo: { host: "192.168.16.220", port: 8000 } });
const PINNED = entry("office-mac.local", { label: "office-mac", fingerprint: F });
const PLAIN = entry("192.168.16.202");

beforeEach(() => {
  listKnownServersWithAccess.mockReset();
  acceptKnownServerMove.mockReset().mockResolvedValue(true);
  removeKnownServer.mockReset().mockResolvedValue(undefined);
  addKnownServer.mockReset().mockResolvedValue({ updated: false });
  discoverServers.mockReset().mockResolvedValue([]);
  probeKnownServer.mockReset().mockResolvedValue(null);
  check.mockReset().mockImplementation(async (_r: unknown, expected?: string) => ({ kind: "proven", fingerprint: expected ?? F, latencyMs: 5, access: "ok" }));
});
afterEach(cleanup);

describe("Servers section (#E26)", () => {
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
    expect(screen.getByRole("button", { name: "Remove iMac (home-imac-75112.local:8000)" })).toBeTruthy();
    expect(screen.getByText("Add server manually")).toBeTruthy();
    fireEvent.click(screen.getByText("Update"));
    await waitFor(() => expect(acceptKnownServerMove).toHaveBeenCalledWith("home-imac-75112.local", 8000));
  });
});

describe("Servers section retro-ux", () => {
  it.each([true, false])("E5: only the pinned entry shows one Verified pill (canManage %s)", async (canManage) => {
    listKnownServersWithAccess.mockResolvedValue({ servers: [PINNED, PLAIN], canManage });
    render(<KnownServersSection />);
    await screen.findByText("office-mac");
    const pills = screen.getAllByText("Verified");
    expect(pills).toHaveLength(1);
    const described = document.getElementById(pills[0].closest("[aria-describedby]")!.getAttribute("aria-describedby")!);
    expect(described?.textContent).toMatch(/verified when this server was added/i);
    expect(pills[0].closest("article")?.textContent).toContain("office-mac");
  });

  it("E6: read-only viewer — no mutation controls, a note says why, moved-to still shown", async () => {
    listKnownServersWithAccess.mockResolvedValue({ servers: [ENTRY, PLAIN], canManage: false });
    render(<KnownServersSection />);
    await screen.findByText("iMac");
    // scan and Request access change nothing on this dashboard and stay; every add / remove / update control is gone
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Request access…", "Request access…", "Scan network"]);
    expect(screen.queryByRole("button", { name: /Remove|Add|Update/ })).toBeNull();
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

// group-servers-by-identity
const HOME = entry("192.168.16.204", {
  label: "home-imac",
  fingerprint: F,
  routes: [route("192.168.16.204"), route("home-imac.local"), route("home-imac-0a1b.share.zrok.io", 443, "https", "pairing")],
});

describe("Servers section — identity cards (#F7)", () => {
  it("one card per identity with its route table: kind, address, identity state, latency, learned from", async () => {
    listKnownServersWithAccess.mockResolvedValue({ servers: [HOME, PLAIN], canManage: true });
    render(<KnownServersSection />);
    const card = await screen.findByRole("article", { name: "home-imac" });
    expect(screen.getAllByRole("article")).toHaveLength(2);
    const rows = within(card).getAllByTestId("route-row");
    expect(rows).toHaveLength(3);
    await waitFor(() => expect(within(card).getAllByText("Identity proven")).toHaveLength(3));
    expect(rows[0].textContent).toContain("http://192.168.16.204:8000");
    expect(rows[0].textContent).toContain("5 ms");
    expect(rows[0].textContent).toContain("Local network");
    expect(rows[1].textContent).toContain("mDNS name");
    expect(rows[2].textContent).toContain("https://home-imac-0a1b.share.zrok.io:443");
    expect(rows[2].textContent).toContain("Tunnel (zrok)");
    expect(rows[2].textContent).toContain("Pairing");
    // every route was proven against the card's fingerprint
    expect(check).toHaveBeenCalledWith(expect.objectContaining({ host: "home-imac.local" }), F);
    expect(within(card).getByText(F.slice(0, 7 + 16))).toBeTruthy();
    expect(within(card).getByText(/3 addresses/)).toBeTruthy();
  });

  it("a server with no fingerprint says 'identity not advertised'", async () => {
    listKnownServersWithAccess.mockResolvedValue({ servers: [PLAIN], canManage: true });
    render(<KnownServersSection />);
    expect((await screen.findByRole("article")).textContent).toContain("identity not advertised");
  });

  it("a refused route shows 'Different identity' + the proven fingerprint, a callout says it is never used, the others stay usable", async () => {
    listKnownServersWithAccess.mockResolvedValue({ servers: [HOME], canManage: true });
    check.mockImplementation(async (r: { host: string }, expected?: string) =>
      r.host === "home-imac.local"
        ? { kind: "different-identity", fingerprint: G }
        : { kind: "proven", fingerprint: expected, latencyMs: r.host === "192.168.16.204" ? 4 : 60, access: "ok" },
    );
    render(<KnownServersSection />);
    const card = await screen.findByRole("article", { name: "home-imac" });
    await waitFor(() => expect(within(card).getAllByTestId("route-row")[1].getAttribute("data-refused")).toBe("true"));
    const refusedRow = within(card).getAllByTestId("route-row")[1];
    expect(refusedRow.textContent).toContain("Different identity");
    expect(refusedRow.textContent).toContain(G.slice(0, 7 + 16));
    expect(card.textContent).toMatch(/never used and no credential is sent there/);
    expect(card.textContent).toContain("1 address refused");
    // the other routes are proven, and the fastest is the one in use
    expect(within(card).getAllByText("Identity proven")).toHaveLength(2);
    expect(within(within(card).getAllByTestId("route-row")[0]).getByText("used")).toBeTruthy();
  });

  it("a route that cannot prove identity says so and is not marked used", async () => {
    listKnownServersWithAccess.mockResolvedValue({ servers: [PLAIN], canManage: true });
    check.mockResolvedValue({ kind: "cant-prove" });
    render(<KnownServersSection />);
    const row = (await screen.findAllByTestId("route-row"))[0];
    await waitFor(() => expect(row.textContent).toContain("Can't prove identity"));
    expect(within(row).queryByText("used")).toBeNull();
  });

  it("a single route can be removed (two steps) and the card stays while it has routes", async () => {
    listKnownServersWithAccess.mockResolvedValueOnce({ servers: [HOME], canManage: true }).mockResolvedValue({
      servers: [{ ...HOME, routes: HOME.routes.slice(1) }],
      canManage: true,
    });
    render(<KnownServersSection />);
    await screen.findByRole("article", { name: "home-imac" });
    fireEvent.click(screen.getByRole("button", { name: "Remove address 192.168.16.204:8000 of home-imac" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(removeKnownServer).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Remove address 192.168.16.204:8000 of home-imac" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm remove address 192.168.16.204:8000 of home-imac" }));
    await waitFor(() => expect(removeKnownServer).toHaveBeenCalledTimes(1));
    expect(removeKnownServer).toHaveBeenCalledWith("192.168.16.204", 8000);
    await waitFor(() => expect(screen.queryByText("192.168.16.204:8000", { exact: false })).toBeNull());
    expect(screen.getByRole("article", { name: "home-imac" })).toBeTruthy();
  });

  it("removing a whole server removes every saved route; an https route names its scheme", async () => {
    listKnownServersWithAccess.mockResolvedValueOnce({ servers: [HOME], canManage: true }).mockResolvedValue({ servers: [], canManage: true });
    render(<KnownServersSection />);
    await screen.findByRole("article", { name: "home-imac" });
    fireEvent.click(screen.getByRole("button", { name: "Remove home-imac and all its saved addresses" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm remove home-imac and all its saved addresses" }));
    await waitFor(() => expect(removeKnownServer).toHaveBeenCalledTimes(3));
    expect(removeKnownServer.mock.calls).toEqual([
      ["192.168.16.204", 8000],
      ["home-imac.local", 8000],
      ["home-imac-0a1b.share.zrok.io", 443, "https"],
    ]);
  });

  it("a failed single-route remove keeps the route and reports next to it", async () => {
    listKnownServersWithAccess.mockResolvedValue({ servers: [HOME], canManage: true });
    removeKnownServer.mockRejectedValue(new Error("403"));
    render(<KnownServersSection />);
    await screen.findByRole("article", { name: "home-imac" });
    fireEvent.click(screen.getByRole("button", { name: "Remove address home-imac.local:8000 of home-imac" }));
    fireEvent.click(screen.getByRole("button", { name: /^Confirm remove address home-imac\.local/ }));
    const row = (await screen.findAllByTestId("route-row"))[1];
    await waitFor(() => expect(within(row).getByRole("alert").textContent).toContain("403"));
    expect(row.textContent).toContain("home-imac.local");
  });

  it("the empty list says no remote servers saved (not after a failed load)", async () => {
    listKnownServersWithAccess.mockResolvedValue({ servers: [], canManage: true });
    render(<KnownServersSection />);
    expect(await screen.findByText(/No remote servers saved/)).toBeTruthy();
  });
});

describe("Servers section — manual add (#F7)", () => {
  const open = async () => {
    listKnownServersWithAccess.mockResolvedValue({ servers: [entry("192.168.16.202")], canManage: true });
    render(<KnownServersSection />);
    await screen.findByRole("article");
    fireEvent.click(screen.getByText("Add server manually"));
    return screen.getByLabelText("Address") as HTMLInputElement;
  };
  const submit = () => fireEvent.click(screen.getByRole("button", { name: "Add server" }));
  const described = (input: HTMLElement) => document.getElementById(input.getAttribute("aria-describedby")!)?.textContent;

  it("invalid input → aria-invalid + described error, no POST", async () => {
    const input = await open();
    fireEvent.change(input, { target: { value: "[::1" } });
    submit();
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(described(input)).toMatch(/Enter a host like 192\.168\.1\.42:8000/);
    expect(addKnownServer).not.toHaveBeenCalled();
  });

  it("a stored route → 'already added' naming the address, no POST", async () => {
    const input = await open();
    fireEvent.change(input, { target: { value: "192.168.16.202:8000" } });
    submit();
    expect(described(input)).toMatch(/192\.168\.16\.202:8000 is already added/);
    expect(addKnownServer).not.toHaveBeenCalled();
  });

  it("an https address posts host, port 443 and scheme https", async () => {
    const input = await open();
    fireEvent.change(input, { target: { value: "https://lab.example.org" } });
    submit();
    await waitFor(() => expect(addKnownServer).toHaveBeenCalledTimes(1));
    expect(addKnownServer).toHaveBeenCalledWith("lab.example.org", 443, undefined, undefined, "https");
    await waitFor(() => expect(screen.queryByLabelText("Address")).toBeNull()); // form closed, list reloaded
    expect(listKnownServersWithAccess).toHaveBeenCalledTimes(2);
  });

  it("an http address with a label posts host, default port and label; the form has Address, Port and Label", async () => {
    const input = await open();
    expect(screen.getByLabelText("Port (optional)")).toBeTruthy();
    fireEvent.change(input, { target: { value: "http://lab-mini.local:9000" } });
    fireEvent.change(screen.getByLabelText("Label (optional)"), { target: { value: "Lab" } });
    submit();
    await waitFor(() => expect(addKnownServer).toHaveBeenCalledWith("lab-mini.local", 9000, "Lab"));
  });

  it("Cancel closes the form without a request", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Address")).toBeNull();
    expect(addKnownServer).not.toHaveBeenCalled();
  });

  it("a pre-routes dashboard server is not offered an https add", async () => {
    listKnownServersWithAccess.mockResolvedValue({ servers: [{ host: "old.local", port: 8000, addedAt: "2026-01-01T00:00:00Z" }], canManage: true });
    render(<KnownServersSection />);
    await screen.findByRole("article");
    fireEvent.click(screen.getByText("Add server manually"));
    fireEvent.change(screen.getByLabelText("Address"), { target: { value: "https://lab.example.org" } });
    submit();
    expect(screen.getByRole("alert").textContent).toMatch(/too old to store https/);
    expect(addKnownServer).not.toHaveBeenCalled();
  });
});
