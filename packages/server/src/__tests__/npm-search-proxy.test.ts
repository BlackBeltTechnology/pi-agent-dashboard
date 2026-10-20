import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { searchPackages, fetchReadme, PackageNotFoundError, clearCaches, deriveSkillIds } from "../package/npm-search-proxy.js";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function npmSearchResponse(objects: any[]) {
  return { ok: true, status: 200, json: async () => ({ objects, total: objects.length }) };
}

function npmRegistryResponse(data: any) {
  return { ok: true, status: 200, json: async () => data };
}

const sampleObject = {
  package: {
    name: "pi-doom",
    description: "Doom for pi",
    version: "1.0.0",
    keywords: ["pi-package", "extension", "pi-extension"],
    date: "2025-01-01",
    publisher: { username: "test" },
    links: { npm: "https://npmjs.com/package/pi-doom" },
  },
  downloads: { weekly: 100, monthly: 400 },
};

const skillObject = {
  package: {
    name: "pi-review",
    description: "Code review skill",
    version: "2.0.0",
    keywords: ["pi-package", "skill"],
    date: "2025-02-01",
    publisher: { username: "test2" },
    links: {},
  },
  downloads: { weekly: 50, monthly: 200 },
};

describe("npm-search-proxy", () => {
  beforeEach(() => {
    clearCaches();
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("searchPackages", () => {
    it("returns packages from npm search", async () => {
      mockFetch.mockResolvedValueOnce(npmSearchResponse([sampleObject, skillObject]));

      const result = await searchPackages();

      expect(mockFetch).toHaveBeenCalledOnce();
      expect(result.packages).toHaveLength(2);
      expect(result.packages[0].name).toBe("pi-doom");
      expect(result.packages[0].types).toContain("extension");
      expect(result.packages[1].name).toBe("pi-review");
      expect(result.packages[1].types).toContain("skill");
    });

    it("filters by type", async () => {
      mockFetch.mockResolvedValueOnce(npmSearchResponse([sampleObject, skillObject]));

      const result = await searchPackages({ type: "skill" });

      expect(result.packages).toHaveLength(1);
      expect(result.packages[0].name).toBe("pi-review");
    });

    it("includes query in search text", async () => {
      mockFetch.mockResolvedValueOnce(npmSearchResponse([]));

      await searchPackages({ query: "doom" });

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("keywords%3Api-package");
      expect(calledUrl).toContain("doom");
    });

    // test-plan #E66 (task 5.12)
    describe("dashboard-plugin type", () => {
      const quota = {
        package: { name: "pi-dashboard-quota", description: "Quota", version: "1.0.0", keywords: ["pi-dashboard-plugin"], date: "2025-03-01", links: {} },
      };

      it("searches the dashboard-plugin keyword and keeps keyword results typed dashboard-plugin", async () => {
        mockFetch.mockResolvedValueOnce(npmSearchResponse([quota, sampleObject]));

        const result = await searchPackages({ query: "quota", type: "dashboard-plugin" });

        const calledUrl = decodeURIComponent(mockFetch.mock.calls[0][0] as string);
        expect(calledUrl).toContain("text=keywords:pi-dashboard-plugin quota");
        expect(calledUrl).not.toContain("keywords:pi-package");
        expect(result.packages.map((p) => p.name)).toEqual(["pi-dashboard-quota"]);
        expect(result.packages[0].types).toContain("dashboard-plugin");
      });

      it("the default (and other types) keep the pi-package keyword", async () => {
        mockFetch.mockResolvedValue(npmSearchResponse([sampleObject]));
        await searchPackages({ query: "doom" });
        await searchPackages({ query: "doom", type: "extension" });
        for (const call of mockFetch.mock.calls) {
          expect(decodeURIComponent(call[0] as string)).toContain("text=keywords:pi-package doom");
        }
      });

      it("the cache is keyed by type + query, and expires after 5 minutes", async () => {
        vi.useFakeTimers();
        try {
          vi.setSystemTime(0);
          mockFetch.mockResolvedValue(npmSearchResponse([quota]));
          await searchPackages({ query: "q", type: "dashboard-plugin" });
          await searchPackages({ query: "q", type: "extension" });
          expect(mockFetch).toHaveBeenCalledTimes(2); // same q, different type → separate entries
          vi.setSystemTime(4 * 60_000 + 59_999);
          await searchPackages({ query: "q", type: "dashboard-plugin" });
          expect(mockFetch).toHaveBeenCalledTimes(2); // hit
          vi.setSystemTime(5 * 60_000 + 1);
          await searchPackages({ query: "q", type: "dashboard-plugin" });
          expect(mockFetch).toHaveBeenCalledTimes(3); // miss
        } finally {
          vi.useRealTimers();
        }
      });
    });

    it("returns cached result on second call", async () => {
      mockFetch.mockResolvedValueOnce(npmSearchResponse([sampleObject]));

      const first = await searchPackages({ query: "test" });
      const second = await searchPackages({ query: "test" });

      expect(mockFetch).toHaveBeenCalledOnce();
      expect(second).toEqual(first);
    });

    it("re-fetches after cache is cleared", async () => {
      mockFetch.mockResolvedValue(npmSearchResponse([sampleObject]));

      await searchPackages({ query: "x" });
      clearCaches();
      await searchPackages({ query: "x" });

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("throws on non-ok response", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 503 });

      await expect(searchPackages()).rejects.toThrow("npm search failed: 503");
    });
  });

  describe("fetchReadme", () => {
    it("returns readme from npm registry", async () => {
      mockFetch.mockResolvedValueOnce(npmRegistryResponse({
        name: "pi-doom",
        readme: "# Pi Doom\nPlay doom in pi.",
        "dist-tags": { latest: "1.2.3" },
      }));

      const result = await fetchReadme("pi-doom");

      expect(result.name).toBe("pi-doom");
      expect(result.readme).toContain("Pi Doom");
      expect(result.version).toBe("1.2.3");
    });

    it("throws PackageNotFoundError on 404", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

      await expect(fetchReadme("nonexistent")).rejects.toThrow(PackageNotFoundError);
    });

    it("caches readme", async () => {
      mockFetch.mockResolvedValueOnce(npmRegistryResponse({
        name: "pi-doom",
        readme: "# Cached",
        "dist-tags": { latest: "1.0.0" },
      }));

      await fetchReadme("pi-doom");
      const second = await fetchReadme("pi-doom");

      expect(mockFetch).toHaveBeenCalledOnce();
      expect(second.readme).toBe("# Cached");
    });

    it("throws on non-404 error", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

      await expect(fetchReadme("broken")).rejects.toThrow("npm registry fetch failed: 500");
    });
  });

  describe("deriveSkillIds", () => {
    it("derives skill ids as the basename of each pi.skills path", () => {
      expect(
        deriveSkillIds([".pi/skills/document-converter", ".pi/skills/frontend-mockup-loop"]),
      ).toEqual(["document-converter", "frontend-mockup-loop"]);
    });

    it("returns undefined for missing, non-array, or empty input", () => {
      expect(deriveSkillIds(undefined)).toBeUndefined();
      expect(deriveSkillIds("nope")).toBeUndefined();
      expect(deriveSkillIds([])).toBeUndefined();
      expect(deriveSkillIds([42, null])).toBeUndefined();
    });

    it("tolerates trailing slashes and bare names", () => {
      expect(deriveSkillIds(["skills/foo/", "bar"])).toEqual(["foo", "bar"]);
    });

    it("skips convention container dirs (skills/skill) it cannot resolve", () => {
      expect(deriveSkillIds(["skills"])).toBeUndefined();
      expect(deriveSkillIds(["./skill"])).toBeUndefined();
      // A container mixed with a specific skill dir keeps only the resolvable one.
      expect(deriveSkillIds(["skills", ".pi/skills/document-converter"])).toEqual([
        "document-converter",
      ]);
    });
  });
});
