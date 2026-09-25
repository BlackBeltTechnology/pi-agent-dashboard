import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchLoginConfig, providerById } from "../login-config.js";

const reply = (body: unknown, ok = true) => vi.stubGlobal("fetch", vi.fn(async () => ({ ok, json: async () => body }) as Response));

afterEach(() => vi.unstubAllGlobals());

describe("fetchLoginConfig (D25: several login providers)", () => {
  it("inactive / error / non-2xx ⇒ {active:false, providers:[]}", async () => {
    reply({ active: false });
    expect(await fetchLoginConfig()).toEqual({ active: false, providers: [] });
    reply({}, false);
    expect(await fetchLoginConfig()).toEqual({ active: false, providers: [] });
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("down"))));
    expect(await fetchLoginConfig()).toEqual({ active: false, providers: [] });
  });

  it("lists every provider with only the vetted fields", async () => {
    const kc = { pluginId: "idl", loginUrl: "/idl/start", tokenUrl: "/idl/token", label: "Keycloak", silentSignIn: true };
    const gh = { pluginId: "gh", loginUrl: "/gh/start", label: "GitHub", endsProviderSession: false, evil: "x" };
    reply({ active: true, ...kc, providers: [kc, gh] });
    const c = await fetchLoginConfig();
    expect(c.providers).toEqual([kc, { pluginId: "gh", loginUrl: "/gh/start", label: "GitHub", endsProviderSession: false }]);
    expect(c).toMatchObject({ active: true, pluginId: "idl", label: "Keycloak" }); // top-level = first
  });

  it("an older server (no providers list) reads as one provider", async () => {
    reply({ active: true, pluginId: "idl", loginUrl: "/idl/start", label: "Keycloak" });
    expect((await fetchLoginConfig()).providers).toEqual([{ pluginId: "idl", loginUrl: "/idl/start", label: "Keycloak" }]);
  });

  it("drops a provider entry without a pluginId", async () => {
    reply({ active: true, pluginId: "idl", loginUrl: "/a", providers: [{ loginUrl: "/x" }, { pluginId: "idl", loginUrl: "/a" }] });
    expect((await fetchLoginConfig()).providers.map((p) => p.pluginId)).toEqual(["idl"]);
  });
});

describe("providerById", () => {
  const cfg = { active: true, providers: [{ pluginId: "a" }, { pluginId: "b" }] };
  it("finds by id, else undefined", () => {
    expect(providerById(cfg, "b")).toEqual({ pluginId: "b" });
    expect(providerById(cfg, "zz")).toBeUndefined();
    expect(providerById(cfg, undefined)).toBeUndefined();
  });
});
