/**
 * Tests for the provider-catalogue cache.
 *
 * The cache is now a single global snapshot of the most-recent
 * `providers_list` push. No per-session split, no `changed` signal —
 * see change: simplify-model-selection-channels for why.
 */

import type { ProviderInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetForTests,
  getLatestCatalogue,
  isCatalogueReady,
  setCatalogueForSession,
} from "../package/provider-catalogue-cache.js";

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

// Test-plan #E9. See change: fix-provider-catalogue-first-run (D2).
describe("provider-catalogue-cache: empty push", () => {
  beforeEach(() => _resetForTests());
  afterEach(() => vi.restoreAllMocks());

  it("(a) an empty push with nothing held leaves the catalogue not ready", () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    setCatalogueForSession("s1", []);
    setCatalogueForSession("s1", []);
    expect(isCatalogueReady()).toBe(false);
    expect(getLatestCatalogue()).toEqual([]);
    expect(debug).toHaveBeenCalledTimes(1);
  });

  it("(b) an empty push keeps the held snapshot and stays ready", () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    setCatalogueForSession("s1", [A]);
    setCatalogueForSession("s1", []);
    setCatalogueForSession("s1", []);
    expect(isCatalogueReady()).toBe(true);
    expect(getLatestCatalogue()).toEqual([A]);
    expect(debug).toHaveBeenCalledTimes(1);
  });
});
