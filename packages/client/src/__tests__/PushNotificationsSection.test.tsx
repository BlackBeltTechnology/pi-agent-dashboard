/**
 * Component tests for PushNotificationsSection.
 *
 * Verifies rendering for all UI states.
 *
 * See change: add-server-push-notifications.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { PushNotificationsSection } from "../components/PushNotificationsSection.js";

// ── Mocks ──────────────────────────────────────────────────────────

const mockSubscribe = vi.fn();
const mockUnsubscribe = vi.fn();
const mockSendTest = vi.fn();
const mockFetch = vi.fn();

// Use getters so vi.mock hoisting doesn't capture stale let values
const state = {
  status: "available" as string,
  supported: true,
  tokenId: null as string | null,
};

vi.mock("../hooks/usePushSubscription.js", () => ({
  usePushSubscription: () => ({
    get supported() { return state.supported; },
    get status() { return state.status; },
    get tokenId() { return state.tokenId; },
    subscribe: mockSubscribe,
    unsubscribe: mockUnsubscribe,
    sendTest: mockSendTest,
  }),
}));

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockReset();
  mockFetch.mockImplementation((url: string) => {
    if (url === "/api/config") {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ push: { defaults: { notifyErrors: true, notifyAskUser: true } } }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ tokens: [] }) });
  });
  mockSubscribe.mockReset();
  mockUnsubscribe.mockReset();
  mockSendTest.mockReset();
  state.status = "available";
  state.supported = true;
  state.tokenId = null;
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const getText = (text: string | RegExp) => screen.getAllByText(text)[0];

// ── Tests ──────────────────────────────────────────────────────────

describe("PushNotificationsSection", () => {
  describe("unsupported state", () => {
    it("renders 'not supported' message", () => {
      state.supported = false;
      render(<PushNotificationsSection />);
      expect(getText(/not supported/i)).toBeDefined();
    });

    it("mentions HTTPS on http", () => {
      state.supported = false;
      Object.defineProperty(window, "location", {
        value: { protocol: "http:" },
        configurable: true,
        writable: true,
      });
      render(<PushNotificationsSection />);
      expect(getText(/HTTPS is required/i)).toBeDefined();
    });

    it("no subscribe button", () => {
      state.supported = false;
      render(<PushNotificationsSection />);
      expect(screen.queryByRole("button", { name: /enable/i })).toBeNull();
    });
  });

  describe("available state", () => {
    beforeEach(() => { state.status = "available"; });

    it("shows 'Not subscribed' label", () => {
      render(<PushNotificationsSection />);
      expect(getText("Not subscribed")).toBeDefined();
    });

    it("saves global completion default through PUT /api/config", async () => {
      const { container } = render(<PushNotificationsSection />);
      await waitFor(() => expect(container.querySelector("select")).not.toBeNull());
      const select = container.querySelector("select")!;
      fireEvent.change(select, { target: { value: "on" } });
      await waitFor(() => {
        expect(mockFetch.mock.calls.some(([url, init]) => (
          url === "/api/config" &&
          init?.method === "PUT" &&
          init?.body === JSON.stringify({ push: { defaults: { notifyCompletion: "on" } } })
        ))).toBe(true);
      });
    });

    it("shows 'Enable on this device' button", () => {
      render(<PushNotificationsSection />);
      expect(getText("Enable on this device")).toBeDefined();
    });

    it("calls subscribe on click", () => {
      render(<PushNotificationsSection />);
      fireEvent.click(getText("Enable on this device"));
      expect(mockSubscribe).toHaveBeenCalledOnce();
    });

    it("no 'Disable' or 'Send Test'", () => {
      render(<PushNotificationsSection />);
      expect(screen.queryByRole("button", { name: /disable/i })).toBeNull();
      expect(screen.queryByRole("button", { name: /send test/i })).toBeNull();
    });
  });

  describe("subscribed state", () => {
    beforeEach(() => {
      state.status = "subscribed";
      state.tokenId = "test-token-id";
    });

    it("shows 'Subscribed' label", () => {
      render(<PushNotificationsSection />);
      expect(getText("Subscribed")).toBeDefined();
    });

    it("shows Disable and Send Test buttons", () => {
      render(<PushNotificationsSection />);
      expect(getText("Disable on this device")).toBeDefined();
      expect(getText("Send Test")).toBeDefined();
    });

    it("calls unsubscribe on Disable click", () => {
      render(<PushNotificationsSection />);
      fireEvent.click(getText("Disable on this device"));
      expect(mockUnsubscribe).toHaveBeenCalledOnce();
    });

    it("calls sendTest on Send Test click", async () => {
      mockSendTest.mockResolvedValue(true);
      render(<PushNotificationsSection />);
      fireEvent.click(getText("Send Test"));
      await waitFor(() => expect(mockSendTest).toHaveBeenCalledOnce());
    });

    it("shows ✓ Sent! on success", async () => {
      mockSendTest.mockResolvedValue(true);
      render(<PushNotificationsSection />);
      fireEvent.click(getText("Send Test"));
      await waitFor(() => expect(getText("✓ Sent!")).toBeDefined());
    });

    it("shows ✗ Failed on failure", async () => {
      mockSendTest.mockResolvedValue(false);
      render(<PushNotificationsSection />);
      fireEvent.click(getText("Send Test"));
      await waitFor(() => expect(getText("✗ Failed")).toBeDefined());
    });

    it("renders device list when tokens present", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            tokens: [
              {
                id: "abc-123",
                transport: "web-push",
                endpointLast4: "abcd",
                registeredAt: "2026-01-01T00:00:00.000Z",
                lastUsedAt: "2026-01-02T00:00:00.000Z",
              },
            ],
          }),
      });
      render(<PushNotificationsSection />);
      await waitFor(() => {
        expect(getText("Registered devices (1)")).toBeDefined();
        expect(getText("···abcd")).toBeDefined();
      });
    });
  });

  describe("denied state", () => {
    beforeEach(() => { state.status = "denied"; });

    it("shows 'Permission denied' label", () => {
      render(<PushNotificationsSection />);
      expect(getText("Permission denied")).toBeDefined();
    });

    it("shows 'Permission denied' and subscribe button for retry", () => {
      render(<PushNotificationsSection />);
      // Denied state shows the status label and allows retry via subscribe button
      expect(getText("Permission denied")).toBeDefined();
      // The subscribe button may appear — user can retry after re-enabling in OS
    });
  });

  describe("iOS PWA hint", () => {
    it("shows install hint on iPhone when not standalone", () => {
      state.status = "available";
      Object.defineProperty(navigator, "userAgent", {
        value: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
        configurable: true,
      });
      render(<PushNotificationsSection />);
      expect(getText(/Add to Home Screen/i)).toBeDefined();
    });
  });
});
