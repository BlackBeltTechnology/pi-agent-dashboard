/**
 * GitHub runtime asset extraction must not follow archive links out of the
 * staging dir: `dir -> /outside` then `dir/file` would write outside it.
 * See change: electron-runtime-overlay-updates (security-hardening).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createStagerDeps } from "../runtime-overlay/runtime-io.js";

const tmp: string[] = [];
function mk(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "rt-io-"));
  tmp.push(d);
  return d;
}
afterEach(() => {
  for (const d of tmp.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function tgzOf(src: string, entries: string[]): string {
  const out = path.join(mk(), "a.tgz");
  execFileSync("tar", ["-czf", out, "-C", src, ...entries]);
  return out;
}

describe("runtime asset extraction", () => {
  it("extracts a plain archive", async () => {
    const src = mk();
    fs.mkdirSync(path.join(src, "server"));
    fs.writeFileSync(path.join(src, "server", "cli.ts"), "x");
    const dest = mk();
    await createStagerDeps().extractTgz(tgzOf(src, ["server"]), dest);
    expect(fs.readFileSync(path.join(dest, "server", "cli.ts"), "utf8")).toBe("x");
  });

  it("refuses a symlink member (no write outside the staging dir)", async () => {
    const outside = mk();
    const src = mk();
    fs.symlinkSync(outside, path.join(src, "escape"));
    const dest = mk();
    await expect(createStagerDeps().extractTgz(tgzOf(src, ["escape"]), dest)).rejects.toThrow(/unsafe_archive/);
    expect(fs.existsSync(path.join(dest, "escape"))).toBe(false);
  });

  it("refuses a hard-link member", async () => {
    const src = mk();
    fs.writeFileSync(path.join(src, "a"), "x");
    fs.linkSync(path.join(src, "a"), path.join(src, "b"));
    await expect(createStagerDeps().extractTgz(tgzOf(src, ["a", "b"]), mk())).rejects.toThrow(/unsafe_archive/);
  });
});
