import { describe, it, expect } from "vitest";
import type { OpenSpecBulkArchiveBrowserMessage, BrowserToServerMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";

describe("openspec_bulk_archive message type", () => {
  it("is a valid BrowserToServerMessage", () => {
    const msg: OpenSpecBulkArchiveBrowserMessage = {
      type: "openspec_bulk_archive",
      cwd: "/project/foo",
    };
    // Type-check: ensure it's assignable to the union
    const _: BrowserToServerMessage = msg;
    expect(msg.type).toBe("openspec_bulk_archive");
    expect(msg.cwd).toBe("/project/foo");
  });

  it("accepts optional cleanupWorktree flag", () => {
    const msg: OpenSpecBulkArchiveBrowserMessage = {
      type: "openspec_bulk_archive",
      cwd: "/project/foo",
      cleanupWorktree: true,
    };
    const _: BrowserToServerMessage = msg;
    expect(msg.cleanupWorktree).toBe(true);
  });

  it("cleanupWorktree defaults to undefined when omitted", () => {
    const msg: OpenSpecBulkArchiveBrowserMessage = {
      type: "openspec_bulk_archive",
      cwd: "/project/foo",
    };
    expect(msg.cleanupWorktree).toBeUndefined();
  });

  it("cleanupWorktree accepts false", () => {
    const msg: OpenSpecBulkArchiveBrowserMessage = {
      type: "openspec_bulk_archive",
      cwd: "/project/foo",
      cleanupWorktree: false,
    };
    expect(msg.cleanupWorktree).toBe(false);
  });
});
