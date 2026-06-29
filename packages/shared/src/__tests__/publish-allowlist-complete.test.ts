/**
 * Repo-level invariant: every non-private workspace package in
 * `packages/*` MUST be listed in the `PACKAGES` array of the
 * `Publish to npm` step in `.github/workflows/publish.yml`.
 *
 * Why: the publish step iterates an explicit allowlist (see comment
 * "Publish to npm (idempotent, ordered: sub-packages first, root last)").
 * Workspace packages added after the allowlist was written silently fail
 * to publish — they appear at 0.5.4 locally but stay at their last
 * manually-published version on npm.
 *
 * This regressed at v0.5.4: 5 plugin packages
 * (client-utils, roles-plugin, subagents-plugin,
 * flows-anthropic-bridge-plugin) shipped 0.5.3 via a one-off local
 * `npm publish`, were never added to the allowlist, then stayed at
 * 0.5.3 on npm when CI cut 0.5.4.
 *
 * If this test fails, add the missing package(s) to publish.yml's
 * PACKAGES array, ordering each AFTER every @blackbelt-technology/*
 * dependency it has, and BEFORE the root metapackage
 * `@blackbelt-technology/pi-agent-dashboard`.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const PACKAGES_DIR = path.join(REPO_ROOT, "packages");
const WORKFLOW_PATH = path.join(REPO_ROOT, ".github", "workflows", "publish.yml");

interface WorkspacePkg {
  dir: string;
  name: string;
  version: string;
  private: boolean;
}

function readWorkspacePackages(): WorkspacePkg[] {
  const entries = fs
    .readdirSync(PACKAGES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
  const pkgs: WorkspacePkg[] = [];
  for (const dir of entries) {
    const pkgJsonPath = path.join(PACKAGES_DIR, dir, "package.json");
    if (!fs.existsSync(pkgJsonPath)) continue;
    const raw = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
    if (typeof raw.name !== "string") continue;
    pkgs.push({
      dir,
      name: raw.name,
      version: raw.version,
      private: raw.private === true,
    });
  }
  return pkgs;
}

function extractPackagesArray(yaml: string): string[] {
  // Find the `PACKAGES=(` line and read literal quoted strings until `)`.
  const startRe = /^\s*PACKAGES=\(\s*$/m;
  const m = startRe.exec(yaml);
  if (!m) {
    throw new Error("publish.yml: no `PACKAGES=(` line found");
  }
  const after = yaml.slice(m.index + m[0].length);
  const endIdx = after.indexOf(")");
  if (endIdx === -1) {
    throw new Error("publish.yml: PACKAGES=( has no closing `)`");
  }
  const body = after.slice(0, endIdx);
  const names: string[] = [];
  for (const line of body.split("\n")) {
    const q = line.match(/"([^"]+)"/);
    if (q) names.push(q[1]);
  }
  return names;
}

describe("publish.yml — PACKAGES allowlist completeness", () => {
  const yaml = fs.readFileSync(WORKFLOW_PATH, "utf8");
  const allowlist = extractPackagesArray(yaml);
  const allowlistSet = new Set(allowlist);
  const workspace = readWorkspacePackages();
  const publishable = workspace.filter((p) => !p.private);

  it("extracts a non-empty allowlist", () => {
    expect(allowlist.length).toBeGreaterThan(0);
  });

  it("every non-private workspace package is in PACKAGES", () => {
    const missing = publishable
      .filter((p) => !allowlistSet.has(p.name))
      .map((p) => `${p.name} (packages/${p.dir})`);
    if (missing.length > 0) {
      throw new Error(
        `publish.yml PACKAGES is missing ${missing.length} workspace package(s):\n` +
          missing.map((m) => `  - ${m}`).join("\n") +
          `\n\nAdd each to .github/workflows/publish.yml's PACKAGES=( ... ) array, ` +
          `ordered after its @blackbelt-technology/* deps and before the root ` +
          `metapackage @blackbelt-technology/pi-agent-dashboard.`,
      );
    }
  });

  it("no allowlist entry references a non-existent or private workspace package", () => {
    // The root metapackage is allowed even though it's the workspace root,
    // not under packages/. Tolerate it.
    const ROOT_META = "@blackbelt-technology/pi-agent-dashboard";
    const workspaceNames = new Set(workspace.map((p) => p.name));
    const privateNames = new Set(
      workspace.filter((p) => p.private).map((p) => p.name),
    );
    const bogus: string[] = [];
    for (const entry of allowlist) {
      if (entry === ROOT_META) continue;
      if (!workspaceNames.has(entry)) {
        bogus.push(`${entry} — no such workspace package`);
      } else if (privateNames.has(entry)) {
        bogus.push(`${entry} — workspace is marked "private": true`);
      }
    }
    if (bogus.length > 0) {
      throw new Error(
        "publish.yml PACKAGES contains invalid entries:\n" +
          bogus.map((b) => `  - ${b}`).join("\n"),
      );
    }
  });

  // NOTE: intra-list dep ordering is intentionally NOT enforced.
  // `npm publish` uploads tarballs; it does not resolve deps against
  // the registry. The only ordering invariant that matters is that the
  // root metapackage publishes LAST, because the downstream electron
  // `bundle-server` step runs `npm install` which DOES resolve the root
  // metapackage's sub-package deps from npm.

  it("root metapackage @blackbelt-technology/pi-agent-dashboard is published last", () => {
    const ROOT_META = "@blackbelt-technology/pi-agent-dashboard";
    const idx = allowlist.indexOf(ROOT_META);
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(idx).toBe(allowlist.length - 1);
  });
});
