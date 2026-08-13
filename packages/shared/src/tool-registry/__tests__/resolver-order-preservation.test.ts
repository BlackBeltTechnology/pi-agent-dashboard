/**
 * Behaviour-preservation contract for `defaultResolveModule`'s reorder to
 * `createRequire → dir-walk → ESM resolve`, plus the inert-guard property.
 *
 * These exist because **the existing suite cannot see this change**: under a
 * vitest-native import `import.meta.resolve` is present but throws for a bare
 * specifier, so the ESM step is dead before AND after the reorder. "Existing
 * tests still green" is a vacuous signal here.
 *
 * So every assertion below drives `strategies.ts` through **jiti's real
 * CommonJS transform**, evaluated in the same wrapper shape jiti uses in
 * production, with `jitiESMResolve` — the function jiti substitutes for
 * `import.meta.resolve` — replaced by a counting spy. That is the only way to
 * observe whether the ESM step fires at all.
 *
 * See change: fix-jiti-cjs-transpile-safety.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createJiti } from "jiti";
import { afterAll, describe, expect, it } from "vitest";
import type { StrategyCtx } from "../types.js";

const CTX: StrategyCtx = { overrides: {}, platform: "linux", env: {} };
const STRATEGIES = fileURLToPath(new URL("../strategies.ts", import.meta.url));
const REPO_ROOT = path.resolve(path.dirname(STRATEGIES), "../../../..");

type Strategies = typeof import("../strategies.js");
type Spy = { calls: string[]; impl: (id: string) => string };

/**
 * Load a `strategies.ts` source through jiti's CommonJS transform and evaluate
 * it in jiti's own wrapper shape, wiring `jitiESMResolve` to a spy.
 *
 * This is the shipped path: jiti transpiles to CJS and runs the module in a
 * `vm` function wrapper whose `jitiESMResolve` parameter is what a
 * `import.meta.resolve(id)` call compiles down to.
 */
function loadAsCjs(source: string, spy: Spy): Strategies {
  const jiti = createJiti(pathToFileURL(STRATEGIES).href);
  const emitted = jiti.transform({ source, filename: STRATEGIES, ts: true });
  const mod = { exports: {} as Strategies };
  const fn = new Function(
    "exports",
    "require",
    "module",
    "__filename",
    "__dirname",
    "jitiESMResolve",
    emitted,
  );
  fn(
    mod.exports,
    (id: string) => jiti(id),
    mod,
    STRATEGIES,
    path.dirname(STRATEGIES),
    (id: string) => {
      spy.calls.push(id);
      return spy.impl(id);
    },
  );
  return mod.exports;
}

const newSpy = (impl: Spy["impl"] = () => "unresolved:none"): Spy => ({ calls: [], impl });

const currentSource = fs.readFileSync(STRATEGIES, "utf8");

// ── Fixture node_modules trees ──────────────────────────────────────────────
// The dir-walk reads the real filesystem (`existsSync` / `readFileSync` are not
// injectable), so the three shapes where the two resolvers demonstrably
// disagree have to exist on disk.

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "resolver-order-"));
/** A second tree, deliberately NOT nested under `tmp`, for the anchor case. */
const otherTmp = fs.mkdtempSync(path.join(os.tmpdir(), "resolver-anchor-"));
afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(otherTmp, { recursive: true, force: true });
});

const ANCHOR = pathToFileURL(path.join(tmp, "anchor.ts")).href;

function installFixture(name: string, manifest: unknown, files: string[]): string {
  const dir = path.join(tmp, "node_modules", name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(manifest, null, 2));
  for (const f of files) {
    const abs = path.join(dir, f);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, "module.exports = {};\n");
  }
  return dir;
}

// Every fixture is also shaped so that **step 1 misses**. That is not padding:
// steps 2 and 3 are only reached when `createRequire().resolve` fails, so a
// fixture that step 1 answers would test nothing about their order. Step 1 is
// defeated by pointing the require-resolvable target at a file that is absent —
// the same class of miss the live `@earendil-works/*` packages produce with
// their `import`-only exports maps.

// (i) no `exports`, has `module` + `main` → ESM picks `main`, dir-walk `module`.
const FIX_MOD = installFixture(
  "shape-module-field",
  { name: "shape-module-field", main: "absent-main.js", module: "mod-field.js" },
  ["mod-field.js"],
);
// (ii) `exports["."]` nesting `node` / `default` → ESM picks `node`, dir-walk `default`.
const FIX_COND = installFixture(
  "shape-conditional",
  {
    name: "shape-conditional",
    exports: {
      ".": { require: "./absent-cjs.js", node: "./node-esm.js", default: "./browser.js" },
    },
  },
  ["node-esm.js", "browser.js"],
);
// (iii) `exports` with subpaths only, no `"."` → ESM throws, dir-walk uses `main`.
const FIX_SUB = installFixture(
  "shape-subpaths-only",
  { name: "shape-subpaths-only", main: "main.js", exports: { "./sub": "./absent-sub.js" } },
  ["main.js"],
);

describe("the reorder preserves the dir-walk's answer (tasks 2.1–2.3)", () => {
  const cases = [
    ["shape-module-field", path.join(FIX_MOD, "mod-field.js"), "module field beats main"],
    ["shape-conditional", path.join(FIX_COND, "browser.js"), "default condition, not node"],
    ["shape-subpaths-only", path.join(FIX_SUB, "main.js"), "main, where ESM would throw"],
  ] as const;

  for (const [pkg, expected, why] of cases) {
    it(`${pkg}: the dir-walk's path is what is returned (${why})`, () => {
      const spy = newSpy(() => pathToFileURL(path.join(tmp, "WRONG.js")).href);
      const { bareImportStrategy } = loadAsCjs(currentSource, spy);
      const r = bareImportStrategy(pkg, ANCHOR).run(CTX);
      expect(r).toEqual({ ok: true, path: expected });
    });
  }
});

describe("the ESM step is an inert guard (task 2.3a)", () => {
  it("is invoked zero times for every fixture shape", () => {
    // The assertion that would have caught the withdrawn "the ESM step recovers
    // a case the dir-walk cannot" claim: it recovers nothing, because it never
    // runs. A path-equality assertion alone cannot distinguish "never ran" from
    // "ran and agreed".
    const spy = newSpy(() => pathToFileURL(path.join(tmp, "WRONG.js")).href);
    const { bareImportStrategy } = loadAsCjs(currentSource, spy);
    for (const pkg of ["shape-module-field", "shape-conditional", "shape-subpaths-only"]) {
      bareImportStrategy(pkg, ANCHOR).run(CTX);
    }
    expect(spy.calls).toEqual([]);
  });

  it("contains a throwing ESM step instead of propagating it", () => {
    // The assertion of record is error CONTAINMENT. Asserting only the `null`
    // return would pass even if the guard were deleted, since `null` is the
    // natural terminus of the chain.
    const spy = newSpy(() => {
      throw new Error("ERR_UNSUPPORTED_RESOLVE_REQUEST");
    });
    const { bareImportStrategy } = loadAsCjs(currentSource, spy);
    let r: ReturnType<ReturnType<Strategies["bareImportStrategy"]>["run"]> | undefined;
    expect(() => {
      r = bareImportStrategy("no-such-package-anywhere", ANCHOR).run(CTX);
    }).not.toThrow();
    expect(r?.ok).toBe(false);
    expect(spy.calls).toEqual(["no-such-package-anywhere"]);
  });

  it("ignores a non-`file:` ESM result", () => {
    const spy = newSpy(() => "https://example.invalid/x.js");
    const { bareImportStrategy } = loadAsCjs(currentSource, spy);
    expect(bareImportStrategy("no-such-package-anywhere", ANCHOR).run(CTX).ok).toBe(false);
  });
});

describe("preconditions that make the guard inert (task 2.3b)", () => {
  // Contract documentation, not regressions: these assert CURRENT behaviour so
  // a future change cannot void the inert-guard requirement silently.

  it("a subpath id makes the guard reachable — the dir-walk returns null", () => {
    const recovered = path.join(FIX_SUB, "sub.js");
    const spy = newSpy(() => pathToFileURL(recovered).href);
    const { bareImportStrategy } = loadAsCjs(currentSource, spy);
    // `node_modules/shape-subpaths-only/sub/package.json` does not exist, so the
    // dir-walk's literal join misses and the ESM step fires.
    const r = bareImportStrategy("shape-subpaths-only/sub", ANCHOR).run(CTX);
    expect(spy.calls).toEqual(["shape-subpaths-only/sub"]);
    expect(r).toEqual({ ok: true, path: recovered });
  });

  it("a non-default anchor makes the two steps search different trees", () => {
    // The dir-walk walks from `anchor`; the ESM step ignores it and resolves
    // against this module's own URL. Unreachability depends on them coinciding,
    // which only the default anchor guarantees.
    const elsewhere = pathToFileURL(path.join(otherTmp, "anchor.ts")).href;
    const fromOwnTree = path.join(REPO_ROOT, "node_modules", "acorn", "dist", "acorn.js");
    const spy = newSpy(() => pathToFileURL(fromOwnTree).href);
    const { bareImportStrategy } = loadAsCjs(currentSource, spy);
    const r = bareImportStrategy("shape-module-field", elsewhere).run(CTX);
    // The fixture package exists in `tmp`'s tree, but the anchor points at a
    // tree that has none — so the dir-walk misses while the guard, which
    // ignores `anchor` entirely, still answers from a different tree.
    expect(spy.calls).toEqual(["shape-module-field"]);
    expect(r).toEqual({ ok: true, path: fromOwnTree });
  });
});

/**
 * The pre-change source, committed as a fixture rather than read from
 * `origin/develop`. A git-ref read would silently SKIP on a shallow clone or an
 * unfetched remote — and this is the only assertion that does not let the new
 * implementation agree with itself, so skipping it is exactly the vacuity this
 * change's history keeps producing.
 */
const baselineSource = fs.readFileSync(
  path.join(path.dirname(STRATEGIES), "__tests__/fixtures/strategies.pre-change.ts.txt"),
  "utf8",
);

describe("live-registry invariant (task 2.4)", () => {
  const LIVE = ["@earendil-works/pi-coding-agent", "@earendil-works/pi-ai"] as const;

  const resolveAllWith = (bareImportStrategy: Strategies["bareImportStrategy"]) =>
    Object.fromEntries(
      LIVE.map((pkg) => {
        const r = bareImportStrategy(pkg).run(CTX);
        return [pkg, r.ok ? r.path : null];
      }),
    );

  it("resolves both live packages to ./dist/index.js", () => {
    // A real ESM resolver behind the guard — so if the guard DID fire, it would
    // return a genuine answer rather than a rigged one. It does not fire (that
    // is proven separately by the zero-call-count test), so this spy is not
    // invoked; wiring it real is what keeps this test from being rigged.
    const spy = newSpy((id) => import.meta.resolve(id));
    const after = resolveAllWith(loadAsCjs(currentSource, spy).bareImportStrategy);
    for (const pkg of LIVE) expect(after[pkg]).toMatch(/dist[/\\]index\.js$/);
  });

  it("resolves to the identical path the PRE-CHANGE chain produced", async () => {
    // Captured from the pre-change source, NOT from the new implementation
    // agreeing with itself.
    //
    // The baseline cannot be run through `loadAsCjs`: its cast-wrapped
    // `import.meta` is exactly what makes the CJS wrapper throw (see the
    // regression test below). So it is loaded the way production Node loads it
    // — through jiti, which falls back to native ESM. The temp copy lives beside
    // the original so its relative imports still resolve.
    const sidecar = path.join(path.dirname(STRATEGIES), `.baseline-strategies.${process.pid}.ts`);
    fs.writeFileSync(sidecar, baselineSource);
    try {
      const jiti = createJiti(pathToFileURL(STRATEGIES).href);
      const baseline = (await jiti.import(sidecar)) as Strategies;
      const spy = newSpy((id) => import.meta.resolve(id));
      expect(resolveAllWith(loadAsCjs(currentSource, spy).bareImportStrategy)).toEqual(
        resolveAllWith(baseline.bareImportStrategy),
      );
    } finally {
      fs.rmSync(sidecar, { force: true });
    }
  });
});

describe("the CJS wrapper regression itself (issue #408)", () => {
  it("the baseline fixture really is the pre-change source", () => {
    // Anti-rot: a fixture that drifted into a copy of the CURRENT source would
    // make the comparison above a tautology.
    expect(baselineSource).toContain("(import.meta as unknown as");
    expect(baselineSource).not.toEqual(currentSource);
    // Independent cross-check when the remote ref happens to be available; the
    // suite never depends on it.
    try {
      const fromGit = execFileSync(
        "git",
        ["show", `origin/develop:${path.relative(REPO_ROOT, STRATEGIES)}`],
        { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      );
      expect(baselineSource).toEqual(fromGit);
    } catch {
      // Shallow clone / unfetched remote — the fixture stands on its own.
    }
  });

  it("the pre-change source cannot even be evaluated as CommonJS", () => {
    // The fault, reproduced at its root: a cast-wrapped `import.meta` survives
    // jiti's transform, and jiti's `vm` wrapper rejects it. That SyntaxError is
    // what drives jiti to its native-ESM `data:` URL fallback, which a Bun
    // single-file host resolves as a package name and kills the process over.
    expect(() => loadAsCjs(baselineSource, newSpy())).toThrow(/import\.meta/);
  });

  it("the current source evaluates as CommonJS cleanly", () => {
    expect(() => loadAsCjs(currentSource, newSpy())).not.toThrow();
  });
});
