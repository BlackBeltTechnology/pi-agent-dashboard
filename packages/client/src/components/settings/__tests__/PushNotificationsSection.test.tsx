/**
 * Settings ▸ Sessions ▸ Push notifications: availability, device toggle, the
 * secret-free token list, the "Add webhook URL" form (works without Web Push),
 * insecure-context + iOS hints.
 * Harness: direct-mount unit rows of `AllowedHostsSection.test.tsx`.
 * See change: add-server-push-notifications (test-plan #F1–#F5).
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PushNotificationsSection } from "../PushNotificationsSection.js";

type Token = { tokenId: string; transport: string; display: string; registeredAt: number; lastUsedAt: number; consecutiveFailures: number };

interface Fixture {
  vapidStatus: number;
  tokens: Token[];
  registerStatus: number;
  registerBody: Record<string, unknown>;
}

let fx: Fixture;
let calls: Array<{ url: string; method?: string; body?: any }>;

function mockFetch() {
  calls = [];
  global.fetch = vi.fn().mockImplementation((url: string, options?: any) => {
    const body = options?.body ? JSON.parse(options.body) : undefined;
    calls.push({ url, method: options?.method, body });
    const json = (status: number, data: unknown) =>
      Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(data) });
    if (url === "/api/push/vapid-public-key") {
      return fx.vapidStatus === 200 ? json(200, { publicKey: "BPk" }) : json(fx.vapidStatus, { error: "push notifications are not enabled on this server" });
    }
    if (url === "/api/push/register" && (!options?.method || options.method === "GET")) {
      return json(200, { tokens: fx.tokens });
    }
    if (url === "/api/push/register" && options?.method === "POST") {
      if (fx.registerStatus === 200) {
        const origin = new URL(body.deviceToken).origin;
        fx.tokens = [
          ...fx.tokens,
          {
            tokenId: "t-new",
            transport: body.transport,
            display: body.label ? `${body.label} (${origin})` : origin,
            registeredAt: 1,
            lastUsedAt: 1,
            consecutiveFailures: 0,
          },
        ];
      }
      return json(fx.registerStatus, fx.registerBody);
    }
    if (url.startsWith("/api/push/register/") && options?.method === "DELETE") {
      fx.tokens = fx.tokens.filter((t) => !url.endsWith(t.tokenId));
      return Promise.resolve({ ok: true, status: 204, json: () => Promise.resolve(null) });
    }
    if (url === "/api/push/test") return json(200, { results: [] });
    return json(404, null);
  });
}

const originalUA = navigator.userAgent;

function setSecureContext(value: boolean) {
  Object.defineProperty(window, "isSecureContext", { value, configurable: true });
}

function setUserAgent(ua: string) {
  Object.defineProperty(window.navigator, "userAgent", { value: ua, configurable: true });
}

describe("PushNotificationsSection", () => {
  beforeEach(() => {
    fx = { vapidStatus: 200, tokens: [], registerStatus: 200, registerBody: { tokenId: "t-new" } };
    mockFetch();
    setSecureContext(true);
    window.matchMedia =
      window.matchMedia ??
      ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }) as any);
  });

  afterEach(() => {
    cleanup();
    setUserAgent(originalUA);
    vi.restoreAllMocks();
  });

  it("adds a webhook and lists it as label (origin); the key never reaches the DOM (test-plan #F1)", async () => {
    render(<PushNotificationsSection />);
    const url = await screen.findByLabelText(/webhook url/i);
    fireEvent.change(url, { target: { value: "http://192.168.1.20:8787/api/hooks/h1?key=k" } });
    fireEvent.change(screen.getByLabelText(/label/i), { target: { value: "nanoMuse" } });
    fireEvent.click(screen.getByRole("button", { name: /add webhook/i }));

    await screen.findByText("nanoMuse (http://192.168.1.20:8787)");
    const post = calls.find((c) => c.url === "/api/push/register" && c.method === "POST");
    expect(post?.body).toEqual({
      transport: "webhook",
      deviceToken: "http://192.168.1.20:8787/api/hooks/h1?key=k",
      label: "nanoMuse",
    });
    await waitFor(() => expect((screen.getByLabelText(/webhook url/i) as HTMLInputElement).value).toBe(""));
    expect(document.body.innerHTML).not.toContain("key=k");
  });

  it("shows a 400 inline, linked via aria-describedby (test-plan #F2)", async () => {
    fx.registerStatus = 400;
    fx.registerBody = { error: "webhook target is a link-local or metadata address" };
    render(<PushNotificationsSection />);
    const url = await screen.findByLabelText(/webhook url/i);
    fireEvent.change(url, { target: { value: "http://169.254.169.254/" } });
    fireEvent.click(screen.getByRole("button", { name: /add webhook/i }));
    const err = await screen.findByText("webhook target is a link-local or metadata address");
    expect(err.id).toBeTruthy();
    expect(url.getAttribute("aria-describedby")).toContain(err.id);
    expect(url.getAttribute("aria-invalid")).toBe("true");
  });

  it("server 404 → 'Push not enabled on this server', no toggle, no form (test-plan #F3)", async () => {
    fx.vapidStatus = 404;
    render(<PushNotificationsSection />);
    await screen.findByText("Push not enabled on this server");
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByLabelText(/webhook url/i)).toBeNull();
  });

  it("insecure context → https notice, no device toggle, webhook form still present (test-plan #F4)", async () => {
    setSecureContext(false);
    render(<PushNotificationsSection />);
    await screen.findByText(/Web Push needs https or localhost/i);
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.getByLabelText(/webhook url/i)).toBeTruthy();
  });

  it("iOS, not standalone → install-to-home-screen hint (test-plan #F5)", async () => {
    setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148");
    render(<PushNotificationsSection />);
    await screen.findByText(/install to home screen/i);
  });

  it("lists tokens by display only, with unregister and Send Test", async () => {
    fx.tokens = [
      { tokenId: "a", transport: "webhook", display: "nanoMuse (http://192.168.1.20:8787)", registeredAt: 1, lastUsedAt: 1, consecutiveFailures: 2 },
    ];
    render(<PushNotificationsSection />);
    await screen.findByText("nanoMuse (http://192.168.1.20:8787)");
    fireEvent.click(screen.getByRole("button", { name: /send test.*nanoMuse/i }));
    await waitFor(() => expect(calls.some((c) => c.url === "/api/push/test" && c.body?.tokenId === "a")).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: /remove.*nanoMuse/i }));
    await waitFor(() => expect(screen.queryByText("nanoMuse (http://192.168.1.20:8787)")).toBeNull());
  });
});
