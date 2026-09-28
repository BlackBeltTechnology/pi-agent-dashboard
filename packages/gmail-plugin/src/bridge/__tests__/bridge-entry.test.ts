/**
 * L1 guard declarations + tool registration (test-plan E21; task 3.2).
 * See change: add-gmail-plugin.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import activate, { declareToGuard, GUARD_REGISTRY_SYMBOL } from "../index.js";

const host = globalThis as unknown as Record<symbol, unknown>;
afterEach(() => {
  delete host[GUARD_REGISTRY_SYMBOL];
});

describe("E21 — guard declarations", () => {
  it("creates the registry when the guard is absent: reads untrusted, writes self-confirming", () => {
    const h: Record<symbol, unknown> = {};
    declareToGuard(h);
    const reg = h[GUARD_REGISTRY_SYMBOL] as { declarations: Array<{ kind: string; names: string[] }> };
    expect(reg.declarations).toEqual([
      { kind: "untrusted", names: ["gmail_search", "gmail_get", "gmail_labels", "gmail_attachments"] },
      { kind: "selfConfirming", names: ["gmail_draft", "gmail_send", "gmail_reply", "gmail_modify", "gmail_trash"] },
    ]);
  });

  it("adopts an existing guard registry (order-independent)", () => {
    const existing = { declarations: [{ kind: "untrusted", names: ["other_tool"] }] };
    const h: Record<symbol, unknown> = { [GUARD_REGISTRY_SYMBOL]: existing };
    declareToGuard(h);
    expect(h[GUARD_REGISTRY_SYMBOL]).toBe(existing);
    expect(existing.declarations).toHaveLength(3);
  });

  it("activate registers all ten tools and declares them", () => {
    const registerTool = vi.fn();
    activate({ registerTool });
    expect(registerTool.mock.calls.map((c) => (c[0] as { name: string }).name).sort()).toEqual([
      "gmail_accounts",
      "gmail_attachments",
      "gmail_draft",
      "gmail_get",
      "gmail_labels",
      "gmail_modify",
      "gmail_reply",
      "gmail_search",
      "gmail_send",
      "gmail_trash",
    ]);
    expect((host[GUARD_REGISTRY_SYMBOL] as { declarations: unknown[] }).declarations).toHaveLength(2);
  });
});
