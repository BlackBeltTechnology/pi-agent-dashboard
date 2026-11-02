/**
 * E88 (encrypt-credentials-at-rest): the bundle GO/NO-GO for `@napi-rs/keyring`.
 * Drives the extracted `checkKeyringBundle` with fixture bundle dirs; the
 * triple mapping (spike rows 3, 6; win32-arm64 ships x64 Node) and the prune
 * survival of `LICENSE.third-party.md` are pinned here too.
 *
 * See change: encrypt-credentials-at-rest (design D5, tasks 11.1).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs module, no type declarations by design.
import { checkKeyringBundle, keyringTriple } from "../../scripts/assert-keyring-bundle.mjs";

interface Opts {
  platform: string;
  arch: string;
  libc?: string;
  verifySignature?: (nodePath: string) => string | null;
}
interface Result {
  ok: boolean;
  triple: string;
  errors: string[];
}
const check = checkKeyringBundle as (o: Opts & { bundleDir: string }) => Result;
const triple = keyringTriple as (o: Opts) => string;

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

interface FixtureOpts {
  triple?: string;
  mainVersion?: string;
  platformVersion?: string;
  node?: boolean;
  worker?: boolean;
  license?: boolean;
}

/** Fixture bundle: `<dir>/node_modules/...` as `bundle-server.mjs` leaves it. */
function fixture(o: FixtureOpts = {}): string {
  const t = o.triple ?? "darwin-arm64";
  const dir = mkdtempSync(path.join(tmpdir(), "keyring-bundle-"));
  dirs.push(dir);
  const nm = path.join(dir, "node_modules");
  mkdirSync(path.join(nm, "@napi-rs", "keyring"), { recursive: true });
  writeFileSync(path.join(nm, "@napi-rs", "keyring", "package.json"), JSON.stringify({ name: "@napi-rs/keyring", version: o.mainVersion ?? "2.1.2" }));
  const pdir = path.join(nm, "@napi-rs", `keyring-${t}`);
  mkdirSync(pdir, { recursive: true });
  writeFileSync(path.join(pdir, "package.json"), JSON.stringify({ name: `@napi-rs/keyring-${t}`, version: o.platformVersion ?? "2.1.2" }));
  if (o.node !== false) writeFileSync(path.join(pdir, `keyring.${t}.node`), "binary");
  if (o.license) writeFileSync(path.join(pdir, "LICENSE.third-party.md"), "third-party");
  if (o.worker !== false) {
    const authDir = path.join(nm, "@blackbelt-technology", "pi-dashboard-server", "src", "auth");
    mkdirSync(authDir, { recursive: true });
    writeFileSync(path.join(authDir, "credential-key-worker.mjs"), "export {};");
  }
  return dir;
}

describe("E88: bundle GO/NO-GO — @napi-rs/keyring", () => {
  it("E88: passes with the .node and the worker present, versions equal", () => {
    const r = check({ bundleDir: fixture(), platform: "darwin", arch: "arm64" });
    expect(r).toEqual({ ok: true, triple: "darwin-arm64", errors: [] });
  });

  it("E88: NO-GO naming the triple when the .node is missing", () => {
    const r = check({ bundleDir: fixture({ node: false }), platform: "darwin", arch: "arm64" });
    expect(r.ok).toBe(false);
    expect(r.errors.join("\n")).toContain("darwin-arm64");
    expect(r.errors.join("\n")).toContain("keyring.darwin-arm64.node");
  });

  it("E88: NO-GO naming credential-key-worker.mjs when the worker entry is missing", () => {
    const r = check({ bundleDir: fixture({ worker: false }), platform: "darwin", arch: "arm64" });
    expect(r.ok).toBe(false);
    expect(r.errors.join("\n")).toContain("credential-key-worker.mjs");
  });

  it("E88: NO-GO naming both versions when the platform package skews (spike row 11)", () => {
    const r = check({ bundleDir: fixture({ platformVersion: "2.1.1", mainVersion: "2.1.2" }), platform: "darwin", arch: "arm64" });
    expect(r.ok).toBe(false);
    const msg = r.errors.join("\n");
    expect(msg).toContain("2.1.1");
    expect(msg).toContain("2.1.2");
  });

  it("E88: TARGET_ARCH=x64 with only darwin-arm64 present is a NO-GO naming darwin-x64 (spike rows 3, 6)", () => {
    const r = check({ bundleDir: fixture({ triple: "darwin-arm64" }), platform: "darwin", arch: "x64" });
    expect(r.ok).toBe(false);
    expect(r.triple).toBe("darwin-x64");
    expect(r.errors.join("\n")).toContain("darwin-x64");
  });

  it("E88: a missing main package is a NO-GO", () => {
    const dir = fixture();
    rmSync(path.join(dir, "node_modules", "@napi-rs", "keyring"), { recursive: true });
    const r = check({ bundleDir: dir, platform: "darwin", arch: "arm64" });
    expect(r.ok).toBe(false);
    expect(r.errors.join("\n")).toContain("@napi-rs/keyring");
  });

  it("E88: Linux needs LICENSE.third-party.md next to the .node (statically linked libdbus)", () => {
    const missing = check({ bundleDir: fixture({ triple: "linux-x64-gnu" }), platform: "linux", arch: "x64" });
    expect(missing.ok).toBe(false);
    expect(missing.errors.join("\n")).toContain("LICENSE.third-party.md");
    const present = check({ bundleDir: fixture({ triple: "linux-x64-gnu", license: true }), platform: "linux", arch: "x64" });
    expect(present).toEqual({ ok: true, triple: "linux-x64-gnu", errors: [] });
  });

  it("E88: macOS/Windows do not require the licence file", () => {
    expect(check({ bundleDir: fixture({ triple: "win32-x64-msvc" }), platform: "win32", arch: "x64" }).ok).toBe(true);
  });

  it("E88: a failing signature verifier is a NO-GO naming the .node", () => {
    const r = check({ bundleDir: fixture(), platform: "darwin", arch: "arm64", verifySignature: () => "invalid signature" });
    expect(r.ok).toBe(false);
    expect(r.errors.join("\n")).toContain("keyring.darwin-arm64.node");
    expect(r.errors.join("\n")).toContain("invalid signature");
  });

  it("E88: the signature verifier only runs for darwin targets", () => {
    let called = 0;
    check({ bundleDir: fixture({ triple: "win32-x64-msvc" }), platform: "win32", arch: "x64", verifySignature: () => ((called += 1), null) });
    expect(called).toBe(0);
  });
});

describe("E89: target triple selection", () => {
  it.each([
    ["darwin", "arm64", "darwin-arm64"],
    ["darwin", "x64", "darwin-x64"],
    ["linux", "x64", "linux-x64-gnu"],
    ["linux", "arm64", "linux-arm64-gnu"],
    ["win32", "x64", "win32-x64-msvc"],
    // win32-arm64 ships x64 Node (the node-pty/bundle leg is x64-emulated), so the x64 binding.
    ["win32", "arm64", "win32-x64-msvc"],
  ])("E89: %s/%s -> %s", (platform, arch, expected) => {
    expect(triple({ platform, arch })).toBe(expected);
  });

  it("E89: musl is selectable", () => {
    expect(triple({ platform: "linux", arch: "x64", libc: "musl" })).toBe("linux-x64-musl");
  });

  it("E89: an unsupported platform/arch throws", () => {
    expect(() => triple({ platform: "freebsd", arch: "x64" })).toThrow(/unsupported/i);
  });
});
