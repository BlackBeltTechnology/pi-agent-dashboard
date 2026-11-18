/**
 * useRolesSnapshot — full /api/roles envelope for the Settings default-model
 * follow hint. See change: default-model-follows-role (task 6.1).
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRolesSnapshot } from "../useRolesSnapshot.js";

const body = (planning: string, active: string | null) => ({
  object: "list",
  data: [
    { preset: null, active: active === null, roles: [{ role: "planning", assigned: true, model: planning, thinkingLevel: "high" }] },
    { preset: "Anthropic", active: active === "Anthropic", roles: [] },
    { preset: "Proxy", active: active === "Proxy", roles: [] },
  ],
});

afterEach(() => vi.unstubAllGlobals());

describe("useRolesSnapshot", () => {
  it("returns live rows + the active named preset; refetch re-reads", async () => {
    let n = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        n++;
        return new Response(JSON.stringify(n === 1 ? body("anthropic/a", "Anthropic") : body("proxy/b", "Proxy")), { status: 200 });
      }),
    );
    const { result } = renderHook(() => useRolesSnapshot());
    await waitFor(() => expect(result.current.liveRows?.[0]?.model).toBe("anthropic/a"));
    expect(result.current.activePreset).toBe("Anthropic");
    act(() => result.current.refetch());
    await waitFor(() => expect(result.current.liveRows?.[0]?.model).toBe("proxy/b"));
    expect(result.current.activePreset).toBe("Proxy");
  });

  it("live group active → activePreset null", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body("anthropic/a", null)), { status: 200 })));
    const { result } = renderHook(() => useRolesSnapshot());
    await waitFor(() => expect(result.current.liveRows).not.toBeNull());
    expect(result.current.activePreset).toBeNull();
  });

  it("non-2xx → liveRows null", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 404 })));
    const { result } = renderHook(() => useRolesSnapshot());
    await act(async () => {});
    expect(result.current.liveRows).toBeNull();
  });
});
