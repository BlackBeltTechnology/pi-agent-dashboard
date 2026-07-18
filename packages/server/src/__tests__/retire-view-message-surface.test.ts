/**
 * Regression guard (test-plan X8): the inline `/view` surface is retired.
 * `/view` now opens the editor pane, so the server must no longer HANDLE
 * `inject_view_message` nor EMIT `view_messages_update`, and the
 * `ViewMessageStore` module is deleted. A source-level guard is the right shape
 * for a deletion invariant (mirrors the X5 content-consumer grep guard).
 *
 * See change: open-view-command-in-editor-pane (D2, task 7.2).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(path.join(srcDir, rel), "utf8");

describe("retired /view inline surface (X8)", () => {
  it("the ViewMessageStore module is deleted", () => {
    expect(existsSync(path.join(srcDir, "view-message-store.ts"))).toBe(false);
  });

  it("browser-gateway no longer handles inject_view_message or emits view_messages_update", () => {
    const gw = read("pairing/browser-gateway.ts");
    expect(gw).not.toContain('case "inject_view_message"');
    expect(gw).not.toContain('type: "view_messages_update"');
    expect(gw).not.toContain("ViewMessageStore");
  });

  it("subscription-handler no longer emits a view_messages_update snapshot", () => {
    const sh = read("browser-handlers/subscription-handler.ts");
    expect(sh).not.toContain('type: "view_messages_update"');
    expect(sh).not.toContain("viewMessageStore");
  });
});
