import { describe, expect, it, vi } from "vitest";
import { loadSignedInUser } from "../signed-in-user.js";

const kcProvider = { pluginId: "idl", label: "Keycloak", logoutUrl: "/idl/logout" };
const kcConfig = { active: true, ...kcProvider, providers: [kcProvider] };

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

describe("loadSignedInUser (D22 user line)", () => {
  it("returns the principal + provider label when identity is enforced and a bearer resolved", async () => {
    const fetchFn = vi.fn(async (url: string) =>
      url.endsWith("/auth/status")
        ? json({ authenticated: true, authEnabled: true, principal: { sub: "u", name: "Anna Kovacs" } })
        : json({}),
    );
    const res = await loadSignedInUser({
      token: "AT",
      apiBase: "",
      fetchFn: fetchFn as unknown as typeof fetch,
      fetchConfig: async () => kcConfig,
    });
    expect(res).toEqual({ user: { sub: "u", name: "Anna Kovacs" }, config: kcConfig });
    expect(fetchFn).toHaveBeenCalledWith("/auth/status", { headers: { Authorization: "Bearer AT" } });
  });

  it("is null without an in-memory bearer (inert plane, device-paired, or legacy auth)", async () => {
    const fetchFn = vi.fn();
    expect(await loadSignedInUser({ token: null, apiBase: "", fetchFn, fetchConfig: vi.fn() })).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("is null when the plane is not enforced or no principal came back", async () => {
    const inert = vi.fn(async () => json({ authenticated: true, authEnabled: false }));
    expect(await loadSignedInUser({ token: "AT", apiBase: "", fetchFn: inert as unknown as typeof fetch, fetchConfig: vi.fn() })).toBeNull();
    const failing = vi.fn(async () => {
      throw new Error("down");
    });
    expect(await loadSignedInUser({ token: "AT", apiBase: "", fetchFn: failing as unknown as typeof fetch, fetchConfig: vi.fn() })).toBeNull();
  });
});
