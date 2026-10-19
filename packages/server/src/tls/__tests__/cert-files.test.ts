import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CertFiles } from "../cert-files.js";

/**
 * Path containment of the TLS data dir: an id or name can never address a path
 * outside `<root>/<sourceId>/<name>` (security: ids come from config, names from sources).
 * See change: add-tailscale-cert-tls.
 */
let root: string;
let files: CertFiles;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-tls-files-"));
  files = new CertFiles(path.join(root, "tls"));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("path containment", () => {
  const evilIds = ["..", "../x", "a/b", "/etc", "", "A", "a_b", "x".repeat(40), ".hidden"];
  for (const id of evilIds) {
    it(`refuses source id ${JSON.stringify(id)}`, () => {
      expect(() => files.sourceDir(id)).toThrow(/invalid source id/);
    });
  }

  const evilNames = ["../x.test", "a/b.test", "..", "", "A.test", "x..test", "-a.test", "a.test/../../b", "*.*.test", "a b.test"];
  for (const name of evilNames) {
    it(`refuses certificate name ${JSON.stringify(name)}`, () => {
      expect(() => files.nameDir("fake", name)).toThrow(/invalid certificate name/);
    });
  }

  it("a wildcard name maps to a portable directory inside the source dir", () => {
    const dir = files.nameDir("fake", "*.example.com");
    expect(path.dirname(dir)).toBe(files.sourceDir("fake"));
    expect(path.basename(dir)).toBe("_wildcard_.example.com");
  });

  it("writes, reads and removes inside the root only", async () => {
    await files.writeMeta("fake", "a.test", {
      source: "fake",
      fingerprint: "f",
      advertise: true,
      kind: "domain",
      stage: "idle",
      failures: 2,
    });
    expect((await files.readMeta("fake", "a.test"))?.failures).toBe(2);
    expect(await files.listNames("fake")).toEqual(["a.test"]);
    await files.removeSource("fake");
    expect(await files.listNames("fake")).toEqual([]);
    expect(fs.readdirSync(root)).toEqual(["tls"]);
  });

  it("a name from an untrusted directory listing that is unsafe is never returned", async () => {
    fs.mkdirSync(path.join(root, "tls", "fake", "Not Safe"), { recursive: true });
    fs.mkdirSync(path.join(root, "tls", "fake", "ok.test"), { recursive: true });
    expect(await files.listNames("fake")).toEqual(["ok.test"]);
  });
});
