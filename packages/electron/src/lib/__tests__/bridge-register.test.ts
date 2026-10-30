/**
 * E12 (slim-windows-install-file-count): `findBundledExtension` reads the
 * canonical node_modules extension dir of the bundled server tree, never the
 * removed `server/packages/extension` copy.
 *
 * See change: slim-windows-install-file-count (design D2).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findBundledExtension } from "../bridge-register.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function resources(extensionRel: string[]): string {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-find-"));
  dirs.push(r);
  const ext = path.join(r, ...extensionRel);
  fs.mkdirSync(ext, { recursive: true });
  fs.writeFileSync(path.join(ext, "package.json"), '{"name":"@blackbelt-technology/pi-dashboard-extension"}');
  return r;
}

const NO_DEV = path.join(os.tmpdir(), "bridge-find-no-such-dev-dir");
const NM_EXT = ["server", "node_modules", "@blackbelt-technology", "pi-dashboard-extension"];

describe("findBundledExtension", () => {
  it("returns the node_modules extension dir of the bundled server tree", () => {
    const r = resources(NM_EXT);
    expect(findBundledExtension(r, NO_DEV)).toBe(path.join(r, ...NM_EXT));
  });

  it("returns null when only the removed server/packages/extension copy exists", () => {
    const r = resources(["server", "packages", "extension"]);
    expect(findBundledExtension(r, NO_DEV)).toBeNull();
  });

  it("falls back to the dev source tree when the packaged dir is absent", () => {
    const r = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-find-"));
    dirs.push(r);
    const dev = path.join(r, "dev-extension");
    fs.mkdirSync(dev);
    fs.writeFileSync(path.join(dev, "package.json"), "{}");
    expect(findBundledExtension(path.join(r, "resources"), dev)).toBe(dev);
  });
});
