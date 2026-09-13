/**
 * Chrome profile discovery (change: add-browser-relay) — test-plan #E17
 * (listing) + #X9 (missing/corrupt Local State).
 */
import { describe, expect, it, vi } from "vitest";
import { listChromeProfiles } from "../profiles.js";

/** In-memory fs seam — no tmpfs needed, and it lets a test make a path "exist". */
function fakeFs(files: Record<string, string>, dirs: string[] = []) {
  const dirSet = new Set([...dirs, ...Object.keys(files).map((p) => p.split("/").slice(0, -1).join("/"))]);
  const exists = (p: string) => dirSet.has(p) || Object.hasOwn(files, p);
  return { exists, readFile: (p: string) => files[p] };
}

const USER_DATA = "/home/u/.config/google-chrome";
const LOCAL_STATE = `${USER_DATA}/Local State`;

describe("listChromeProfiles (E17)", () => {
  it("lists every info_cache profile keyed by profileDirectory, preserving duplicate labels", async () => {
    const localState = JSON.stringify({
      profile: {
        info_cache: {
          Default: { name: "Person 1" },
          "Profile 1": { name: "Person 1" },
          "Profile 2": { name: "Work", user_name: "me@corp.test" },
        },
      },
    });
    const installedDirs: string[] = [`${USER_DATA}/Profile 1/Extensions`];
    const result = await listChromeProfiles({
      userDataDir: USER_DATA,
      ...fakeFs({ [LOCAL_STATE]: localState }, installedDirs),
      isInstalled: (dir: string) => dir.endsWith("/Profile 1"),
    });

    expect(result.warning).toBeUndefined();
    expect(result.profiles.map((p) => p.profileDirectory)).toEqual([
      "Default",
      "Profile 1",
      "Profile 2",
    ]);
    // Duplicate labels are KEPT (that is why the key is the directory).
    expect(result.profiles[0].label).toBe("Person 1");
    expect(result.profiles[1].label).toBe("Person 1");
    // Email only where Chrome wrote one.
    expect(result.profiles[2].email).toBe("me@corp.test");
    expect(result.profiles[0].email).toBeUndefined();
    // installed exactly once.
    expect(result.profiles.filter((p) => p.installed).map((p) => p.profileDirectory)).toEqual([
      "Profile 1",
    ]);
  });

  it("falls back to the directory name when a profile has no label", async () => {
    const result = await listChromeProfiles({
      userDataDir: USER_DATA,
      ...fakeFs({ [LOCAL_STATE]: JSON.stringify({ profile: { info_cache: { "Profile 3": {} } } }) }),
      isInstalled: () => false,
    });
    expect(result.profiles).toEqual([
      { profileDirectory: "Profile 3", label: "Profile 3", installed: false },
    ]);
  });
});

describe("listChromeProfiles fallback (X9)", () => {
  it("userDataDir absent → one synthetic Default row + warning naming the path", async () => {
    const result = await listChromeProfiles({
      userDataDir: USER_DATA,
      exists: () => false,
      readFile: () => {
        throw new Error("should not read");
      },
      isInstalled: () => false,
    });
    expect(result.profiles).toEqual([
      { profileDirectory: "Default", label: "Default", installed: false },
    ]);
    expect(result.warning).toContain(`${USER_DATA}/Local State`);
  });

  it("unparseable Local State → one synthetic Default row + warning", async () => {
    const readFile = vi.fn(() => "{not json");
    const result = await listChromeProfiles({
      userDataDir: USER_DATA,
      exists: (p) => p === USER_DATA || p === LOCAL_STATE,
      readFile,
      isInstalled: () => false,
    });
    expect(result.profiles).toHaveLength(1);
    expect(result.profiles[0]).toEqual({ profileDirectory: "Default", label: "Default", installed: false });
    expect(result.warning).toContain(LOCAL_STATE);
    expect(readFile).toHaveBeenCalled();
  });

  it("an empty info_cache degrades too (Chrome only writes it for used profiles)", async () => {
    const result = await listChromeProfiles({
      userDataDir: USER_DATA,
      ...fakeFs({ [LOCAL_STATE]: JSON.stringify({ profile: { info_cache: {} } }) }),
      isInstalled: () => false,
    });
    expect(result.profiles).toHaveLength(1);
    expect(result.warning).toContain(LOCAL_STATE);
  });

  it("the synthetic row still checks the Default profile's Extensions dir", async () => {
    const result = await listChromeProfiles({
      userDataDir: USER_DATA,
      exists: (p) => p === `${USER_DATA}/Default/Extensions`,
      readFile: () => {
        throw new Error("unreadable");
      },
      isInstalled: () => false,
    });
    expect(result.profiles[0].installed).toBe(true);
  });
});
