/**
 * Tests for the provider-catalogue cache.
 *
 * The cache is now a single global snapshot of the most-recent
 * `providers_list` push. No per-session split, no `changed` signal —
 * see change: simplify-model-selection-channels for why.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  setCatalogueForSession,
  getLatestCatalogue,
  _resetForTests,
} from "../package/provider-catalogue-cache.js";
import type { ProviderInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";

const A: ProviderInfo = { id: "a", displayName: "A", hasOAuth: false, configured: false };
const B: ProviderInfo = { id: "b", displayName: "B", hasOAuth: false, configured: false };

describe("provider-catalogue-cache", () => {
  beforeEach(() => _resetForTests());

  it("getLatestCatalogue returns [] before any push", () => {
    expect(getLatestCatalogue()).toEqual([]);
  });

  it("setCatalogueForSession overwrites the global snapshot", () => {
    setCatalogueForSession("s1", [A]);
    expect(getLatestCatalogue()).toEqual([A]);
    setCatalogueForSession("s2", [B]);
    expect(getLatestCatalogue()).toEqual([B]);
  });

  it("last writer wins regardless of sessionId", () => {
    setCatalogueForSession("s1", [A, B]);
    setCatalogueForSession("s2", [A]);
    expect(getLatestCatalogue()).toEqual([A]);
  });

  it("_resetForTests clears the snapshot", () => {
    setCatalogueForSession("s1", [A]);
    _resetForTests();
    expect(getLatestCatalogue()).toEqual([]);
  });
});
