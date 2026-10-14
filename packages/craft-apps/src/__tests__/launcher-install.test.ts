import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { installerAsset, installLauncher, LAUNCHER_REPO } from "../launcher-install.js";
import type { ProvisionDeps } from "../provision.js";
import { cleanupTmp, type Fixture, sha256, startFixture, tmpDir } from "./helpers/fixtures.js";

const fixtures: Fixture[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) await f.close();
  cleanupTmp();
});

describe("installerAsset", () => {
  it("maps hosts to the artcraft-launcher release assets (probed on v0.4.1)", () => {
    expect(installerAsset("darwin", "arm64", "0.4.1")).toEqual({ name: "artcraft-launcher-0.4.1-macos-universal.dmg", handoff: "open-dmg" });
    expect(installerAsset("win32", "x64", "0.4.1").name).toBe("artcraft-launcher-0.4.1-windows-x64.msi");
    expect(installerAsset("linux", "arm64", "0.4.1").name).toBe("artcraft-launcher-0.4.1-linux-aarch64.AppImage");
    expect(() => installerAsset("freebsd", "x64", "0.4.1")).toThrow(/no Craft Launcher installer/);
  });
});

describe("pi-craft launcher install", () => {
  async function setup(dmg: Buffer, sums?: string) {
    const name = "artcraft-launcher-0.4.1-macos-universal.dmg";
    const fx = await startFixture({ repo: LAUNCHER_REPO, tag: "v0.4.1", assets: { [name]: dmg }, ...(sums !== undefined ? { sums } : {}) });
    fixtures.push(fx);
    const home = tmpDir();
    const calls: string[][] = [];
    const deps = (): ProvisionDeps =>
      ({
        env: { CRAFT_HOME: home },
        platform: "darwin",
        arch: "arm64",
        fetch: (...a: Parameters<typeof fetch>) => fetch(...a),
        now: () => Date.now(),
        homedir: () => home,
        exec: async (file: string, args: string[]) => {
          calls.push([file, ...args]);
          return { stdout: "", stderr: "" };
        },
        glibcVersion: () => undefined,
        log: () => {},
        apiBase: fx.url,
        probeVersion: false,
        randomId: () => "r",
      }) as ProvisionDeps;
    return { fx, home, calls, deps, name };
  }

  it("downloads, verifies and hands the dmg to the OS; only the installer and SHA256SUMS.txt are fetched", async () => {
    const s = await setup(Buffer.from("fake dmg"));
    const r = await installLauncher(s.deps());
    expect(r).toMatchObject({ version: "0.4.1", asset: s.name, handoff: "open-dmg" });
    expect(fs.readFileSync(r.file, "utf8")).toBe("fake dmg");
    expect(s.calls).toEqual([["open", r.file]]);
    expect(s.fx.requests.filter((q) => q.url.startsWith("/download")).map((q) => q.url).sort()).toEqual([`/download/v0.4.1/${s.name}`, "/download/v0.4.1/SHA256SUMS.txt"].sort());
  });

  it("a digest mismatch deletes the file, opens nothing and fails (CLI maps it to exit 69)", async () => {
    const s = await setup(Buffer.from("fake dmg"), `${"0".repeat(64)}  artcraft-launcher-0.4.1-macos-universal.dmg\n`);
    await expect(installLauncher(s.deps())).rejects.toThrow(/checksum mismatch/);
    expect(s.calls).toEqual([]);
    expect(fs.existsSync(path.join(s.home, "craft-launcher", "0.4.1", s.name))).toBe(false);
  });

  it("a missing SHA256SUMS.txt fails closed", async () => {
    const s = await setup(Buffer.from("x"), undefined);
    await s.fx.close();
    fixtures.pop();
    const fx2 = await startFixture({ repo: LAUNCHER_REPO, tag: "v0.4.1", assets: { [s.name]: Buffer.from("x") }, sums: null });
    fixtures.push(fx2);
    await expect(installLauncher({ ...s.deps(), apiBase: fx2.url })).rejects.toThrow(/SHA256SUMS|HTTP 404/);
    expect(s.calls).toEqual([]);
    expect(sha256("x")).toHaveLength(64);
  });
});
