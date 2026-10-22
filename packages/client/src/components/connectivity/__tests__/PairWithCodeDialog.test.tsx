/**
 * The two pair dialogs of Settings ▸ Servers, driven through the section:
 *  - browser "Pair with code…" — local refusal before any navigation, noopener open at the payload's origin;
 *  - Electron "Verify and request access…" — full fingerprint compare before any request, knock refusal copy,
 *    "Pair with code instead" on `knock_not_lan`; a browser never shows a fingerprint compare.
 * See change: group-servers-by-identity (test-plan #F8; tasks 7.3, 7.4).
 */
import { KNOCK_REFUSAL_COPY } from "@blackbelt-technology/pi-dashboard-shared/pairing-knock.js";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodePayloadString } from "../../../lib/pairing/pairing-qr.js";
import { KnownServersSection } from "../KnownServersSection.js";

const { listKnownServersWithAccess, discoverServers, check, challengeIdentity } = vi.hoisted(() => ({
  listKnownServersWithAccess: vi.fn(),
  discoverServers: vi.fn(),
  check: vi.fn(),
  challengeIdentity: vi.fn(),
}));

vi.mock("../../../lib/api/known-servers-api.js", () => ({
  listKnownServersWithAccess,
  discoverServers,
  addKnownServer: vi.fn(),
  acceptKnownServerMove: vi.fn(),
  removeKnownServer: vi.fn(),
  probeKnownServer: vi.fn().mockResolvedValue(null),
}));
vi.mock("../../../lib/server-route-check.js", async (orig) => ({
  ...(await orig<typeof import("../../../lib/server-route-check.js")>()),
  createRouteChecker: () => ({ check }),
}));
vi.mock("../../../lib/pairing/pair-protocol.js", async (orig) => ({
  ...(await orig<typeof import("../../../lib/pairing/pair-protocol.js")>()),
  canProveIdentity: () => true,
  challengeIdentity,
}));

const BUILD = `sha256:${"B".repeat(43)}`;
const OTHER = `sha256:${"G".repeat(43)}`;
const H = `sha256:${"H".repeat(43)}`;
const base = { piPort: 9999, version: "0.9.0", pid: 1, isLocal: false };
const tunnelOnly = {
  host: "b0x7.share.zrok.io",
  port: 443,
  label: "build-box",
  fingerprint: BUILD,
  addedAt: "2026-01-01T00:00:00Z",
  routes: [{ host: "b0x7.share.zrok.io", port: 443, scheme: "https", source: "pairing" }],
};
const textFor = (id: string, urls: string[]) => encodePayloadString({ v: 1, id, code: "one-time", urls });

let open: ReturnType<typeof vi.fn>;
let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  open = vi.fn();
  fetchSpy = vi.fn();
  vi.stubGlobal("open", open);
  vi.stubGlobal("fetch", fetchSpy);
  listKnownServersWithAccess.mockReset().mockResolvedValue({ servers: [tunnelOnly], canManage: true });
  discoverServers.mockReset().mockResolvedValue([]);
  check.mockReset().mockImplementation(async (_r: unknown, expected?: string) => ({ kind: "proven", fingerprint: expected ?? BUILD, latencyMs: 5, access: "ok" }));
  challengeIdentity.mockReset().mockResolvedValue({ fingerprint: H, publicKey: "k", verified: true });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete (window as unknown as { piDashboard?: unknown }).piDashboard;
});

describe("#F8 browser Pair with code…", () => {
  const openDialog = async () => {
    render(<KnownServersSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Pair with code… build-box" }));
    return screen.findByRole("dialog");
  };
  const paste = (dialog: HTMLElement, text: string) => {
    fireEvent.change(within(dialog).getByLabelText("Pairing text"), { target: { value: text } });
    fireEvent.click(within(dialog).getByTestId("pair-with-code-submit"));
  };

  it("a tunnel-only server offers 'Pair with code…' and not 'Request access…'", async () => {
    render(<KnownServersSection />);
    await screen.findByRole("button", { name: "Pair with code… build-box" });
    expect(screen.queryByRole("button", { name: /Request access/ })).toBeNull();
  });

  it("text for another server is refused: refusal copy, no window.open, no fetch", async () => {
    const dialog = await openDialog();
    paste(dialog, textFor(OTHER, ["https://b0x7.share.zrok.io"]));
    expect((await within(dialog).findByRole("alert")).textContent).toMatch(/different server than build-box/);
    expect(within(dialog).getByLabelText("Pairing text").getAttribute("aria-invalid")).toBe("true");
    expect(open).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("valid text opens <origin>/pair#<payload> with noopener — and nothing is sent first", async () => {
    const dialog = await openDialog();
    const text = textFor(BUILD, ["https://b0x7.share.zrok.io"]);
    expect(open).not.toHaveBeenCalled(); // no navigation before the local check
    paste(dialog, text);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(`https://b0x7.share.zrok.io/pair#${text}`, "_blank", "noopener,noreferrer");
    expect(fetchSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it.each([
    ["only wss urls", ["wss://b0x7.share.zrok.io"]],
    ["userinfo", ["https://u:p@b0x7.share.zrok.io"]],
    ["a path", ["https://b0x7.share.zrok.io/x"]],
    ["an IP literal", ["https://10.0.0.5"]],
  ])("a payload with no valid https origin (%s) is refused", async (_n, urls) => {
    const dialog = await openDialog();
    paste(dialog, textFor(BUILD, urls));
    expect((await within(dialog).findByRole("alert")).textContent).toMatch(/no usable https address/);
    expect(open).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("an invalid first https url and a valid second opens the second origin", async () => {
    const dialog = await openDialog();
    paste(dialog, textFor(BUILD, ["https://10.0.0.5", "https://b0x7.share.zrok.io"]));
    expect(open.mock.calls[0][0]).toMatch(/^https:\/\/b0x7\.share\.zrok\.io\/pair#/);
  });

  it("Cancel closes without opening anything", async () => {
    const dialog = await openDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(open).not.toHaveBeenCalled();
  });

  it("a browser shows no fingerprint comparison for a discovered server that advertises no identity", async () => {
    listKnownServersWithAccess.mockResolvedValue({ servers: [], canManage: true });
    discoverServers.mockResolvedValue([{ ...base, host: "192.168.16.80", port: 8000, name: "old-nas" }]);
    render(<KnownServersSection />);
    fireEvent.click(await screen.findByText("Scan network"));
    fireEvent.click(await screen.findByRole("button", { name: "Request access… old-nas (opens in a new tab)" }));
    expect(open).toHaveBeenCalledWith("http://192.168.16.80:8000/pair?request", "_blank", "noopener,noreferrer");
    expect(screen.queryByTestId("verify-fingerprint")).toBeNull();
    expect(screen.queryByRole("button", { name: /Verify and request/ })).toBeNull();
    expect(challengeIdentity).not.toHaveBeenCalled();
  });
});

describe("#F8 Electron", () => {
  let openServerWindow: ReturnType<typeof vi.fn>;
  let pairWithCode: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    openServerWindow = vi.fn().mockResolvedValue({ ok: true });
    pairWithCode = vi.fn().mockResolvedValue({ ok: true });
    (window as unknown as { piDashboard: unknown }).piDashboard = {
      openServerWindow,
      pairWithCode,
      listServers: vi.fn().mockResolvedValue({ paired: [], discovered: [] }),
    };
    listKnownServersWithAccess.mockResolvedValue({ servers: [], canManage: true });
  });

  const scanOne = async (extra: Record<string, unknown> = {}) => {
    discoverServers.mockResolvedValue([{ ...base, host: "192.168.16.80", port: 8000, name: "old-nas", ...extra }]);
    render(<KnownServersSection />);
    fireEvent.click(await screen.findByText("Scan network"));
  };

  it("'Verify and request access…' shows the proven fingerprint in full and sends nothing until the user confirms", async () => {
    await scanOne();
    fireEvent.click(await screen.findByRole("button", { name: "Verify and request access… old-nas" }));
    const fp = await screen.findByTestId("verify-fingerprint");
    expect(fp.textContent).toBe(H);
    expect(fp.textContent).toHaveLength("sha256:".length + 43);
    expect(challengeIdentity).toHaveBeenCalledWith("http://192.168.16.80:8000");
    expect(openServerWindow).not.toHaveBeenCalled(); // no knock until confirmed
    fireEvent.click(screen.getByTestId("verify-confirm"));
    await waitFor(() => expect(openServerWindow).toHaveBeenCalledWith({ host: "192.168.16.80", port: 8000 }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("Cancel never sends a request", async () => {
    await scanOne();
    fireEvent.click(await screen.findByRole("button", { name: "Verify and request access… old-nas" }));
    await screen.findByTestId("verify-fingerprint");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(openServerWindow).not.toHaveBeenCalled();
  });

  it("a server that does not prove its identity is never asked", async () => {
    challengeIdentity.mockRejectedValue(new Error("no proof"));
    await scanOne();
    fireEvent.click(await screen.findByRole("button", { name: "Verify and request access… old-nas" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/did not prove who it is/);
    expect(screen.queryByTestId("verify-confirm")).toBeNull();
    expect(openServerWindow).not.toHaveBeenCalled();
  });

  it.each(["knock_disabled", "knock_not_lan", "knock_pending", "knock_busy", "knock_rate_limited"])(
    "a refused request (%s) keeps its request-landing meaning in the dialog",
    async (code) => {
      openServerWindow.mockResolvedValue({ ok: false, reason: code });
      await scanOne();
      fireEvent.click(await screen.findByRole("button", { name: "Verify and request access… old-nas" }));
      await screen.findByTestId("verify-fingerprint");
      fireEvent.click(screen.getByTestId("verify-confirm"));
      const alert = await screen.findByRole("alert");
      const meaning = KNOCK_REFUSAL_COPY[code].fallback.replace("{time}", "a few minutes");
      expect(alert.textContent).toContain(meaning);
    },
  );

  it("a discovered server with an identity offers 'Request access…' that starts the app's request (host + port only)", async () => {
    await scanOne({ fingerprint: H });
    fireEvent.click(await screen.findByRole("button", { name: "Request access… old-nas" }));
    await waitFor(() => expect(openServerWindow).toHaveBeenCalledWith({ host: "192.168.16.80", port: 8000 }));
    expect(screen.queryByTestId("verify-fingerprint")).toBeNull();
    expect(open).not.toHaveBeenCalled();
  });

  it("knock_not_lan on a server with an identity says so and offers 'Pair with code instead' → the app's code window", async () => {
    openServerWindow.mockResolvedValue({ ok: false, reason: "knock_not_lan" });
    await scanOne({ fingerprint: H });
    fireEvent.click(await screen.findByRole("button", { name: "Request access… old-nas" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(KNOCK_REFUSAL_COPY.knock_not_lan.fallback);
    fireEvent.click(within(alert).getByRole("button", { name: "Pair with code instead" }));
    await waitFor(() => expect(pairWithCode).toHaveBeenCalledWith({ fingerprint: H }));
  });

  it("a tunnel-only pinned server offers 'Pair with code…' → the app's window, never the in-page paste dialog", async () => {
    listKnownServersWithAccess.mockResolvedValue({ servers: [tunnelOnly], canManage: true });
    render(<KnownServersSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Pair with code… build-box" }));
    await waitFor(() => expect(pairWithCode).toHaveBeenCalledWith({ fingerprint: BUILD }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
