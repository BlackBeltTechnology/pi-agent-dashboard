/**
 * Unit tests for the module-level relay store (change: add-browser-relay).
 *
 * The `content-view` predicate `isLiveViewActive` reads `hasLiveInstance()`
 * synchronously, so the store's gating + dismissal semantics are the contract
 * the shell's slot layer depends on.
 */
import type { BrowserRelayStatusMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { afterEach, describe, expect, it } from "vitest";
import {
  __resetRelayStoreForTests,
  dismissLiveView,
  hasLiveInstance,
  setRelayStatus,
} from "../relay-store.js";

function status(tabIds: number[], auditSeq = 0): BrowserRelayStatusMessage {
  return {
    type: "browser_relay_status",
    instances: [
      {
        instanceId: "inst-1",
        profileDirectory: "Fake",
        state: "connected",
        tabs: tabIds.map((tabId) => ({
          tabId,
          title: `tab ${tabId}`,
          url: "https://fake.test/",
          state: "live",
        })),
      },
    ],
    auditSeq,
  };
}

afterEach(() => __resetRelayStoreForTests());

describe("relay store gate", () => {
  it("needs a live tab to be active", () => {
    expect(hasLiveInstance()).toBe(false);
    setRelayStatus(status([]));
    expect(hasLiveInstance()).toBe(false);
    setRelayStatus(status([1]));
    expect(hasLiveInstance()).toBe(true);
  });

  it("a dismiss clears the gate, an audit-only change does not re-arm it, a new tab does", () => {
    setRelayStatus(status([1]));
    expect(hasLiveInstance()).toBe(true);

    dismissLiveView();
    expect(hasLiveInstance()).toBe(false);

    // Same instance/tab shape, only `auditSeq` moved: NOT material → stays down.
    setRelayStatus(status([1], 9));
    expect(hasLiveInstance()).toBe(false);

    // A new tab is a material change → the view re-arms.
    setRelayStatus(status([1, 2]));
    expect(hasLiveInstance()).toBe(true);
  });
});
