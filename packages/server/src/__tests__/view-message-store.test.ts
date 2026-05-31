/**
 * Tests for `ViewMessageStore` and the architectural guarantee that view
 * messages NEVER reach the pi-bound message stream (option B: separate
 * server-side store, no bridge integration). See change: render-file-previews.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { ViewMessageStore } from "../view-message-store.js";

describe("ViewMessageStore", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), "view-msg-store-"));
  });
  afterEach(async () => {
    await fsp.rm(dir, { recursive: true, force: true });
  });

  it("starts empty for an unknown session", () => {
    const s = new ViewMessageStore(dir);
    expect(s.get("nope")).toEqual([]);
  });

  it("append() returns a ChatMessage with view set and role=user content=''", () => {
    const s = new ViewMessageStore(dir);
    const m = s.append("sid", { kind: "file", cwd: "/x", path: "y.md" });
    expect(m.role).toBe("user");
    expect(m.content).toBe("");
    expect(m.view).toEqual({ kind: "file", cwd: "/x", path: "y.md" });
    expect(typeof m.id).toBe("string");
    expect(typeof m.timestamp).toBe("number");
  });

  it("get() returns appended entries in insertion order", () => {
    const s = new ViewMessageStore(dir);
    s.append("sid", { kind: "file", cwd: "/x", path: "a.md" });
    s.append("sid", { kind: "url", url: "https://youtu.be/abc" });
    const list = s.get("sid");
    expect(list).toHaveLength(2);
    expect(list[0].view).toEqual({ kind: "file", cwd: "/x", path: "a.md" });
    expect(list[1].view).toEqual({ kind: "url", url: "https://youtu.be/abc" });
  });

  it("persists across instances (writes JSON file)", async () => {
    const s1 = new ViewMessageStore(dir);
    s1.append("sid", { kind: "url", url: "https://example.com" });
    // Let the async persist settle.
    await new Promise((r) => setTimeout(r, 20));
    const s2 = new ViewMessageStore(dir);
    const list = s2.get("sid");
    expect(list).toHaveLength(1);
    expect(list[0].view).toEqual({ kind: "url", url: "https://example.com" });
  });

  it("remove() drops in-memory + on-disk state", async () => {
    const s = new ViewMessageStore(dir);
    s.append("sid", { kind: "url", url: "https://x" });
    await new Promise((r) => setTimeout(r, 20));
    await s.remove("sid");
    expect(s.get("sid")).toEqual([]);
    // File should be gone too.
    const safe = "sid".replace(/[^A-Za-z0-9_-]/g, "_");
    await expect(fsp.access(path.join(dir, `${safe}.json`))).rejects.toThrow();
  });

  it("sanitizes session ids when building the file name (no traversal)", async () => {
    const s = new ViewMessageStore(dir);
    s.append("../etc/passwd", { kind: "url", url: "https://x" });
    await new Promise((r) => setTimeout(r, 20));
    // The dangerous id MUST be flattened to underscores; no escape from `dir`.
    const entries = await fsp.readdir(dir);
    expect(entries.some((e) => e.includes(".."))).toBe(false);
    expect(entries.some((e) => e.includes("/"))).toBe(false);
  });
});

describe("view messages — architectural isolation", () => {
  // This is a structural / architectural guarantee, not a runtime test of
  // pi-bound traffic. With option B (separate per-session JSON store +
  // dedicated `inject_view_message` → `view_messages_update` channel), the
  // bridge / pi-gateway code path has NO handler that consumes view rows
  // or forwards them to pi.sendUserMessage. The store is browser-gateway-
  // local: written via `case "inject_view_message"` and read via
  // `handleSubscribe`'s snapshot + the broadcast inside that case.
  //
  // We assert the absence by scanning the source tree for any reference to
  // view-message-store from the bridge / pi-gateway / extension code.
  it("ViewMessageStore is not imported by any extension or pi-gateway code", async () => {
    const { promises: fsp2 } = await import("node:fs");
    const { execSync } = await import("node:child_process");
    // Run a tree-wide grep from the repo root to be robust. The repo root is
    // four levels above this test file: packages/server/src/__tests__/.
    const repoRoot = path.resolve(__dirname, "../../../..");
    let stdout = "";
    try {
      stdout = execSync(
        `grep -rln "view-message-store" "${repoRoot}/packages/extension/src" "${repoRoot}/packages/server/src/pi-gateway.ts" 2>/dev/null || true`,
        { encoding: "utf-8" },
      );
    } catch {
      // grep with no matches exits non-zero; we treat that as the success case.
    }
    expect(stdout.trim()).toBe("");
    void fsp2; // satisfy unused-import linter in some setups
  });
});
