/**
 * `downloadUrl` + `startDownload` delivery (test-plan #E11–#E13, #X1, #X2).
 * See change: add-file-download.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const base = vi.hoisted(() => ({ value: "" }));
vi.mock("../../../lib/api/api-context.js", () => ({ getApiBase: () => base.value }));

import { startDownload } from "../download.js";
import { downloadUrl } from "../raw-url.js";

const TARGET = { cwd: "/Users/u/proj", path: "notes/summary.md" };

let clicks: Array<{ href: string; download: string }>;
const originalFetch = globalThis.fetch;

beforeEach(() => {
  base.value = "";
  clicks = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    clicks.push({ href: this.getAttribute("href") ?? "", download: this.download });
  });
  URL.createObjectURL = vi.fn(() => "blob:mock-1");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

const stubFetch = (impl: () => Promise<unknown>) => {
  const f = vi.fn(impl);
  globalThis.fetch = f as unknown as typeof fetch;
  return f;
};

describe("downloadUrl", () => {
  it("E13 encodes cwd and path and adds download=1", () => {
    expect(downloadUrl(TARGET)).toBe("/api/file/raw?cwd=%2FUsers%2Fu%2Fproj&path=notes%2Fsummary.md&download=1");
  });
});

describe("startDownload delivery", () => {
  it.each([
    ["", false, "link"],
    ["", true, "blob"],
    ["https://paired.example", false, "blob"],
    ["https://paired.example", true, "blob"],
  ] as const)("E11 base=%j outsideCwd=%s → %s path", async (apiBase, outsideCwd, mode) => {
    base.value = apiBase;
    const f = stubFetch(async () => new Response("hello"));
    await startDownload(TARGET, { outsideCwd });
    if (mode === "link") {
      expect(f).not.toHaveBeenCalled();
      expect(clicks).toEqual([{ href: downloadUrl(TARGET), download: "" }]);
    } else {
      expect(f).toHaveBeenCalledWith(downloadUrl(TARGET));
    }
  });

  it("E12 Blob success saves under the basename and revokes the same object URL", async () => {
    base.value = "https://paired.example";
    stubFetch(async () => new Response("hello"));
    await startDownload(TARGET, { outsideCwd: false });
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(clicks).toEqual([{ href: "blob:mock-1", download: "summary.md" }]);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock-1");
    expect(document.querySelector("a[download]")).toBeNull();
  });

  it("X1 HTTP failure (404 then 403) toasts, saves nothing", async () => {
    base.value = "https://paired.example";
    const showToast = vi.fn();
    for (const status of [404, 403]) {
      stubFetch(async () => new Response("no", { status }));
      await startDownload(TARGET, { outsideCwd: false, showToast });
    }
    expect(showToast).toHaveBeenCalledTimes(2);
    expect(showToast).toHaveBeenCalledWith("Download failed", "error");
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(clicks).toEqual([]);
  });

  it("X2 network failure toasts, saves nothing, does not reject", async () => {
    base.value = "https://paired.example";
    const showToast = vi.fn();
    stubFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(startDownload(TARGET, { outsideCwd: true, showToast })).resolves.toBeUndefined();
    expect(showToast).toHaveBeenCalledWith("Download failed", "error");
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(clicks).toEqual([]);
  });
});
