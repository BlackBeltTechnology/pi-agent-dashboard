/**
 * ServerSelector — Electron branch: open a server window instead of an in-page switch.
 * See change: add-electron-server-windows (test-plan E37, E38, E39).
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServerSelector } from "../connectivity/ServerSelector.js";

vi.mock("../../lib/api/known-servers-api.js", () => ({
  listKnownServers: vi.fn(async () => [{ host: "192.168.16.204", port: 8000, label: "home-imac" }]),
  probeKnownServer: vi.fn(async () => null),
  acceptKnownServerMove: vi.fn(async () => true),
}));

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
  fireEvent.click(screen.getByTitle("Switch server"));
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
    fireEvent.click(screen.getByTitle("Switch server")); // close
    fireEvent.click(screen.getByTitle("Switch server")); // reopen → re-probe
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
