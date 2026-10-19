import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiContext, setGlobalApiBase } from "../../lib/api/api-context.js";
import { ConnectionStatusBanner } from "../connectivity/ConnectionStatusBanner.js";

describe("ConnectionStatusBanner", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("does not render when status is 'connected'", () => {
    render(
      <ConnectionStatusBanner
        status="connected"
        currentServerHost="my-pc"
        inFlightSwitch={false}
      />,
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does not render before threshold elapses", () => {
    render(
      <ConnectionStatusBanner
        status="connecting"
        currentServerHost="my-pc"
        inFlightSwitch={false}
        thresholdMs={3000}
      />,
    );
    expect(screen.queryByRole("alert")).toBeNull();
    act(() => vi.advanceTimersByTime(2999));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders after threshold when status stays non-connected", () => {
    render(
      <ConnectionStatusBanner
        status="connecting"
        currentServerHost="my-pc"
        inFlightSwitch={false}
        thresholdMs={3000}
      />,
    );
    act(() => vi.advanceTimersByTime(3001));
    expect(screen.queryByRole("alert")).not.toBeNull();
    expect(screen.queryByText(/Disconnected from/i)).not.toBeNull();
  });

  it("does not render during in-flight staging switch even if status flapped", () => {
    render(
      <ConnectionStatusBanner
        status="connecting"
        currentServerHost="my-pc"
        inFlightSwitch={true}
        thresholdMs={3000}
      />,
    );
    act(() => vi.advanceTimersByTime(5000));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("hides immediately when status returns to connected", () => {
    const { rerender } = render(
      <ConnectionStatusBanner
        status="connecting"
        currentServerHost="my-pc"
        inFlightSwitch={false}
        thresholdMs={3000}
      />,
    );
    act(() => vi.advanceTimersByTime(3001));
    expect(screen.queryByRole("alert")).not.toBeNull();
    rerender(
      <ConnectionStatusBanner
        status="connected"
        currentServerHost="my-pc"
        inFlightSwitch={false}
        thresholdMs={3000}
      />,
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders 'Network not allowed' surface (not Disconnected) when networkDenied is set", () => {
    render(
      <ConnectionStatusBanner
        status="offline"
        currentServerHost="pennyroyal.lan"
        inFlightSwitch={false}
        thresholdMs={3000}
        networkDenied={{ hint: "Add this network to trustedNetworks (Settings → Servers) or sign in." }}
      />,
    );
    // Renders immediately — no threshold wait for a definitive policy denial.
    const alert = screen.queryByRole("alert");
    expect(alert).not.toBeNull();
    expect(screen.queryByText(/Network not allowed/i)).not.toBeNull();
    expect(screen.queryByText(/trustedNetworks/i)).not.toBeNull();
    // The transport "Disconnected from … Retrying" copy must NOT be shown.
    expect(screen.queryByText(/Disconnected from/i)).toBeNull();
  });

  it("offers a Settings → Servers affordance in the network-not-allowed surface", () => {
    const spy = vi.fn();
    render(
      <ConnectionStatusBanner
        status="offline"
        currentServerHost="pennyroyal.lan"
        inFlightSwitch={false}
        networkDenied={{ hint: "remedy text" }}
        onOpenServers={spy}
      />,
    );
    const btn = screen.getByRole("button", { name: /servers/i });
    btn.click();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("transport drop (no networkDenied) still shows the Disconnected/Retrying banner", () => {
    render(
      <ConnectionStatusBanner
        status="offline"
        currentServerHost="my-pc"
        inFlightSwitch={false}
        thresholdMs={3000}
      />,
    );
    act(() => vi.advanceTimersByTime(3001));
    expect(screen.queryByText(/Disconnected from/i)).not.toBeNull();
    expect(screen.queryByText(/Network not allowed/i)).toBeNull();
  });

  it("renders Switch server button that calls onOpenServerSelector", () => {
    const spy = vi.fn();
    render(
      <ConnectionStatusBanner
        status="offline"
        currentServerHost="my-pc"
        inFlightSwitch={false}
        thresholdMs={3000}
        onOpenServerSelector={spy}
      />,
    );
    act(() => vi.advanceTimersByTime(3001));
    const btn = screen.getByRole("button", { name: /switch server/i });
    btn.click();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

// add-lan-knock-pairing — "Request access" on the network-denied surface (test-plan #F9).
describe("ConnectionStatusBanner — network denied: Request access (F9)", () => {
  const HINT = `Ask the dashboard owner to add your network to trusted networks. ${"x".repeat(200)}`;
  const originalLocation = window.location;
  let assign: ReturnType<typeof vi.fn>;
  let open: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    assign = vi.fn();
    open = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, origin: "http://192.168.16.31:8000", assign },
    });
    vi.stubGlobal("open", open);
  });
  afterEach(() => {
    cleanup();
    setGlobalApiBase("");
    vi.unstubAllGlobals();
    Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
  });

  const renderDenied = (onOpenServers?: () => void) =>
    render(
      <ConnectionStatusBanner
        status="offline"
        currentServerHost="pennyroyal.lan"
        inFlightSwitch={false}
        networkDenied={{ hint: HINT }}
        onOpenServers={onOpenServers}
      />,
    );

  it("keeps the verbatim hint and the Settings → Servers action next to Request access", () => {
    const servers = vi.fn();
    renderDenied(servers);
    expect(screen.getByRole("alert").textContent).toContain(HINT);
    expect(screen.getByTestId("network-denied-request-access").textContent).toBe("Request access");
    fireEvent.click(screen.getByRole("button", { name: /servers/i }));
    expect(servers).toHaveBeenCalledTimes(1);
  });

  it("same origin: Request access navigates to /pair?request (no new window)", () => {
    renderDenied();
    fireEvent.click(screen.getByTestId("network-denied-request-access"));
    expect(assign).toHaveBeenCalledWith("/pair?request");
    expect(open).not.toHaveBeenCalled();
  });

  it("active server equal to the page origin is still same-origin", () => {
    setGlobalApiBase("http://192.168.16.31:8000");
    renderDenied();
    fireEvent.click(screen.getByTestId("network-denied-request-access"));
    expect(assign).toHaveBeenCalledWith("/pair?request");
    expect(open).not.toHaveBeenCalled();
  });

  it("remote active server: opens its own /pair?request with noopener", () => {
    render(
      <ApiContext.Provider value="http://192.168.16.204:8000">
        <ConnectionStatusBanner
          status="offline"
          currentServerHost="home-imac"
          inFlightSwitch={false}
          networkDenied={{ hint: HINT }}
        />
      </ApiContext.Provider>,
    );
    fireEvent.click(screen.getByTestId("network-denied-request-access"));
    expect(open).toHaveBeenCalledWith("http://192.168.16.204:8000/pair?request", "_blank", "noopener");
    expect(assign).not.toHaveBeenCalled();
  });

  it("remote active server via the module-level base also opens its request page", () => {
    setGlobalApiBase("http://192.168.16.204:8000");
    renderDenied();
    fireEvent.click(screen.getByTestId("network-denied-request-access"));
    expect(open).toHaveBeenCalledWith("http://192.168.16.204:8000/pair?request", "_blank", "noopener");
  });

  it("is styled with severity-warning tokens, an icon and a wrapping hint — no amber palette, no truncate", () => {
    renderDenied(vi.fn());
    const alert = screen.getByRole("alert");
    const html = alert.outerHTML;
    expect(html).not.toMatch(/amber/);
    expect(alert.className).toContain("--severity-warning-bg");
    expect(alert.className).toContain("--severity-warning-fg");
    expect(alert.className).toContain("--severity-warning-border");
    expect(html).not.toMatch(/\btruncate\b/);
    expect(alert.querySelector("svg")).not.toBeNull();
    expect(alert.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("Request access is the strong action (accent fill) and Settings → Servers is not", () => {
    renderDenied(vi.fn());
    expect(screen.getByTestId("network-denied-request-access").className).toContain("--accent-solid");
    expect(screen.getByRole("button", { name: /servers/i }).className).not.toContain("--accent-solid");
  });

  it("Request access shows even when no onOpenServers handler is wired", () => {
    renderDenied();
    expect(screen.getByTestId("network-denied-request-access")).toBeDefined();
  });
});

// retire-trusted-networks-bypass — the denied bar follows the knock (test-plan #F8):
// idle → Request access; pending → the waiting code; refused → the server's reason.
describe("ConnectionStatusBanner — network denied: knock state (F8)", () => {
  const KNOCK_KEY = "pi-dashboard:pair-request";
  const REFUSAL_KEY = "pi-dashboard:pair-request-refusal";

  const renderDenied = (onOpenServers: () => void = vi.fn()) =>
    render(
      <ConnectionStatusBanner
        status="offline"
        currentServerHost="home-imac"
        inFlightSwitch={false}
        networkDenied={{ hint: "This device isn't paired with home-imac." }}
        onOpenServers={onOpenServers}
      />,
    );

  beforeEach(() => sessionStorage.clear());
  afterEach(() => {
    cleanup();
    sessionStorage.clear();
    vi.useRealTimers();
  });

  /** Request access primary, Settings → Servers secondary, whatever the knock state. */
  const expectActions = () => {
    const primary = screen.getByRole("button", { name: "Request access" });
    expect(primary.className).toContain("--accent-solid");
    const servers = screen.getByRole("button", { name: /servers/i });
    expect(servers.className).not.toContain("--accent-solid");
  };

  it("idle: warning bar with the hint, Request access primary + Settings → Servers secondary", () => {
    renderDenied();
    const bar = screen.getByTestId("network-denied-banner");
    expect(bar.className).toContain("--severity-warning-bg");
    expect(bar.textContent).toContain("This device isn't paired with home-imac.");
    expect(screen.queryByTestId("network-denied-request-pending")).toBeNull();
    expect(screen.queryByTestId("network-denied-request-refused")).toBeNull();
    expectActions();
  });

  it("pending: shows the grouped code, the host and a countdown on info tokens", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T12:00:00Z"));
    sessionStorage.setItem(
      KNOCK_KEY,
      JSON.stringify({ pendingId: "p1", confirmCode: "48217730", expiresAt: Date.now() + 272_000 }),
    );
    renderDenied();
    const bar = screen.getByTestId("network-denied-request-pending");
    expect(bar.className).toContain("--severity-info-bg");
    expect(bar.textContent).toContain("Waiting for approval on home-imac");
    expect(bar.textContent).toContain("4821 7730");
    expect(bar.textContent).toContain("4:32");
    expectActions();
    // The countdown ticks; at expiry the bar falls back to the plain denial.
    act(() => vi.advanceTimersByTime(2_000));
    expect(screen.getByTestId("network-denied-request-pending").textContent).toContain("4:30");
    act(() => vi.advanceTimersByTime(271_000));
    expect(screen.queryByTestId("network-denied-request-pending")).toBeNull();
    expect(screen.getByTestId("network-denied-banner")).toBeDefined();
  });

  it("refused knock_disabled: error bar with the server's reason, never 'trust the network'", () => {
    sessionStorage.setItem(REFUSAL_KEY, JSON.stringify({ code: "knock_disabled", at: Date.now() }));
    renderDenied();
    const bar = screen.getByTestId("network-denied-request-refused");
    expect(bar.className).toContain("--severity-error-bg");
    expect(bar.textContent).toMatch(/isn't accepting requests from the network/);
    expect(bar.textContent).not.toMatch(/trust/i);
    expectActions();
  });

  it("refused knock_rate_limited: the cooldown is formatted into the reason", () => {
    sessionStorage.setItem(
      REFUSAL_KEY,
      JSON.stringify({ code: "knock_rate_limited", at: Date.now(), cooldownUntil: Date.now() + 120_000 }),
    );
    renderDenied();
    expect(screen.getByTestId("network-denied-request-refused").textContent).toMatch(/request again in 2:0\d/);
  });

  it("an old refusal no longer describes the device: back to the plain denial", () => {
    sessionStorage.setItem(REFUSAL_KEY, JSON.stringify({ code: "knock_disabled", at: Date.now() - 11 * 60_000 }));
    renderDenied();
    expect(screen.queryByTestId("network-denied-request-refused")).toBeNull();
    expect(screen.getByTestId("network-denied-banner")).toBeDefined();
  });

  it("no palette classes in any denied state", () => {
    for (const seed of [
      () => {},
      () => sessionStorage.setItem(KNOCK_KEY, JSON.stringify({ pendingId: "p", confirmCode: "11112222", expiresAt: Date.now() + 60_000 })),
      () => {
        sessionStorage.clear();
        sessionStorage.setItem(REFUSAL_KEY, JSON.stringify({ code: "knock_disabled", at: Date.now() }));
      },
    ]) {
      seed();
      const { container, unmount } = renderDenied();
      expect(container.innerHTML).not.toMatch(/amber-/);
      unmount();
    }
  });

  it("Request access still navigates to /pair?request in the refused and pending states", () => {
    const assign = vi.fn();
    const originalLocation = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: { ...originalLocation, origin: "http://x", assign } });
    sessionStorage.setItem(REFUSAL_KEY, JSON.stringify({ code: "knock_disabled", at: Date.now() }));
    renderDenied();
    fireEvent.click(screen.getByRole("button", { name: "Request access" }));
    expect(assign).toHaveBeenCalledWith("/pair?request");
    Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
  });
});
