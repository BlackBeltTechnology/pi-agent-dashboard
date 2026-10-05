/**
 * config.json is written 0600 (it holds the auth HMAC secret) and tightened at load.
 * See change: harden-trust-and-credential-boundaries (D4; T-E27, E29, X9–X11).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig, writeConfigFileSecure } from "../config.js";

let tmpDir: string;
let origHome: string | undefined;
let origUmask: number;
const posix = process.platform !== "win32";

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "config-secure-"));
  origHome = process.env.HOME;
  process.env.HOME = tmpDir;
  origUmask = process.umask(0o022);
});
afterEach(() => {
  process.umask(origUmask);
  process.env.HOME = origHome;
  vi.restoreAllMocks();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const cfgFile = () => path.join(tmpDir, ".pi", "dashboard", "config.json");
function seed(mode: number, data: object = { port: 9123 }) {
  fs.mkdirSync(path.dirname(cfgFile()), { recursive: true });
  fs.writeFileSync(cfgFile(), JSON.stringify(data));
  fs.chmodSync(cfgFile(), mode);
}

describe("writeConfigFileSecure", () => {
  it.runIf(posix)("writes mode 0600 under a permissive umask and leaves no tmp files (E27)", () => {
    const f = path.join(tmpDir, "config.json");
    writeConfigFileSecure(f, "{}");
    expect(fs.statSync(f).mode & 0o777).toBe(0o600);
    expect(fs.readdirSync(tmpDir).filter((n) => n.includes(".tmp."))).toEqual([]);
  });

  it("parallel writes both resolve, final file is valid JSON, no tmp leftovers (X11)", async () => {
    const f = path.join(tmpDir, "config.json");
    await Promise.all([
      Promise.resolve().then(() => writeConfigFileSecure(f, '{"a":1}')),
      Promise.resolve().then(() => writeConfigFileSecure(f, '{"b":2}')),
    ]);
    expect(() => JSON.parse(fs.readFileSync(f, "utf-8"))).not.toThrow();
    expect(fs.readdirSync(tmpDir).filter((n) => n.includes(".tmp."))).toEqual([]);
  });

  it("a chmod failure (win32-like) does not throw and the file is written (X10)", () => {
    const f = path.join(tmpDir, "config.json");
    vi.spyOn(fs, "chmodSync").mockImplementation(() => {
      throw Object.assign(new Error("nope"), { code: "EPERM" });
    });
    expect(() => writeConfigFileSecure(f, '{"x":1}')).not.toThrow();
    expect(fs.readFileSync(f, "utf-8")).toBe('{"x":1}');
  });
});

describe("loadConfig tightening", () => {
  it.runIf(posix)("chmods 0644 and 0640 to 0600 (E29)", () => {
    for (const mode of [0o644, 0o640]) {
      seed(mode);
      loadConfig();
      expect(fs.statSync(cfgFile()).mode & 0o777).toBe(0o600);
    }
  });

  it.runIf(posix)("0600 is left alone, no chmod call (E29)", () => {
    seed(0o600);
    const spy = vi.spyOn(fs, "chmodSync");
    loadConfig();
    expect(spy).not.toHaveBeenCalled();
  });

  it.runIf(posix)("chmod EPERM warns but still returns the parsed config (X9)", () => {
    seed(0o644);
    vi.spyOn(fs, "chmodSync").mockImplementation(() => {
      throw Object.assign(new Error("EPERM"), { code: "EPERM" });
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(loadConfig().port).toBe(9123);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("requireLocalProof config field (E16)", () => {
  it.each([[undefined, false], [true, true], [false, false], ["yes", false]])("%j → %j", (raw, want) => {
    seed(0o600, raw === undefined ? {} : { requireLocalProof: raw });
    expect(loadConfig().requireLocalProof).toBe(want);
  });
});
