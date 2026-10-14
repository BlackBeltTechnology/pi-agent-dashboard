/**
 * Hardening found by the security audit of add-craft-apps-core: argument/command injection (Windows cmd.exe routing,
 * leading `-` / `scheme:` file names), hostile release metadata, post-extraction symlinks, unbounded downloads,
 * `.pi/mcp.json` symlink/clobber, probe timeouts.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { installLauncher, LAUNCHER_REPO } from "../launcher-install.js";
import { parseMcpArgs } from "../mcp-proxy.js";
import { registerMcp } from "../mcp-register.js";
import { API_BASE, assertTreeSafe, downloadFile, downloadVerified, exe, type ProvisionDeps, provision } from "../provision.js";
import { getApp } from "../registry.js";
import { parseVerifyArgs, runVerify } from "../verify.js";
import { cleanupTmp, type Fixture, makeTarGz, startFixture, tmpDir } from "./helpers/fixtures.js";

const fixtures: Fixture[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) await f.close();
  cleanupTmp();
});

const baseDeps = (over: Partial<ProvisionDeps> = {}): ProvisionDeps => {
  const home = tmpDir();
  return {
    env: { CRAFT_HOME: home },
    platform: "linux",
    arch: "x64",
    fetch: (...a: Parameters<typeof fetch>) => fetch(...a),
    now: () => Date.now(),
    homedir: () => home,
    exec: async () => ({ stdout: "", stderr: "" }),
    glibcVersion: () => "2.99",
    log: () => {},
    apiBase: API_BASE,
    probeVersion: false,
    randomId: () => "r",
    ...over,
  } as ProvisionDeps;
};

describe("Windows: system tools are spawned as .exe, never through cmd.exe", () => {
  it("exe() adds the suffix on win32 only", () => {
    expect(exe("ffprobe", "win32")).toBe("ffprobe.exe");
    expect(exe("tar", "win32")).toBe("tar.exe");
    expect(exe("tar", "linux")).toBe("tar");
    expect(exe("ffmpeg", "darwin")).toBe("ffmpeg");
  });

  it("launcher install hands the msi to msiexec.exe", async () => {
    const name = "artcraft-launcher-0.4.1-windows-x64.msi";
    const fx = await startFixture({ repo: LAUNCHER_REPO, tag: "v0.4.1", assets: { [name]: Buffer.from("msi") } });
    fixtures.push(fx);
    const calls: string[][] = [];
    await installLauncher(baseDeps({ platform: "win32", arch: "x64", apiBase: fx.url, exec: async (f, a) => (calls.push([f, ...a]), { stdout: "", stderr: "" }) }));
    expect(calls[0][0]).toBe("msiexec.exe");
  });
});

describe("verify: file and reference arguments", () => {
  it("file and --frame-diff ref become absolute paths (a leading '-' or 'scheme:' is never an option or a protocol)", () => {
    const p = parseVerifyArgs(["-weird.mp4", "--frame-diff", "0:http://evil/x.mp4>1", "--frame-diff", "1:-ref.mp4<1"]);
    if (!("assertions" in p)) throw new Error("expected assertions");
    expect(path.isAbsolute(p.file)).toBe(true);
    expect(p.file).toBe(path.resolve("-weird.mp4"));
    const refs = p.assertions.flatMap((a) => (a.kind === "frame-diff" ? [a.ref] : []));
    expect(refs.every((r) => path.isAbsolute(r))).toBe(true);
    expect(refs[0]).toBe(path.resolve("http://evil/x.mp4"));
  });

  it("a missing --frame-diff reference fails with exit 1 before any probe runs", async () => {
    const f = path.join(tmpDir(), "a.mp4");
    fs.writeFileSync(f, "x");
    const calls: string[] = [];
    const out: string[] = [];
    const code = await runVerify([f, "--frame-diff", "0:http://evil.example/x.mp4>1"], {
      stdout: (t) => out.push(t),
      stderr: () => {},
      exec: async (file) => (calls.push(file), { stdout: "", stderr: "" }),
    });
    expect(code).toBe(1);
    expect(out.join("")).toMatch(/reference not found/);
    expect(calls).toEqual([]);
  });

  it("a probe that is killed by its timeout is reported as exit 1 'probe timed out'", async () => {
    const f = path.join(tmpDir(), "a.wav");
    fs.writeFileSync(f, "x");
    const out: string[] = [];
    const code = await runVerify([f, "--duration", "1"], {
      stdout: (t) => out.push(t),
      stderr: () => {},
      exec: async () => {
        throw Object.assign(new Error("Command failed"), { killed: true, signal: "SIGTERM" });
      },
    });
    expect(code).toBe(1);
    expect(out.join("")).toMatch(/probe timed out/);
  });
});

describe("hostile release metadata", () => {
  it("launcher: a release tag that is not a safe path segment is rejected before anything is written", async () => {
    const fx = await startFixture({ repo: LAUNCHER_REPO, tag: "v../../../escape", assets: { "artcraft-launcher-../../../escape-macos-universal.dmg": Buffer.from("x") } });
    fixtures.push(fx);
    const deps = baseDeps({ platform: "darwin", arch: "arm64", apiBase: fx.url });
    await expect(installLauncher(deps)).rejects.toThrow(/invalid Craft Launcher version/);
    expect(fs.existsSync(path.join(deps.env.CRAFT_HOME as string, "craft-launcher"))).toBe(false);
  });

  it("download URLs outside the repo's release path are refused against the real GitHub API (before any fetch)", async () => {
    let fetched = 0;
    const deps = baseDeps({ fetch: (async () => (fetched++, new Response("x"))) as typeof fetch });
    const release = {
      tag_name: "v0.7.0",
      assets: [
        { name: "a.tar.gz", browser_download_url: "https://evil.example/a.tar.gz" },
        { name: "SHA256SUMS.txt", browser_download_url: "https://github.com/storytold/x/releases/download/v0.7.0/SHA256SUMS.txt" },
      ],
    };
    await expect(downloadVerified(deps, release, "a.tar.gz", path.join(tmpDir(), "a"), "storytold/x")).rejects.toThrow(/outside https:\/\/github.com\/storytold\/x\/releases\/download\//);
    expect(fetched).toBe(0);
  });

  it("a stream that exceeds the byte cap is aborted", async () => {
    const deps = baseDeps({ fetch: (async () => new Response(new Uint8Array(100))) as typeof fetch });
    await expect(downloadFile(deps, "https://github.com/x", path.join(tmpDir(), "a"), 10)).rejects.toThrow(/exceeds 10 bytes/);
  });

  it("an oversized SHA256SUMS.txt is refused", async () => {
    const big = "a".repeat(1024 * 1024 + 1);
    const deps = baseDeps({ fetch: (async () => new Response(big)) as typeof fetch });
    const release = {
      tag_name: "v1",
      assets: [
        { name: "a", browser_download_url: "https://github.com/storytold/x/releases/download/v1/a" },
        { name: "SHA256SUMS.txt", browser_download_url: "https://github.com/storytold/x/releases/download/v1/SHA256SUMS.txt" },
      ],
    };
    await expect(downloadVerified(deps, release, "a", path.join(tmpDir(), "a"), "storytold/x")).rejects.toThrow(/larger than/);
  });
});

describe("post-extraction tree check", () => {
  it("assertTreeSafe rejects a symlink anywhere in the tree", () => {
    const tree = tmpDir();
    fs.mkdirSync(path.join(tree, "a", "b"), { recursive: true });
    fs.writeFileSync(path.join(tree, "a", "ok.txt"), "x");
    expect(() => assertTreeSafe(tree)).not.toThrow();
    fs.symlinkSync("/etc/passwd", path.join(tree, "a", "b", "link"));
    expect(() => assertTreeSafe(tree)).toThrow(/a[\\/]b[\\/]link.*not a regular file/);
  });

  it("provisioning aborts and installs nothing when extraction produced a symlink the listing guard missed", async () => {
    const id = "soundcraft";
    const asset = `${id}-0.7.0-linux-x86_64.tar.gz`;
    const archive = makeTarGz({ [`top/bin/${id}-cli`]: "#!/bin/sh\necho ok\n" });
    const fx = await startFixture({ repo: `storytold/${id}`, assets: { [asset]: archive } });
    fixtures.push(fx);
    const home = tmpDir();
    const { execFileAsync } = await import("@blackbelt-technology/pi-dashboard-shared/platform/exec.js");
    const exec: ProvisionDeps["exec"] = async (file, args, opts) => {
      const r = await execFileAsync(file, args, opts);
      if (file === "tar" && args[0] === "-xf") fs.symlinkSync("/etc/passwd", path.join(args[3], "sneaky"));
      return r;
    };
    await expect(provision(id, { env: { CRAFT_HOME: home }, platform: "linux", arch: "x64", glibcVersion: () => "2.99", apiBase: fx.url, log: () => {}, exec })).rejects.toThrow(/not a regular file/);
    expect(fs.existsSync(path.join(home, id, "0.7.0"))).toBe(false);
  });
});

describe("mcp --register hardening", () => {
  const project = () => {
    const d = tmpDir();
    fs.mkdirSync(path.join(d, ".git"));
    return d;
  };
  const reg = (cwd: string) => {
    const err: string[] = [];
    return { code: registerMcp(getApp("wordcraft"), { cwd, stderr: (t) => err.push(t) }), err: err.join("") };
  };

  it("refuses to write through a symlinked .pi directory", () => {
    const cwd = project();
    const outside = tmpDir();
    fs.symlinkSync(outside, path.join(cwd, ".pi"));
    const r = reg(cwd);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/symbolic link/);
    expect(fs.readdirSync(outside)).toEqual([]);
  });

  it("refuses to write through a symlinked mcp.json and leaves the target untouched", () => {
    const cwd = project();
    fs.mkdirSync(path.join(cwd, ".pi"));
    const target = path.join(tmpDir(), "global.json");
    fs.writeFileSync(target, '{"mcpServers":{"keep":{}}}');
    fs.symlinkSync(target, path.join(cwd, ".pi", "mcp.json"));
    expect(reg(cwd).code).toBe(1);
    expect(fs.readFileSync(target, "utf8")).toBe('{"mcpServers":{"keep":{}}}');
  });

  it("a non-object mcpServers is left untouched (never clobbered) with exit 1", () => {
    for (const bad of ['{"mcpServers":[1]}', '{"mcpServers":"x"}', '{"mcpServers":null}']) {
      const cwd = project();
      fs.mkdirSync(path.join(cwd, ".pi"));
      fs.writeFileSync(path.join(cwd, ".pi", "mcp.json"), bad);
      const r = reg(cwd);
      expect(r.code, bad).toBe(1);
      expect(r.err).toMatch(/not an object/);
      expect(fs.readFileSync(path.join(cwd, ".pi", "mcp.json"), "utf8")).toBe(bad);
    }
  });

  it("writes atomically: no temp file is left behind and a __proto__ key stays data", () => {
    const cwd = project();
    fs.mkdirSync(path.join(cwd, ".pi"));
    fs.writeFileSync(path.join(cwd, ".pi", "mcp.json"), '{"mcpServers":{"__proto__":{"polluted":true}}}');
    expect(reg(cwd).code).toBe(0);
    expect(fs.readdirSync(path.join(cwd, ".pi"))).toEqual(["mcp.json"]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe("mcp proxy argument nit", () => {
  it("--root followed by another option is an error, not a directory named --allow-unconfined", () => {
    expect(parseMcpArgs(["--root", "--allow-unconfined"])).toMatchObject({ kind: "error" });
    expect(parseMcpArgs(["--root", "/x"])).toMatchObject({ kind: "run", root: "/x" });
  });
});
