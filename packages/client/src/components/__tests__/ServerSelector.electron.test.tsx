/**
 * ServerSelector — Electron branch: open a server window instead of an in-page switch.
 * See change: add-electron-server-windows (test-plan E37, E38, E39),
 * group-servers-by-identity (test-plan #F5, #F9).
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listKnownServers } from "../../lib/api/known-servers-api.js";
import { getListServers } from "../../lib/electron-server-windows.js";
import { ServerSelector } from "../connectivity/ServerSelector.js";
import { identityMock } from "./selector-identity-mock.js";

vi.mock("../../lib/api/known-servers-api.js", () => ({
  listKnownServers: vi.fn(async () => [{ host: "192.168.16.204", port: 8000, label: "home-imac" }]),
  probeKnownServer: vi.fn(async () => null),
  acceptKnownServerMove: vi.fn(async () => true),
}));

// The identity proof is covered with real WebCrypto in lib/__tests__/server-route-check.test.ts;
// here an address proves the identity scripted in `identityMock` over the test's own fetch mock.
vi.mock("../../lib/pairing/pair-protocol.js", async (orig) =>
  (await import("./selector-identity-mock.js")).pairProtocolMock(await orig<typeof import("../../lib/pairing/pair-protocol.js")>()),
);


const openServerWindow = vi.fn();
let health: "ok" | "dead" | "denied" = "ok";

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  health = "ok";
  (globalThis as any).fetch = vi.fn((url: string) => {
    if (String(url).includes("localhost")) return Promise.reject(new Error("refused"));
    if (health === "dead") return Promise.reject(new Error("refused"));
    if (health === "denied") return Promise.resolve({ ok: false, status: 403, json: async () => ({ error: "network_not_allowed" }) } as Response);
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) } as Response);
  });
  openServerWindow.mockReset();
  openServerWindow.mockResolvedValue({ ok: true });
  (window as any).piDashboard = { openServerWindow };
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete (window as any).piDashboard;
});

async function openMenu(props: Partial<React.ComponentProps<typeof ServerSelector>> = {}) {
  const onSwitch = vi.fn();
  render(<ServerSelector currentHost="localhost" currentPort={8000} connected={true} onSwitch={onSwitch} {...props} />);
  await act(async () => {});
  fireEvent.click(screen.getByTestId("connection-chip"));
  await act(async () => {});
  return { onSwitch };
}
const entryButton = (text: string) => screen.getByText(text).closest("button") as HTMLButtonElement;

describe("Electron branch (E37)", () => {
  it("selecting an available remote opens its window with host+port only; no in-page switch, no last-server write", async () => {
    const { onSwitch } = await openMenu();
    await waitFor(() => expect(entryButton("192.168.16.204:8000").textContent).toMatch(/Available/));
    const sockets = vi.fn();
    vi.stubGlobal("WebSocket", sockets);
    fireEvent.click(entryButton("192.168.16.204:8000"));
    await act(async () => {});
    expect(openServerWindow).toHaveBeenCalledWith({ host: "192.168.16.204", port: 8000 });
    expect(onSwitch).not.toHaveBeenCalled();
    expect(sockets).not.toHaveBeenCalled();
    expect(localStorage.getItem("pi-dashboard-last-server")).toBeNull();
    vi.unstubAllGlobals();
  });

  it("the entry shows inline progress until the request resolves, then the menu closes", async () => {
    let resolve!: (v: { ok: true }) => void;
    openServerWindow.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    await openMenu();
    await waitFor(() => expect(entryButton("192.168.16.204:8000").textContent).toMatch(/Available/));
    fireEvent.click(entryButton("192.168.16.204:8000"));
    await act(async () => {});
    expect(entryButton("192.168.16.204:8000").textContent).toMatch(/Switching/);
    // a second click while in flight is ignored
    fireEvent.click(entryButton("192.168.16.204:8000"));
    expect(openServerWindow).toHaveBeenCalledTimes(1);
    await act(async () => resolve({ ok: true }));
    await waitFor(() => expect(screen.queryByText("192.168.16.204:8000")).toBeNull());
  });

  it("a failure is reported through onNotifyError with the reason and the entry label", async () => {
    openServerWindow.mockResolvedValueOnce({ ok: false, reason: "identity_mismatch" });
    const onNotifyError = vi.fn();
    await openMenu({ onNotifyError });
    await waitFor(() => expect(entryButton("192.168.16.204:8000").textContent).toMatch(/Available/));
    fireEvent.click(entryButton("192.168.16.204:8000"));
    await act(async () => {});
    await waitFor(() => expect(onNotifyError).toHaveBeenCalled());
    const msg = onNotifyError.mock.calls[0]![0] as string;
    expect(msg).toMatch(/identity/i);
    expect(msg).toContain("home-imac");
  });
});

describe("unavailable entries stay inert (E38)", () => {
  it.each([["dead"], ["denied"]] as const)("probe=%s: aria-disabled and the bridge is never called", async (mode) => {
    health = mode;
    await openMenu();
    await waitFor(() => expect(entryButton("192.168.16.204:8000").getAttribute("aria-disabled")).toBe("true"));
    fireEvent.click(entryButton("192.168.16.204:8000"));
    fireEvent.keyDown(entryButton("192.168.16.204:8000"), { key: "Enter" });
    await act(async () => {});
    expect(openServerWindow).not.toHaveBeenCalled();
  });

  it("still 'Checking…' (probe pending) is inert", async () => {
    (globalThis as any).fetch = vi.fn(() => new Promise(() => {}));
    await openMenu();
    const btn = entryButton("192.168.16.204:8000");
    // checking state is not 'blocked' for the in-page path, so the Electron branch must not fire before availability is known
    fireEvent.click(btn);
    await act(async () => {});
    expect(openServerWindow).not.toHaveBeenCalled();
  });
});

describe("local entry & absent capability (E39)", () => {
  it("(a) Local entry with capability: dropdown closes, no call, no switch", async () => {
    // current server is the remote, so the localhost row is a non-current Local entry
    const { onSwitch } = await openMenu({ currentHost: "192.168.16.204", currentPort: 8000 });
    // localhost probe is dead in this harness → make it available
    (globalThis as any).fetch = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) } as Response));
    fireEvent.click(screen.getByTestId("connection-chip")); // close
    fireEvent.click(screen.getByTestId("connection-chip")); // reopen → re-probe
    await act(async () => {});
    await waitFor(() => expect(entryButton("localhost:8000").textContent).toMatch(/Available/));
    fireEvent.click(entryButton("localhost:8000"));
    await act(async () => {});
    expect(openServerWindow).not.toHaveBeenCalled();
    expect(onSwitch).not.toHaveBeenCalled();
    expect(screen.queryByText("localhost:8000")).toBeNull(); // menu closed
  });

  it("(b) without the capability the in-page switch runs", async () => {
    delete (window as any).piDashboard;
    const { onSwitch } = await openMenu();
    await waitFor(() => expect(entryButton("192.168.16.204:8000").textContent).toMatch(/Available/));
    fireEvent.click(entryButton("192.168.16.204:8000"));
    expect(onSwitch).toHaveBeenCalledWith("192.168.16.204", 8000);
  });

  it("a remote-origin document (non-loopback page) never uses the capability", async () => {
    const orig = window.location;
    Object.defineProperty(window, "location", { value: { ...orig, hostname: "dash.example.lan", port: "8000", protocol: "http:" }, configurable: true });
    try {
      const { onSwitch } = await openMenu({ currentHost: "dash.example.lan", currentPort: 8000 });
      await waitFor(() => expect(entryButton("192.168.16.204:8000").textContent).toMatch(/Available/));
      fireEvent.click(entryButton("192.168.16.204:8000"));
      expect(onSwitch).toHaveBeenCalled();
      expect(openServerWindow).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, "location", { value: orig, configurable: true });
    }
  });
});

// ── group-servers-by-identity ─────────────────────────────────────────────────────────────────

const FP_HOME = "sha256:Ho0mE1mac0Ho0mE1mac0Ho0mE1mac0Ho0mE1mac0Ho0";
const FP_LAB = "sha256:La8Se4ver0La8Se4ver0La8Se4ver0La8Se4ver0La8";
const FP_STUDIO = "sha256:St0dI0mbp0St0dI0mbp0St0dI0mbp0St0dI0mbp0St0";
const BEARER = "BEARER-SENTINEL-do-not-render";
const ts = "2024-01-01T00:00:00Z";
const radios = () => screen.getAllByRole("menuitemradio", { hidden: true }) as HTMLButtonElement[];
const rowOf = (name: string) => radios().find((r) => r.textContent?.includes(name)) as HTMLButtonElement;
const pairedOf = (name: string) => rowOf(name).querySelector('[data-testid="paired-state"]')?.textContent;
const pairItem = (label: string) => screen.getByRole("menuitem", { name: label, hidden: true }) as HTMLButtonElement;

describe("Electron selection opens a window, never switches in-page (#F5)", () => {
  const SERVERS_STATE = {
    paired: [],
    discovered: [{ name: "studio-mbp", host: "192.168.16.77", port: 8000, fingerprint: FP_STUDIO, state: "not-paired" }],
  };
  beforeEach(() => {
    identityMock.reset();
    identityMock.proves.set("192.168.16.77", FP_STUDIO);
    openServerWindow.mockResolvedValue({ ok: true });
    (window as any).piDashboard = { openServerWindow, listServers: vi.fn(async () => SERVERS_STATE) };
    vi.mocked(listKnownServers).mockResolvedValue([
      { host: "192.168.16.204", port: 8000, label: "home-imac", addedAt: ts },
      { host: "dead.lan", port: 8000, label: "dead", addedAt: ts },
      { host: "guarded.lan", port: 8000, label: "guarded", addedAt: ts },
    ] as never);
    (globalThis as any).fetch = vi.fn((url: string) => {
      if (/localhost|dead\.lan/.test(String(url))) return Promise.reject(new TypeError("Failed to fetch"));
      if (String(url).includes("guarded.lan") && String(url).includes("/api/health")) {
        return Promise.resolve({ ok: false, status: 403, json: async () => ({ error: "network_not_allowed" }) } as Response);
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) } as Response);
    });
  });
  afterEach(() => {
    identityMock.reset();
    vi.mocked(listKnownServers).mockResolvedValue([{ host: "192.168.16.204", port: 8000, label: "home-imac" }] as never);
  });

  it("#F5 Enter/click on blocked rows calls nothing; the available row opens its window with the best route's host + port only", async () => {
    const sockets = vi.fn();
    vi.stubGlobal("WebSocket", sockets);
    const { onSwitch } = await openMenu();
    await waitFor(() => expect(rowOf("home-imac").textContent).toMatch(/Available/));
    await waitFor(() => expect(rowOf("dead").textContent).toMatch(/Unreachable/));
    await waitFor(() => expect(rowOf("guarded").textContent).toMatch(/Network not allowed/));
    for (const name of ["dead", "guarded"]) {
      expect(rowOf(name).getAttribute("aria-disabled")).toBe("true");
      fireEvent.keyDown(rowOf(name), { key: "Enter" });
      fireEvent.click(rowOf(name));
    }
    await act(async () => {});
    expect(openServerWindow).not.toHaveBeenCalled();

    fireEvent.click(rowOf("home-imac"));
    await act(async () => {});
    expect(openServerWindow).toHaveBeenCalledTimes(1);
    expect(openServerWindow).toHaveBeenCalledWith({ host: "192.168.16.204", port: 8000 }); // nothing else crosses the bridge
    expect(onSwitch).not.toHaveBeenCalled();
    expect(sockets).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
    vi.unstubAllGlobals();
  });

  it("#F5 the unpaired row's pair action is its own menuitem after the row and calls the bridge with the discovered route", async () => {
    const { onSwitch } = await openMenu();
    await waitFor(() => expect(rowOf("studio-mbp")).toBeTruthy());
    expect(pairedOf("studio-mbp")).toBe("Not paired");
    const items = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitemradio"], [role="menuitem"]'));
    const action = pairItem("Request access…");
    expect(action.getAttribute("role")).toBe("menuitem");
    expect(items.indexOf(action)).toBe(items.indexOf(rowOf("studio-mbp")) + 1);
    expect(openServerWindow).not.toHaveBeenCalled(); // listing the row asks the bridge for nothing
    fireEvent.click(action);
    await act(async () => {});
    expect(openServerWindow).toHaveBeenCalledTimes(1);
    expect(openServerWindow).toHaveBeenCalledWith({ host: "192.168.16.77", port: 8000 });
    expect(onSwitch).not.toHaveBeenCalled();
  });

  it("#F5 an identity mismatch reported by the app becomes a toast naming the server", async () => {
    openServerWindow.mockResolvedValueOnce({ ok: false, reason: "identity_mismatch" });
    const onNotifyError = vi.fn();
    await openMenu({ onNotifyError });
    await waitFor(() => expect(rowOf("home-imac").textContent).toMatch(/Available/));
    fireEvent.click(rowOf("home-imac"));
    await act(async () => {});
    await waitFor(() => expect(onNotifyError).toHaveBeenCalledTimes(1));
    expect(onNotifyError.mock.calls[0]![0]).toMatch(/identity/i);
    expect(onNotifyError.mock.calls[0]![0]).toContain("home-imac");
  });

  it("#F5 without the capability a row switches in-page transactionally and no pair action calls the bridge", async () => {
    delete (window as any).piDashboard;
    const { onSwitch } = await openMenu();
    await waitFor(() => expect(rowOf("home-imac").textContent).toMatch(/Available/));
    fireEvent.click(rowOf("home-imac"));
    expect(onSwitch).toHaveBeenCalledWith("192.168.16.204", 8000);
    expect(openServerWindow).not.toHaveBeenCalled();
  });
});

describe("Paired state per client (#F9)", () => {
  beforeEach(() => {
    identityMock.reset();
    identityMock.proves.set("192.168.16.204", FP_HOME);
    identityMock.proves.set("lab.lan", FP_LAB);
    vi.mocked(listKnownServers).mockResolvedValue([] as never);
    (globalThis as any).fetch = vi.fn((url: string) =>
      String(url).includes("localhost") ? Promise.reject(new TypeError("refused")) : Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) } as Response),
    );
  });
  afterEach(() => {
    identityMock.reset();
    vi.mocked(listKnownServers).mockResolvedValue([{ host: "192.168.16.204", port: 8000, label: "home-imac" }] as never);
  });

  const BRIDGE_RESULT = {
    paired: [
      { fingerprint: FP_HOME, label: "home-imac", state: "paired", host: "192.168.16.204:8000", bearer: BEARER, cookie: BEARER, partition: BEARER },
      { fingerprint: FP_LAB, label: "lab-server", state: "needs-pairing", host: "lab.lan:8000", bearer: BEARER },
    ],
    discovered: [{ name: "studio-mbp", host: "192.168.16.77", port: 8000, fingerprint: FP_STUDIO, state: "not-paired" }],
  };

  it("#F9 Electron: Paired / Needs pairing / Not paired / This dashboard; the bridge result's extra fields never reach the page", async () => {
    (window as any).piDashboard = { openServerWindow, listServers: vi.fn(async () => BRIDGE_RESULT) };
    await openMenu();
    await waitFor(() => expect(rowOf("home-imac")).toBeTruthy());
    expect(pairedOf("home-imac")).toBe("Paired");
    expect(pairedOf("lab-server")).toBe("Needs pairing");
    expect(pairedOf("studio-mbp")).toBe("Not paired");
    expect(pairedOf("localhost")).toBe("This dashboard");
    expect(document.body.textContent).not.toContain(BEARER);
    // The capability wrapper copies only renderer-safe fields: whatever else the bridge returns is dropped.
    const state = await getListServers()!();
    expect(JSON.stringify(state)).not.toContain(BEARER);
    expect(Object.keys(state!.paired[0]!).sort()).toEqual(["fingerprint", "host", "label", "state"]);
    // A paired server offers no pair action; the other two do.
    expect(screen.getAllByRole("menuitem", { hidden: true }).filter((i) => i.getAttribute("data-testid") === "pair-action")).toHaveLength(2);
  });

  it("#F9 browser: other origins read 'Unknown in this tab', the page's own origin 'This dashboard'", async () => {
    delete (window as any).piDashboard;
    vi.mocked(listKnownServers).mockResolvedValue([
      { host: "192.168.16.204", port: 8000, label: "home-imac", addedAt: ts },
      { host: "lab.lan", port: 8000, label: "lab-server", addedAt: ts },
    ] as never);
    await openMenu({ currentHost: "192.168.16.204", currentPort: 8000 });
    await waitFor(() => expect(rowOf("lab-server")).toBeTruthy());
    expect(pairedOf("home-imac")).toBe("This dashboard");
    expect(pairedOf("lab-server")).toBe("Unknown in this tab");
    expect(document.body.textContent).not.toMatch(/Needs pairing|Not paired/);
  });
});
