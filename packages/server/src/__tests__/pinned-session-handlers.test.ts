// Handlers for the desktop session tab bar: pin/unpin/reorder. Each mutates
// the PreferencesStore and broadcasts the full ordered list.
// See change: session-tab-bar.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { handlePinSession, handleReorderPinnedSessions, handleUnpinSession } from "../browser-handlers/directory-handler.js";
import type { BrowserHandlerContext } from "../browser-handlers/handler-context.js";
import { createPreferencesStore } from "../persistence/preferences-store.js";

vi.mock("../resolve-path.js", () => ({ safeRealpathSync: (p: string) => p }));

describe("pinned-session handlers", () => {
  let tmpDir: string;
  let store: ReturnType<typeof createPreferencesStore>;
  let broadcasts: ServerToBrowserMessage[];
  let ctx: BrowserHandlerContext;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pin-session-test-"));
    store = createPreferencesStore(path.join(tmpDir, "preferences.json"));
    broadcasts = [];
    ctx = {
      preferencesStore: store,
      broadcast: (msg: ServerToBrowserMessage) => broadcasts.push(msg),
    } as unknown as BrowserHandlerContext;
  });

  afterEach(() => {
    store.dispose();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("pin appends and broadcasts the full ordered list", () => {
    handlePinSession({ type: "pin_session", sessionId: "s1" }, ctx);
    handlePinSession({ type: "pin_session", sessionId: "s2" }, ctx);
    expect(store.getPinnedSessions()).toEqual(["s1", "s2"]);
    expect(broadcasts.at(-1)).toEqual({ type: "pinned_sessions_updated", sessionIds: ["s1", "s2"] });
  });

  it("unpin removes and broadcasts", () => {
    handlePinSession({ type: "pin_session", sessionId: "s1" }, ctx);
    handlePinSession({ type: "pin_session", sessionId: "s2" }, ctx);
    handleUnpinSession({ type: "unpin_session", sessionId: "s1" }, ctx);
    expect(store.getPinnedSessions()).toEqual(["s2"]);
    expect(broadcasts.at(-1)).toEqual({ type: "pinned_sessions_updated", sessionIds: ["s2"] });
  });

  it("reorder replaces the order and broadcasts", () => {
    handlePinSession({ type: "pin_session", sessionId: "s1" }, ctx);
    handlePinSession({ type: "pin_session", sessionId: "s2" }, ctx);
    handleReorderPinnedSessions({ type: "reorder_pinned_sessions", sessionIds: ["s2", "s1"] }, ctx);
    expect(store.getPinnedSessions()).toEqual(["s2", "s1"]);
    expect(broadcasts.at(-1)).toEqual({ type: "pinned_sessions_updated", sessionIds: ["s2", "s1"] });
  });
});
