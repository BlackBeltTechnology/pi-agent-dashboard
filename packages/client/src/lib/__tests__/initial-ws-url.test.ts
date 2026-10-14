/**
 * getInitialWsUrl: the Electron local window ignores a saved remote.
 * See change: add-electron-server-windows (test-plan E40).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getInitialWsUrl, LAST_SERVER_KEY } from "../api/server-switch.js";

const setBridge = (on: boolean) => {
  if (on) (window as unknown as { piDashboard?: unknown }).piDashboard = { openServerWindow: async () => ({ ok: true }) };
  else delete (window as unknown as { piDashboard?: unknown }).piDashboard;
};

beforeEach(() => {
  setBridge(false);
  localStorage.clear();
});
afterEach(() => {
  setBridge(false);
  localStorage.clear();
});

describe("getInitialWsUrl (E40)", () => {
  it("capability present on a loopback origin: own origin wins; the saved remote is left untouched", () => {
    localStorage.setItem(LAST_SERVER_KEY, "192.168.16.204:8000");
    setBridge(true);
    // jsdom's default origin (http://localhost:…) is loopback
    expect(getInitialWsUrl()).toBe(`ws://${window.location.host}/ws`);
    expect(localStorage.getItem(LAST_SERVER_KEY)).toBe("192.168.16.204:8000");
  });

  it("no capability (browser): the saved remote is used", () => {
    localStorage.setItem(LAST_SERVER_KEY, "192.168.16.204:8000");
    expect(getInitialWsUrl()).toBe("ws://192.168.16.204:8000/ws");
  });

  it("no saved server: own origin", () => {
    expect(getInitialWsUrl()).toBe(`ws://${window.location.host}/ws`);
  });
});
