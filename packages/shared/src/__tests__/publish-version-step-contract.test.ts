/**
 * publish-version-step-contract.test.ts — static contract for the release
 * pipeline's version stamping (`publish.yml`).
 *
 * `npm version --workspaces` reifies the whole tree after bumping. Under the
 * `npm@latest` the publish job installs for OIDC, that reify refuses the
 * server's remote-tarball dep (`xlsx@https://cdn.sheetjs.com/...`) with
 * EALLOWREMOTE, failing the v0.9.0 publish before anything was published.
 * `npm pkg set version=` writes the field only (no reify, no prepare) —
 * the same choice `_electron-build.yml` already made.
 */

import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const publishYml = fs.readFileSync(path.resolve(here, "../../../../.github/workflows/publish.yml"), "utf-8");

describe("publish.yml version stamping", () => {
  it("never stamps versions with `npm version` (reify trips EALLOWREMOTE on remote-tarball deps)", () => {
    expect(publishYml).not.toMatch(/^\s*(run:\s*)?npm version\b/m);
  });

  it("stamps every workspace + root via `npm pkg set version=`", () => {
    const sets = publishYml.match(/npm pkg set version=\S+[^\n]*--workspaces[^\n]*--include-workspace-root/g) ?? [];
    expect(sets.length).toBeGreaterThanOrEqual(2); // tag-and-push bump + publish stamp
  });
});
