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
      { kind: "untrusted", names: ["gmail_search", "gmail_get", "gmail_labels", "gmail_attachments", "gmail_filters_list"] },
      {
        kind: "selfConfirming",
        names: ["gmail_draft", "gmail_send", "gmail_reply", "gmail_modify", "gmail_trash", "gmail_filter_create", "gmail_filter_delete"],
      },
    ]);
  });

  it("adopts an existing guard registry (order-independent)", () => {
    const existing = { declarations: [{ kind: "untrusted", names: ["other_tool"] }] };
    const h: Record<symbol, unknown> = { [GUARD_REGISTRY_SYMBOL]: existing };
    declareToGuard(h);
    expect(h[GUARD_REGISTRY_SYMBOL]).toBe(existing);
    expect(existing.declarations).toHaveLength(3);
  });

  it("activate registers all thirteen tools and declares them", () => {
    const registerTool = vi.fn();
    activate({ registerTool });
    expect(registerTool.mock.calls.map((c) => (c[0] as { name: string }).name).sort()).toEqual([
      "gmail_accounts",
      "gmail_attachments",
      "gmail_draft",
      "gmail_filter_create",
      "gmail_filter_delete",
      "gmail_filters_list",
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

describe("test-plan #E28 — filter tools are declared to the guard correctly", () => {
  it("the list is untrusted; create and delete are self-confirming; the list is not", () => {
    const h: Record<symbol, unknown> = {};
    declareToGuard(h);
    const reg = h[GUARD_REGISTRY_SYMBOL] as { declarations: Array<{ kind: string; names: string[] }> };
    const names = (kind: string) => reg.declarations.find((d) => d.kind === kind)?.names ?? [];
    expect(names("untrusted")).toContain("gmail_filters_list");
    expect(names("selfConfirming")).toEqual(expect.arrayContaining(["gmail_filter_create", "gmail_filter_delete"]));
    expect(names("selfConfirming")).not.toContain("gmail_filters_list");
  });
});
