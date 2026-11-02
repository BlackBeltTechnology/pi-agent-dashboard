/**
 * E13 (slim-windows-install-file-count): the Doctor "Dashboard server code" row
 * reads the bundled server from the canonical node_modules copy — the
 * `server/packages/server` copy is not shipped any more.
 *
 * See change: slim-windows-install-file-count (design D2).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { bundledServerInfo } from "../doctor.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function resources(pkgRel: string[], version: string): string {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), "doctor-bundled-"));
  dirs.push(r);
  const pkg = path.join(r, ...pkgRel);
  fs.mkdirSync(path.join(pkg, "src"), { recursive: true });
  fs.writeFileSync(path.join(pkg, "src", "cli.ts"), "");
  fs.writeFileSync(path.join(pkg, "package.json"), JSON.stringify({ name: "@blackbelt-technology/pi-dashboard-server", version }));
  return r;
}

describe("bundledServerInfo", () => {
  it("reports the node_modules cli path and its package.json version", () => {
    const r = resources(["server", "node_modules", "@blackbelt-technology", "pi-dashboard-server"], "9.9.9");
    const info = bundledServerInfo(r);
    expect(info?.exists).toBe(true);
    expect(info?.version).toBe("9.9.9");
    expect(info?.cliPath).toBe(path.join(r, "server", "node_modules", "@blackbelt-technology", "pi-dashboard-server", "src", "cli.ts"));
  });

  it("does not find the removed server/packages/server copy", () => {
    const r = resources(["server", "packages", "server"], "1.0.0");
    expect(bundledServerInfo(r)?.exists).toBe(false);
  });

  it("is null without a resources path (dev run)", () => {
    expect(bundledServerInfo(undefined)).toBeNull();
  });
});
