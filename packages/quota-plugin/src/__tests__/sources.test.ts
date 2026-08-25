/**
 * Capability-table semantics: which peer serves which provider, and what the
 * settings UI may let the user tick.
 * See change: add-provider-quota-plugin.
 */
import { describe, expect, it } from "vitest";
import {
  isProviderServable,
  PROVIDER_SOURCES,
  requiredPackagesFor,
  resolveSource,
  SOURCE_PACKAGES,
  TRACKED_PROVIDERS,
  peerProviderId,
} from "../sources.js";

describe("PROVIDER_SOURCES table", () => {
  it("never lets pi-quotas serve anthropic (its sk-ant- guard makes it impossible)", () => {
    expect(PROVIDER_SOURCES.anthropic).toEqual(["usage-bars"]);
    expect(resolveSource("anthropic", ["pi-quotas"])).toBeNull();
    expect(isProviderServable("anthropic", ["pi-quotas"])).toBe(false);
  });

  it("serves anthropic from usage-bars", () => {
    expect(resolveSource("anthropic", ["usage-bars"])).toBe("usage-bars");
    expect(resolveSource("anthropic", ["pi-quotas", "usage-bars"])).toBe("usage-bars");
  });

  it("keeps copilot/synthetic/opencode-go on pi-quotas only", () => {
    for (const p of ["github-copilot", "synthetic", "opencode-go"]) {
      expect(PROVIDER_SOURCES[p]).toEqual(["pi-quotas"]);
      expect(isProviderServable(p, ["usage-bars"])).toBe(false);
      expect(resolveSource(p, ["pi-quotas", "usage-bars"])).toBe("pi-quotas");
    }
  });

  it("prefers pi-quotas for dual-source providers but falls back to usage-bars", () => {
    for (const p of ["openai-codex", "openrouter", "zai", "kimi-coding"]) {
      expect(resolveSource(p, ["pi-quotas", "usage-bars"])).toBe("pi-quotas");
      expect(resolveSource(p, ["usage-bars"])).toBe("usage-bars");
      expect(resolveSource(p, ["pi-quotas"])).toBe("pi-quotas");
    }
  });

  it("serves nothing when no peer is installed", () => {
    for (const p of TRACKED_PROVIDERS) {
      expect(resolveSource(p, [])).toBeNull();
      expect(isProviderServable(p, [])).toBe(false);
    }
  });

  it("every provider is servable by at least one source", () => {
    for (const p of TRACKED_PROVIDERS) {
      expect(PROVIDER_SOURCES[p].length).toBeGreaterThan(0);
      expect(isProviderServable(p, ["pi-quotas", "usage-bars"])).toBe(true);
    }
  });

  it("names the packages a disabled provider would need", () => {
    expect(requiredPackagesFor("anthropic")).toEqual(["@hk_net/pi-usage-bars"]);
    expect(requiredPackagesFor("github-copilot")).toEqual(["@latentminds/pi-quotas"]);
    expect(requiredPackagesFor("zai")).toEqual([
      "@latentminds/pi-quotas",
      "@hk_net/pi-usage-bars",
    ]);
    expect(requiredPackagesFor("unknown-provider")).toEqual([]);
  });

  it("maps canonical ids onto the peer's own provider names", () => {
    expect(peerProviderId("usage-bars", "anthropic")).toBe("claude");
    expect(peerProviderId("usage-bars", "kimi-coding")).toBe("kimi");
    expect(peerProviderId("usage-bars", "openai-codex")).toBe("codex");
    // No alias → identity.
    expect(peerProviderId("usage-bars", "zai")).toBe("zai");
    expect(peerProviderId("pi-quotas", "anthropic")).toBe("anthropic");
  });

  it("declares a package for every source referenced by the table", () => {
    for (const sources of Object.values(PROVIDER_SOURCES)) {
      for (const s of sources) expect(SOURCE_PACKAGES[s]).toBeTruthy();
    }
  });
});
