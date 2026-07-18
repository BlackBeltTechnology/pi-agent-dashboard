/**
 * Tests for `pi-dev-version-check.ts`.
 *
 * See change: improve-pi-update-detection.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  parsePackageVersion,
  comparePackageVersions,
  isNewerPackageVersion,
  getPiUserAgent,
  getLatestPiRelease,
} from "../pi/pi-dev-version-check.js";

describe("parsePackageVersion", () => {
  it("parses plain semver", () => {
    expect(parsePackageVersion("0.70.6")).toEqual({
      major: 0,
      minor: 70,
      patch: 6,
      prerelease: undefined,
    });
  });

  it("parses semver with v prefix", () => {
    expect(parsePackageVersion("v1.2.3")).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: undefined,
    });
  });

  it("parses semver with prerelease", () => {
    expect(parsePackageVersion("0.71.0-rc.1")).toEqual({
      major: 0,
      minor: 71,
      patch: 0,
      prerelease: "rc.1",
    });
  });

  it("returns undefined for unparseable", () => {
    expect(parsePackageVersion("not-a-version")).toBeUndefined();
    expect(parsePackageVersion("")).toBeUndefined();
  });
});

describe("comparePackageVersions", () => {
  it("orders by major then minor then patch", () => {
    expect(comparePackageVersions("0.70.6", "0.74.0")).toBeLessThan(0);
    expect(comparePackageVersions("1.0.0", "0.99.99")).toBeGreaterThan(0);
    expect(comparePackageVersions("0.70.6", "0.70.6")).toBe(0);
  });

  it("treats prerelease as less than full release", () => {
    expect(comparePackageVersions("0.71.0-rc.1", "0.71.0")).toBeLessThan(0);
    expect(comparePackageVersions("0.71.0", "0.71.0-rc.1")).toBeGreaterThan(0);
  });

  it("returns undefined for unparseable", () => {
    expect(comparePackageVersions("nope", "0.0.1")).toBeUndefined();
  });
});

describe("isNewerPackageVersion", () => {
  it("true when candidate is strictly newer", () => {
    expect(isNewerPackageVersion("0.74.0", "0.70.6")).toBe(true);
  });

  it("false when candidate is same or older", () => {
    expect(isNewerPackageVersion("0.70.6", "0.70.6")).toBe(false);
    expect(isNewerPackageVersion("0.70.5", "0.70.6")).toBe(false);
  });

  it("falls back to string-inequality when unparseable", () => {
    expect(isNewerPackageVersion("nightly-abc", "nightly-abc")).toBe(false);
    expect(isNewerPackageVersion("nightly-xyz", "nightly-abc")).toBe(true);
  });
});

describe("getPiUserAgent", () => {
  it("formats as pi/<version> (<platform>; <runtime>; <arch>)", () => {
    const ua = getPiUserAgent("0.70.6", "node/v22.20.0");
    expect(ua).toMatch(/^pi\/0\.70\.6 \([a-z0-9]+; node\/v22\.20\.0; [a-z0-9]+\)$/);
  });

  it("auto-detects current Node runtime when not provided", () => {
    const ua = getPiUserAgent("0.70.6");
    expect(ua).toContain("pi/0.70.6");
    // process.version is something like "v22.x.y"
    expect(ua).toContain(`node/${process.version}`);
  });
});

describe("getLatestPiRelease", () => {
  let originalSkip: string | undefined;
  let originalOffline: string | undefined;

  beforeEach(() => {
    originalSkip = process.env.PI_SKIP_VERSION_CHECK;
    originalOffline = process.env.PI_OFFLINE;
    delete process.env.PI_SKIP_VERSION_CHECK;
    delete process.env.PI_OFFLINE;
  });

  afterEach(() => {
    if (originalSkip !== undefined) process.env.PI_SKIP_VERSION_CHECK = originalSkip;
    else delete process.env.PI_SKIP_VERSION_CHECK;
    if (originalOffline !== undefined) process.env.PI_OFFLINE = originalOffline;
    else delete process.env.PI_OFFLINE;
  });

  it("returns parsed { version, packageName } on success", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: "0.74.0", packageName: "@earendil-works/pi-coding-agent" }),
    });
    const out = await getLatestPiRelease("0.70.6", { fetchImpl });
    expect(out).toEqual({ version: "0.74.0", packageName: "@earendil-works/pi-coding-agent" });
  });

  it("returns undefined when packageName is absent", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: "0.70.6" }),
    });
    const out = await getLatestPiRelease("0.70.6", { fetchImpl });
    expect(out).toEqual({ version: "0.70.6", packageName: undefined });
  });

  it("sends User-Agent matching pi's format", async () => {
    let capturedUA: string | undefined;
    const fetchImpl = vi.fn().mockImplementation((_url: string, opts: any) => {
      capturedUA = opts.headers?.["User-Agent"];
      return Promise.resolve({
        ok: true,
        json: async () => ({ version: "0.74.0" }),
      });
    });
    await getLatestPiRelease("0.70.6", { fetchImpl });
    expect(capturedUA).toMatch(/^pi\/0\.70\.6 \([a-z0-9]+; node\/v[\d.]+; [a-z0-9]+\)$/);
  });

  it("returns undefined on non-2xx", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
    expect(await getLatestPiRelease("0.70.6", { fetchImpl })).toBeUndefined();
  });

  it("returns undefined on network error", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    expect(await getLatestPiRelease("0.70.6", { fetchImpl })).toBeUndefined();
  });

  it("returns undefined on missing version field", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ packageName: "@x/y" }),
    });
    expect(await getLatestPiRelease("0.70.6", { fetchImpl })).toBeUndefined();
  });

  it("returns undefined on empty version field", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: "   " }),
    });
    expect(await getLatestPiRelease("0.70.6", { fetchImpl })).toBeUndefined();
  });

  it("skips request when PI_OFFLINE is set", async () => {
    process.env.PI_OFFLINE = "1";
    const fetchImpl = vi.fn();
    expect(await getLatestPiRelease("0.70.6", { fetchImpl })).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("skips request when PI_SKIP_VERSION_CHECK is set", async () => {
    process.env.PI_SKIP_VERSION_CHECK = "1";
    const fetchImpl = vi.fn();
    expect(await getLatestPiRelease("0.70.6", { fetchImpl })).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
