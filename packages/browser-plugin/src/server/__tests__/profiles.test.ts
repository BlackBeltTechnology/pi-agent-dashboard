/**
 * Chrome profile discovery (change: add-browser-relay) — test-plan #E17
 * (listing) + #X9 (missing/corrupt Local State).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listChromeProfiles as listChromeProfilesShared } from "@blackbelt-technology/pi-dashboard-shared/chrome-profiles.js";
import { describe, expect, it, vi } from "vitest";
import { detectPasswordManagers, listChromeProfiles } from "../profiles.js";

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
      { profileDirectory: "Profile 3", label: "Profile 3", installed: false, passwordManagers: [] },
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
      { profileDirectory: "Default", label: "Default", installed: false, passwordManagers: [] },
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
    expect(result.profiles[0]).toEqual({
      profileDirectory: "Default",
      label: "Default",
      installed: false,
      passwordManagers: [],
    });
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

/**
 * #E52 — the plugin (vendored `installed` probe) and the shared helper (the
 * Electron host's copy) must produce identical rows from the same on-disk
 * fixtures. See change: add-operator-browser-relay (D8).
 */
describe("plugin ↔ shared parity (E52)", () => {
  const EXT = "mmlmfjhmonkocbjadbfplnigmagldckm";

  function withUserDataDir(setup: (dir: string) => void): { dir: string; done: () => void } {
    const dir = mkdtempSync(join(tmpdir(), "chrome-parity-"));
    setup(dir);
    return { dir, done: () => rmSync(dir, { recursive: true, force: true }) };
  }

  const fixtures: Array<[string, (dir: string) => void]> = [
    [
      "duplicate labels + email + one installed via Extensions dir",
      (dir) => {
        writeFileSync(
          join(dir, "Local State"),
          JSON.stringify({
            profile: {
              info_cache: {
                Default: { name: "Person 1" },
                "Profile 1": { name: "Person 1" },
                "Profile 2": { name: "Work", user_name: "me@corp.test" },
              },
            },
          }),
        );
        mkdirSync(join(dir, "Profile 1", "Extensions", EXT), { recursive: true });
      },
    ],
    [
      "installed via a populated Preferences record, label fallback",
      (dir) => {
        writeFileSync(join(dir, "Local State"), JSON.stringify({ profile: { info_cache: { "Profile 3": {} } } }));
        mkdirSync(join(dir, "Profile 3"), { recursive: true });
        writeFileSync(
          join(dir, "Profile 3", "Preferences"),
          JSON.stringify({ extensions: { settings: { [EXT]: { state: 1 } } } }),
        );
      },
    ],
    [
      "unparseable Local State → synthetic Default + warning",
      (dir) => {
        writeFileSync(join(dir, "Local State"), "{not json");
        mkdirSync(join(dir, "Default", "Extensions"), { recursive: true });
      },
    ],
  ];

  for (const [name, setup] of fixtures) {
    it(`identical rows: ${name}`, async () => {
      const { dir, done } = withUserDataDir(setup);
      try {
        const viaPlugin = await listChromeProfiles({ userDataDir: dir });
        const viaShared = await listChromeProfilesShared({ userDataDir: dir });
        // The plugin adds `passwordManagers` (change: add-dedicated-agent-browser, D10);
        // every shared field must still be identical.
        expect(viaPlugin.profiles.map(({ passwordManagers: _pm, ...row }) => row)).toEqual(viaShared.profiles);
        expect(viaPlugin.warning).toEqual(viaShared.warning);
      } finally {
        done();
      }
    });
  }
});

/**
 * #E16 — password-manager detection from `<profile>/Extensions/<id>`.
 * See change: add-dedicated-agent-browser (tasks 1.3, 9.16).
 */
describe("passwordManagers (E16)", () => {
  const LASTPASS = "hdokiejnpimakedhajhdlcegeplioahd";
  const ICLOUD = "pejdijmoenmkgeppbflobdenhhabjlaj";

  it("reports LastPass / iCloud Passwords / both / none per profile from a fixture tree", async () => {
    const dir = mkdtempSync(join(tmpdir(), "chrome-pm-"));
    try {
      writeFileSync(
        join(dir, "Local State"),
        JSON.stringify({
          profile: { info_cache: { Default: {}, "Profile 1": {}, "Profile 2": {}, "Profile 3": {} } },
        }),
      );
      mkdirSync(join(dir, "Default", "Extensions", LASTPASS), { recursive: true });
      mkdirSync(join(dir, "Profile 1", "Extensions", ICLOUD), { recursive: true });
      mkdirSync(join(dir, "Profile 2", "Extensions", ICLOUD), { recursive: true });
      mkdirSync(join(dir, "Profile 2", "Extensions", LASTPASS), { recursive: true });
      mkdirSync(join(dir, "Profile 3", "Extensions", "someotherextensionidxxxxxxxxxxxx"), { recursive: true });

      const { profiles } = await listChromeProfiles({ userDataDir: dir, isInstalled: () => false });
      const byDir = Object.fromEntries(profiles.map((p) => [p.profileDirectory, p.passwordManagers]));
      expect(byDir).toEqual({
        Default: ["LastPass"],
        "Profile 1": ["iCloud Passwords"],
        "Profile 2": ["LastPass", "iCloud Passwords"],
        "Profile 3": [],
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("detectPasswordManagers uses the injected exists seam", () => {
    expect(detectPasswordManagers("/p/Default", (q) => q === `/p/Default/Extensions/${ICLOUD}`)).toEqual([
      "iCloud Passwords",
    ]);
  });

  it("the synthetic Default fallback row also carries passwordManagers", async () => {
    const result = await listChromeProfiles({
      userDataDir: USER_DATA,
      exists: (p) => p === `${USER_DATA}/Default/Extensions/${LASTPASS}`,
      readFile: () => {
        throw new Error("unreadable");
      },
      isInstalled: () => false,
    });
    expect(result.profiles[0].passwordManagers).toEqual(["LastPass"]);
  });
});
