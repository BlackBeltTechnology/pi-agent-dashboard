/**
 * Remote folder proof: salted digest of pi's trust-requiring resources
 * (test-plan #E15 #E16 #P1). See change: mirror-dashboard-trust-live-remote.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  newTrustSalt,
  TRUST_RESOURCE_MAX_BYTES,
  TRUST_RESOURCE_MAX_ENTRIES,
  trustResourceDigest,
  trustResourceManifest,
} from "../pi-trust-resource-digest.js";

let root: string;
let home: string;

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-trust-digest-")));
  home = path.join(root, "home");
  fs.mkdirSync(home, { recursive: true });
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

function write(file: string, content: string, mtime?: Date): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  if (mtime) fs.utimesSync(file, mtime, mtime);
}

const T = new Date("2024-01-01T00:00:00Z");

/** A tree whose mtimes are identical across copies. */
function makeTree(name: string, over: Record<string, string> = {}): string {
  const cwd = path.join(root, name, "parent", "proj");
  const files: Record<string, string> = {
    "proj/.pi/settings.json": "{}",
    "proj/.pi/mcp.json": '{"servers":{}}',
    "proj/.pi/extensions/a.ts": "export default 1;",
    ...over,
  };
  for (const [rel, content] of Object.entries(files)) {
    const abs = rel.startsWith("~/")
      ? path.join(root, name, "home", rel.slice(2))
      : rel.startsWith("parent/")
        ? path.join(root, name, rel)
        : path.join(root, name, "parent", rel);
    write(abs, content, T);
  }
  return cwd;
}

describe("#E15 digest equality", () => {
  it("equal when nothing differs; differs per trust-requiring change; user skills excluded", async () => {
    const a = makeTree("a");
    const b = makeTree("b");
    const homeA = path.join(root, "a", "home");
    const homeB = path.join(root, "b", "home");
    // Same content, DIFFERENT path ⇒ manifests equal (digest binds the cwd key separately).
    expect(await trustResourceManifest(a, { home: homeA })).toBe(await trustResourceManifest(b, { home: homeB }));

    const mcp = makeTree("c", { "proj/.pi/mcp.json": '{"servers":{"evil":{}}}' });
    expect(await trustResourceManifest(mcp, { home: path.join(root, "c", "home") })).not.toBe(
      await trustResourceManifest(a, { home: homeA }),
    );

    const base = await trustResourceManifest(a, { home: homeA });
    const k0 = makeTree("d", { "proj/.agents/skills/x.md": "x" });
    const k0m = await trustResourceManifest(k0, { home: path.join(root, "d", "home") });
    expect(k0m).not.toBe(base);
    expect(k0m).toContain("a0/x.md");

    const k1 = makeTree("e", { "parent/.agents/skills/y.md": "y" });
    const k1m = await trustResourceManifest(k1, { home: path.join(root, "e", "home") });
    expect(k1m).not.toBe(base);
    expect(k1m).toContain("a1/y.md");

    const user = makeTree("f", { "~/.agents/skills/z.md": "z" });
    expect(await trustResourceManifest(user, { home: path.join(root, "f", "home") })).toBe(base);
  });

  it("digest binds the cwd key and the salt", async () => {
    const a = makeTree("a");
    const m = (await trustResourceManifest(a, { home }))!;
    expect(trustResourceDigest("s1", a, m)).not.toBe(trustResourceDigest("s2", a, m));
    expect(trustResourceDigest("s1", a, m)).not.toBe(trustResourceDigest("s1", `${a}x`, m));
    expect(newTrustSalt()).not.toBe(newTrustSalt());
  });
});

describe("#E16 fail-closed set", () => {
  const cwdOf = (name: string): string => path.join(root, name);
  const manifest = (cwd: string): Promise<string | null> => trustResourceManifest(cwd, { home });

  it("empty set → null", async () => {
    fs.mkdirSync(cwdOf("empty"), { recursive: true });
    expect(await manifest(cwdOf("empty"))).toBeNull();
  });

  it("symlink anywhere in the set → null", async () => {
    const cwd = cwdOf("sym");
    write(path.join(cwd, ".pi", "settings.json"), "{}");
    write(path.join(cwd, "real.ts"), "x");
    fs.mkdirSync(path.join(cwd, ".pi", "extensions"));
    fs.symlinkSync(path.join(cwd, "real.ts"), path.join(cwd, ".pi", "extensions", "link.ts"));
    expect(await manifest(cwd)).toBeNull();
  });

  it("fifo → null", async () => {
    const { execFileSync } = await import("node:child_process");
    const cwd = cwdOf("fifo");
    write(path.join(cwd, ".pi", "settings.json"), "{}");
    try {
      execFileSync("mkfifo", [path.join(cwd, ".pi", "SYSTEM.md")]);
    } catch {
      return; // no mkfifo on this platform
    }
    expect(await manifest(cwd)).toBeNull();
  });

  it("unparseable settings.json → null", async () => {
    const cwd = cwdOf("badjson");
    write(path.join(cwd, ".pi", "settings.json"), "{not json");
    expect(await manifest(cwd)).toBeNull();
  });

  it("settings.json with a packages entry → null; empty packages is fine", async () => {
    const cwd = cwdOf("pkgs");
    write(path.join(cwd, ".pi", "settings.json"), JSON.stringify({ packages: ["npm:some-pkg"] }));
    expect(await manifest(cwd)).toBeNull();
    write(path.join(cwd, ".pi", "settings.json"), JSON.stringify({ packages: [] }));
    expect(await manifest(cwd)).not.toBeNull();
  });

  it("extension path outside the set → null; inside is fine", async () => {
    const cwd = cwdOf("ext");
    write(path.join(cwd, ".pi", "settings.json"), JSON.stringify({ extensions: ["../ext"] }));
    expect(await manifest(cwd)).toBeNull();
    write(path.join(cwd, ".pi", "settings.json"), JSON.stringify({ extensions: ["./extensions/a.ts", "!extensions/b/*"] }));
    write(path.join(cwd, ".pi", "extensions", "a.ts"), "x");
    expect(await manifest(cwd)).not.toBeNull();
    write(path.join(cwd, ".pi", "settings.json"), JSON.stringify({ extensions: ["./lib/a.ts"] }));
    expect(await manifest(cwd)).toBeNull();
  });

  it("entry cap: exactly 1,000 passes, 1,001 fails", async () => {
    const cwd = cwdOf("cap");
    // `c/extensions` dir itself is 1 entry; settings.json is 1 entry → 998 files + 2 = 1,000.
    write(path.join(cwd, ".pi", "settings.json"), "{}");
    fs.mkdirSync(path.join(cwd, ".pi", "extensions"), { recursive: true });
    for (let i = 0; i < TRUST_RESOURCE_MAX_ENTRIES - 2; i += 1) write(path.join(cwd, ".pi", "extensions", `f${i}.ts`), "x");
    expect(await manifest(cwd)).not.toBeNull();
    write(path.join(cwd, ".pi", "extensions", "one-more.ts"), "x");
    expect(await manifest(cwd)).toBeNull();
  });

  it("byte cap: exactly 16 MiB passes, 16 MiB + 1 B fails", async () => {
    const cwd = cwdOf("bytes");
    write(path.join(cwd, ".pi", "settings.json"), "{}");
    const big = path.join(cwd, ".pi", "extensions", "big.bin");
    fs.mkdirSync(path.dirname(big), { recursive: true });
    fs.writeFileSync(big, Buffer.alloc(TRUST_RESOURCE_MAX_BYTES - 2)); // settings.json is 2 bytes
    expect(await manifest(cwd)).not.toBeNull();
    fs.appendFileSync(big, "x");
    expect(await manifest(cwd)).toBeNull();
  });

  it("an aborted signal fails closed", async () => {
    const cwd = makeTree("abort");
    const ac = new AbortController();
    ac.abort();
    expect(await trustResourceManifest(cwd, { home, signal: ac.signal })).toBeNull();
  });
});

describe("#P1 digest budget", () => {
  it("200 files / 2 MiB: manifest + HMAC p95 < 200 ms over 50 runs", async () => {
    const cwd = path.join(root, "perf");
    write(path.join(cwd, ".pi", "settings.json"), "{}");
    const chunk = "x".repeat(10 * 1024);
    for (let i = 0; i < 199; i += 1) write(path.join(cwd, ".pi", "extensions", `f${i}.ts`), chunk);
    const times: number[] = [];
    for (let i = 0; i < 50; i += 1) {
      const t0 = performance.now();
      const m = await trustResourceManifest(cwd, { home });
      trustResourceDigest("s", cwd, m as string);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    expect(times[Math.floor(times.length * 0.95)]).toBeLessThan(200);
  });
});
