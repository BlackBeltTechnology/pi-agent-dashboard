/**
 * Repo-lint — the client's direct build-time requirements MUST be runtime
 * `dependencies`, not `devDependencies`.
 *
 * pi installs extensions with `npm install --omit=dev`, which drops
 * `devDependencies`. The `@blackbelt-technology/pi-dashboard-web` workspace's
 * `prepare` script runs a Vite build, so any build-time requirement parked in
 * `devDependencies` makes `pi install git:...` die with
 * `Cannot find module 'vite/package.json'` (issue #357).
 *
 * `tsx` is asserted in `dependencies` but NOT asserted absent from
 * `devDependencies` elsewhere — the root and `packages/server` tsx declarations
 * are deliberate and out of scope here. The four Vite/Tailwind packages must be
 * in exactly one bucket, so a half-finished move is caught too.
 *
 * `scripts/verify-release-deps.mjs` carries the same rules as a release gate;
 * this lint fails the ordinary test run so a regression is caught long before
 * `release-cut`.
 *
 * See change: fix-pi-install-node26-and-omit-dev-build (test-plan #E6).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..", "..", "..");
const CLIENT_PKG_JSON = path.join(REPO_ROOT, "packages/client/package.json");

/** Imported by `vite.config.ts` / `src/index.css` / `scripts/vite-build.mjs`. */
const BUILD_DEPS = [
  "vite",
  "@vitejs/plugin-react",
  "@tailwindcss/vite",
  "tailwindcss",
  "tsx",
] as const;

/** The subset that must ALSO be absent from devDependencies (no split decl). */
const MUST_NOT_BE_DEV = BUILD_DEPS.filter((d) => d !== "tsx");

function readClientPkg(): {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
} {
  const pkg = JSON.parse(fs.readFileSync(CLIENT_PKG_JSON, "utf-8"));
  return {
    dependencies: pkg.dependencies ?? {},
    devDependencies: pkg.devDependencies ?? {},
  };
}

describe("client build deps survive --omit=dev", () => {
  it("declares every direct build-time requirement in dependencies", () => {
    const { dependencies } = readClientPkg();
    const missing = BUILD_DEPS.filter((d) => !(d in dependencies));

    expect(
      missing,
      "packages/client/package.json must declare these in `dependencies` — " +
        "`npm install --omit=dev` drops devDependencies and the client " +
        "`prepare` Vite build then fails (issue #357). Missing:\n  " +
        `${missing.join("\n  ")}`,
    ).toEqual([]);
  });

  it("keeps none of the Vite/Tailwind build deps in devDependencies", () => {
    const { devDependencies } = readClientPkg();
    const stray = MUST_NOT_BE_DEV.filter((d) => d in devDependencies);

    expect(
      stray,
      "These build deps were moved back into packages/client " +
        "`devDependencies`, re-breaking the `--omit=dev` git-install path:\n  " +
        `${stray.join("\n  ")}`,
    ).toEqual([]);
  });
});
