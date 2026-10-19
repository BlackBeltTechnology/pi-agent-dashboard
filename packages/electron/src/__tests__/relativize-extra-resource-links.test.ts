/**
 * test-plan E3–E8 (refresh-electron-bundled-components, design D3): the
 * `afterCopyExtraResources` hook re-relativizes the absolute symlinks that
 * @electron/packager >= 20 creates when it copies `extraResource` entries
 * (`fs.cp` without `verbatimSymlinks`).
 *
 * Fixtures are real temp trees built the way `fs.cp` leaves them: a SOURCE tree
 * (the build host) and a DEST resources dir holding copies whose relative links
 * were rewritten to ABSOLUTE source paths.
 *
 * Skipped on win32: creating symlinks needs elevated rights there, and the win32
 * legs rely on the post-package scan instead.
 *
 * See change: refresh-electron-bundled-components.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs module, no type declarations by design.
import { createAfterCopyExtraResources, mapExtraResources, relativizeExtraResourceLinks, resourcesDirFor } from "../../scripts/relativize-extra-resource-links.mjs";

let tmp: string;
let project: string; // Forge project dir: where `./resources/*` entries resolve from
let resources: string; // packaged resources dir

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "relativize-links-")));
  project = path.join(tmp, "project");
  resources = path.join(tmp, "out", "resources");
  fs.mkdirSync(path.join(project, "resources"), { recursive: true });
  fs.mkdirSync(resources, { recursive: true });
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

const write = (p: string, body = "x") => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
};
const src = (...p: string[]) => path.join(project, "resources", ...p);
const dst = (...p: string[]) => path.join(resources, ...p);
const link = (target: string, at: string) => {
  fs.mkdirSync(path.dirname(at), { recursive: true });
  fs.symlinkSync(target, at);
};
/** Mirror an entry: copy files to dest (links are created per test, absolute, as fs.cp does). */
const copyFile = (rel: string, body = "x") => write(dst(rel), body);

describe.skipIf(process.platform === "win32")("relativizeExtraResourceLinks", () => {
  it("E3: rewrites an absolute in-entry link to a relative one that resolves in the copy", () => {
    write(src("server/node_modules/pkg/bin.js"));
    copyFile("server/node_modules/pkg/bin.js");
    link(src("server/node_modules/pkg/bin.js"), dst("server/node_modules/.bin/x"));

    const rewritten = relativizeExtraResourceLinks({
      resourcesDir: resources,
      extraResource: ["./resources/server"],
      projectDir: project,
    });

    expect(rewritten).toHaveLength(1);
    expect(fs.readlinkSync(dst("server/node_modules/.bin/x"))).toBe("../pkg/bin.js");
    expect(fs.realpathSync(dst("server/node_modules/.bin/x"))).toBe(dst("server/node_modules/pkg/bin.js"));
  });

  it("E4: a link from one entry into another resolves inside the bundle", () => {
    write(src("node/bin/node"));
    write(src("server/placeholder"));
    copyFile("node/bin/node");
    copyFile("server/placeholder");
    link(src("node/bin/node"), dst("server/bin/node"));

    relativizeExtraResourceLinks({
      resourcesDir: resources,
      extraResource: ["./resources/server", "./resources/node"],
      projectDir: project,
    });

    expect(fs.readlinkSync(dst("server/bin/node"))).toBe("../../node/bin/node");
    expect(fs.realpathSync(dst("server/bin/node"))).toBe(dst("node/bin/node"));
  });

  it("E5: matches the real path when the recorded target uses a different alias of the source root", () => {
    write(src("server/a"));
    copyFile("server/a");
    // Entry given through an alias symlink; the link target records the REAL path
    // (the `/tmp` vs `/private/tmp` shape on macOS).
    const alias = path.join(tmp, "alias");
    fs.symlinkSync(path.join(project, "resources"), alias);
    link(src("server/a"), dst("server/b"));

    relativizeExtraResourceLinks({
      resourcesDir: resources,
      extraResource: [path.join(alias, "server")],
      projectDir: project,
    });

    expect(fs.readlinkSync(dst("server/b"))).toBe("a");
  });

  it("E6: leaves a link to an absolute path outside every entry unchanged", () => {
    link("/usr/bin/env", dst("server/env"));
    write(src("server/placeholder"));

    const rewritten = relativizeExtraResourceLinks({
      resourcesDir: resources,
      extraResource: ["./resources/server"],
      projectDir: project,
    });

    expect(rewritten).toHaveLength(0);
    expect(fs.readlinkSync(dst("server/env"))).toBe("/usr/bin/env");
  });

  it("E7: covers an extraResource entry name the code has never seen", () => {
    write(src("codegraph/bin/tool"));
    copyFile("codegraph/bin/tool");
    link(src("codegraph/bin/tool"), dst("codegraph/bin/alias"));

    relativizeExtraResourceLinks({
      resourcesDir: resources,
      extraResource: ["./resources/codegraph"],
      projectDir: project,
    });

    expect(fs.readlinkSync(dst("codegraph/bin/alias"))).toBe("tool");
  });

  it("E8: a file entry is not walked, but a link to its source is rewritten to the copy", () => {
    write(src("app-update.yml"));
    copyFile("app-update.yml");
    write(src("server/placeholder"));
    copyFile("server/placeholder");
    link(src("app-update.yml"), dst("server/update.yml"));

    const rewritten = relativizeExtraResourceLinks({
      resourcesDir: resources,
      extraResource: ["./resources/app-update.yml", "./resources/server"],
      projectDir: project,
    });

    expect(rewritten).toHaveLength(1);
    expect(fs.readlinkSync(dst("server/update.yml"))).toBe("../app-update.yml");
  });

  it("is idempotent: already-relative links are not touched", () => {
    write(src("server/a"));
    copyFile("server/a");
    link("a", dst("server/b"));

    const rewritten = relativizeExtraResourceLinks({
      resourcesDir: resources,
      extraResource: ["./resources/server"],
      projectDir: project,
    });

    expect(rewritten).toHaveLength(0);
    expect(fs.readlinkSync(dst("server/b"))).toBe("a");
  });

  it("resolves entries against the project dir, not cwd, and skips entries missing on disk", () => {
    write(src("server/a"));
    const mapped = mapExtraResources(["./resources/server", "./resources/missing"], project, resources);
    expect(mapped).toHaveLength(1);
    expect(mapped[0].dest).toBe(path.join(resources, "server"));
    expect(mapped[0].isDirectory).toBe(true);
  });
});

describe.skipIf(process.platform === "win32")("createAfterCopyExtraResources (packager >= 19 hook shape)", () => {
  it("takes the single-object argument and uses the platform resources dir", async () => {
    // linux layout: <buildPath>/resources
    const buildPath = path.join(tmp, "stage");
    const res = path.join(buildPath, "resources");
    fs.mkdirSync(path.join(res, "server"), { recursive: true });
    write(src("server/a"));
    write(path.join(res, "server/a"));
    link(src("server/a"), path.join(res, "server/b"));

    const hook = createAfterCopyExtraResources({
      projectDir: project,
      getExtraResources: () => ["./resources/server"],
    });
    await hook({ buildPath, platform: "linux", arch: "x64", electronVersion: "44.9.0" });

    expect(fs.readlinkSync(path.join(res, "server/b"))).toBe("a");
  });

  it("derives <App>.app/Contents/Resources on darwin", () => {
    const buildPath = path.join(tmp, "stage-mac");
    fs.mkdirSync(path.join(buildPath, "PI-Dashboard.app", "Contents", "Resources"), { recursive: true });
    expect(resourcesDirFor(buildPath, "darwin")).toBe(
      path.join(buildPath, "PI-Dashboard.app", "Contents", "Resources"),
    );
    expect(resourcesDirFor(buildPath, "linux")).toBe(path.join(buildPath, "resources"));
  });
});
