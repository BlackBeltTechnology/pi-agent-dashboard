/** D8 bridge extension identity. See change: electron-runtime-overlay-updates. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { bridgeExtensionIdentity, resolveExtensionIdentity } from "../extension-identity.js";

const tmp: string[] = [];
afterEach(() => {
  for (const d of tmp.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("resolveExtensionIdentity", () => {
  it("nearest package dir (realpath'd) + version", () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "extid-")));
    tmp.push(root);
    fs.mkdirSync(path.join(root, "pkg", "src", "deep"), { recursive: true });
    fs.writeFileSync(path.join(root, "pkg", "package.json"), JSON.stringify({ name: "x", version: "0.9.1" }));
    fs.symlinkSync(path.join(root, "pkg"), path.join(root, "link"));
    expect(resolveExtensionIdentity(path.join(root, "link", "src", "deep"))).toEqual({ dir: path.join(root, "pkg"), version: "0.9.1" });
  });

  it("the real bridge resolves to packages/extension", () => {
    const id = bridgeExtensionIdentity();
    expect(id?.dir).toBe(fs.realpathSync(path.resolve(import.meta.dirname, "..", "..")));
    expect(id?.version).toMatch(/^\d+\.\d+\.\d+/);
  });
});
