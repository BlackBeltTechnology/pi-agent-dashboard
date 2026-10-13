/**
 * Project key: origin normalisation and the directory-key fallback.
 * See change: add-credential-vault (test-plan E8, E9, E12).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeOrigin, resolveSessionProject } from "@blackbelt-technology/pi-dashboard-shared/vault-project-key.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let dir: string;
beforeEach(() => { dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vault-pk-"))); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("normalizeOrigin", () => {
  it("E8: ssh, scp and https forms of one repository are equal", () => {
    for (const url of [
      "https://github.com/acme/app.git",
      "git@github.com:acme/app",
      "ssh://git@github.com:22/acme/app",
      "https://user:tok@GitHub.com/acme/app/",
    ]) expect(normalizeOrigin(url)).toBe("github.com/acme/app");
  });

  it("E9: non-default ports and path case are kept; local origins give no key", () => {
    expect(normalizeOrigin("https://host:8443/a/b")).toBe("host:8443/a/b");
    expect(normalizeOrigin("http://host:80/a/b")).toBe("host/a/b");
    expect(normalizeOrigin("https://github.com/Acme/App")).toBe("github.com/Acme/App");
    expect(normalizeOrigin("https://github.com/Acme/App")).not.toBe(normalizeOrigin("https://github.com/acme/app"));
    expect(normalizeOrigin("file:///srv/repo")).toBeUndefined();
    expect(normalizeOrigin("/srv/repo")).toBeUndefined();
    expect(normalizeOrigin("C:\\srv\\repo")).toBeUndefined();
    expect(normalizeOrigin("")).toBeUndefined();
  });

  it("drops the trailing slash before .git", () => {
    expect(normalizeOrigin("https://github.com/acme/app.git/")).toBe("github.com/acme/app");
  });
});

describe("resolveSessionProject", () => {
  it("E12: a failing git read falls back to the directory key", async () => {
    const project = await resolveSessionProject({ deviceId: "hub", cwd: dir }, { readOrigin: async () => undefined });
    expect(project).toEqual({ deviceId: "hub", dir, repoKey: undefined });
  });

  it("uses the repository key when an origin is readable", async () => {
    const project = await resolveSessionProject(
      { deviceId: "dev-1", cwd: dir },
      { readOrigin: async () => "git@github.com:acme/app.git" },
    );
    expect(project).toEqual({ deviceId: "dev-1", dir, repoKey: "github.com/acme/app" });
  });

  it("returns undefined when the directory cannot be resolved", async () => {
    expect(await resolveSessionProject({ deviceId: "hub", cwd: path.join(dir, "nope") }, { readOrigin: async () => undefined })).toBeUndefined();
  });
});
