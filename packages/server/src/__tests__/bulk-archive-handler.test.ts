import type { BrowserToServerMessage, OpenSpecBulkArchiveBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { describe, expect, it } from "vitest";

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
});
