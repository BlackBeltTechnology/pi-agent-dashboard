import { describe, expect, it } from "vitest";
import { buildChromeOpenCommand, chromeUserDataDir, listChromeProfiles } from "../chrome-profiles.js";

describe("chrome-profiles (shared)", () => {
  it("buildChromeOpenCommand keeps profileDirectory as one argv element", () => {
    const c = buildChromeOpenCommand("darwin", "Profile 1; rm -rf", "chrome-extension://x/connect.html");
    expect(c.cmd).toBe("open");
    expect(c.args).toContain("--profile-directory=Profile 1; rm -rf");
    expect(buildChromeOpenCommand("linux", "Default", "u").cmd).toBe("google-chrome");
    expect(buildChromeOpenCommand("win32", "Default", "u").cmd).toBe("chrome.exe");
  });

  it("chromeUserDataDir per platform", () => {
    expect(chromeUserDataDir("darwin", { HOME: "/h" })).toBe("/h/Library/Application Support/Google/Chrome");
    expect(chromeUserDataDir("linux", { HOME: "/h" })).toBe("/h/.config/google-chrome");
    expect(chromeUserDataDir("win32", { LOCALAPPDATA: "C:\\L" })).toBe("C:\\L\\Google\\Chrome\\User Data");
  });

  it("parses info_cache rows with label/email and the installed probe", async () => {
    const r = await listChromeProfiles({
      userDataDir: "/ud",
      exists: () => true,
      readFile: () =>
        JSON.stringify({ profile: { info_cache: { Default: { name: "Me", user_name: "a@b.c" }, "Profile 1": {} } } }),
      isInstalled: (d) => d.endsWith("Default"),
    });
    expect(r.profiles).toEqual([
      { profileDirectory: "Default", label: "Me", email: "a@b.c", installed: true },
      { profileDirectory: "Profile 1", label: "Profile 1", installed: false },
    ]);
  });

  it("degrades to a synthetic Default row + warning", async () => {
    const r = await listChromeProfiles({ userDataDir: "/ud", exists: () => false });
    expect(r.profiles[0]?.profileDirectory).toBe("Default");
    expect(r.warning).toContain("Local State");
  });
});
