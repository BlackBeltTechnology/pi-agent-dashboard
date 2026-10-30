/**
 * E87 (encrypt-credentials-at-rest): verify-release-deps floor for `@napi-rs/keyring`.
 *
 * Fixture repo: every file the gates read is copied from the real tree, then the
 * server's `@napi-rs/keyring` declaration is overwritten (2.1.1 fails, 2.1.2 passes,
 * missing fails). Exemplar: verify-release-deps-openspec-floor.test.mjs.
 *
 * See change: encrypt-credentials-at-rest.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { collectFailures } from "../verify-release-deps.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const CARRIED = [
  "packages/server/package.json",
  "packages/extension/package.json",
  "packages/shared/package.json",
  "packages/client/package.json",
  "docker/Dockerfile",
  "pnpm-workspace.yaml",
];
const tmpDirs = [];
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** `version === undefined` deletes the declaration. */
function fixtureWithKeyring(version) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "verify-release-deps-keyring-"));
  tmpDirs.push(root);
  for (const rel of CARRIED) {
    const dest = path.join(root, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, rel), dest);
  }
  const serverPath = path.join(root, "packages/server/package.json");
  const pkg = JSON.parse(fs.readFileSync(serverPath, "utf-8"));
  if (version === undefined) delete pkg.dependencies["@napi-rs/keyring"];
  else pkg.dependencies["@napi-rs/keyring"] = version;
  fs.writeFileSync(serverPath, JSON.stringify(pkg, null, 2));
  return root;
}

const keyringFailures = (root) => collectFailures({ repoRoot: root }).filter((f) => f.includes("@napi-rs/keyring"));

describe("E87: @napi-rs/keyring release floor", () => {
  it("E87: 2.1.2 passes", () => {
    expect(keyringFailures(fixtureWithKeyring("2.1.2"))).toEqual([]);
  });

  it("E87: 2.1.1 fails as a Stale pin", () => {
    const failures = keyringFailures(fixtureWithKeyring("2.1.1"));
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("Stale pin");
  });

  it("E87: a missing declaration fails", () => {
    const failures = keyringFailures(fixtureWithKeyring(undefined));
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("Missing");
  });

  it("E87: the real tree declares the floor", () => {
    expect(keyringFailures(REPO_ROOT)).toEqual([]);
  });
});
