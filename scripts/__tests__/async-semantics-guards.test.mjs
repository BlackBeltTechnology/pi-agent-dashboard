/**
 * Static guards for `cleanup-async-semantics-server-extension`
 * (test-plan #E1, #E2, #E3, #E6).
 *
 * Harness glue mirrors `scripts/__tests__/lint-ledger.test.mjs` (shell out to
 * Biome once with `--reporter=json`, judge git-tracked files only) and
 * `scripts/__tests__/verify-release-deps-openspec-floor.test.mjs`.
 *
 * Why these are ledger/tree guards rather than diff guards: the scenarios are
 * phrased over "the post-change diff", but CI checks out at depth 1
 * (`actions/checkout@v4`, no `fetch-depth`), so `origin/develop` does not exist
 * there and a diff-scoped guard would resolve an EMPTY diff and pass
 * vacuously — the exact failure mode where a green run proves nothing. These
 * run against the tree instead, with a frozen pre-change baseline supplying the
 * "what this change added" axis.
 *
 * See change: cleanup-async-semantics-server-extension.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { newBareVoidSites, SCANNED_EXTENSIONS, scanBareVoidDiscards } from "../bare-void-scan.mjs";
import { enumerateSites, runBiomeRule, sitesOwnedBy } from "../lint-ledger.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CHANGE = "cleanup-async-semantics-server-extension";
/** Packages this change owns. Mirrors LADDER_SCOPES for the same rung. */
const OWNED = ["packages/server", "packages/extension", "packages/electron"];

const baseline = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "scripts/__tests__/fixtures/bare-void-baseline.json"), "utf8"),
);

function git(args) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

/**
 * Biome sites for one rule, restricted to git-tracked files.
 *
 * The tracked filter is not cosmetic: sibling tests in this project write
 * transient fixtures into the source tree while running in parallel, and a
 * repo-wide Biome invocation would see them. Same reasoning as
 * `lint-ledger.test.mjs` — and `runBiomeRule` extends that tolerance to the
 * process exit code, which Biome sets non-zero for any diagnostic at all.
 */
function liveSites(rule) {
  return enumerateSites(runBiomeRule(rule, { cwd: repoRoot })).filter((site) =>
    trackedFiles.has(site.slice(0, site.lastIndexOf(":"))),
  );
}

let trackedFiles = new Set();
let ownedFiles = [];
beforeAll(() => {
  trackedFiles = new Set(git(["ls-files"]).split("\n").filter(Boolean));
  ownedFiles = git(["ls-files", ...OWNED])
    .split("\n")
    .filter((f) => f && SCANNED_EXTENSIONS.test(f));
});

const ARTIFACT_TEST = "packages/server/src/__tests__/pi-resource-activation-timeout.test.ts";

/**
 * `function name(params): void`, tolerating one level of nested parens in the
 * parameter list — `withPiResolve(impl: () => Promise<unknown>): void` is
 * exactly that shape, and a naive `\([^)]*\)` stops at the arrow's `)`.
 */
const VOID_FUNCTION = /function\s+([A-Za-z_$][\w$]*)\s*\((?:[^()]|\([^()]*\))*\)\s*:\s*void\b/g;

/**
 * `const name = (params): void => …` and `const name: () => void = …`.
 * Declaration form matters: a syntax-only guard that only knew `function`
 * declarations would miss `const settle = (): void => {}; await settle();`.
 */
const VOID_ARROW =
  /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*\([^)]*\)\s*=>\s*void\b|=\s*(?:async\s*)?\((?:[^()]|\([^()]*\))*\)\s*:\s*void\b)/g;

describe("E1: a non-promise inference artifact takes an annotation, not an await", () => {
  it("`withPiResolve` is annotated `: void`", () => {
    const src = fs.readFileSync(path.join(repoRoot, ARTIFACT_TEST), "utf8");
    // The annotation IS the fix (design D7). Without it the three call sites
    // re-report as floating promises.
    expect(src).toMatch(/function\s+withPiResolve\s*\((?:[^()]|\([^()]*\))*\)\s*:\s*void\b/);
  });

  it("no call site awaits it — the helper returns undefined", () => {
    const src = fs.readFileSync(path.join(repoRoot, ARTIFACT_TEST), "utf8");
    // `await undefined` is a no-op documenting a defect that does not exist.
    expect(src).not.toMatch(/await\s+withPiResolve\s*\(/);
  });

  it("Biome reports zero floating promises for that file", () => {
    const out = execFileSync(
      "npx",
      ["biome", "lint", "--only=lint/nursery/noFloatingPromises", ARTIFACT_TEST, "--reporter=json"],
      { cwd: repoRoot, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] },
    );
    expect(enumerateSites(JSON.parse(out))).toEqual([]);
  }, 120_000);
});

describe("E2: no `await` was applied to an expression that is not a promise", () => {
  /**
   * Type-lite but non-vacuous: collect every helper in the owned packages that
   * is *declared* to return `void`, then assert nothing awaits one. This is the
   * generalisation of the `withPiResolve` artifact — the class of mistake the
   * rule's own suggested fix would have produced.
   */
  it("nothing awaits a function or arrow declared to return `void`", () => {
    // Matching is per-file, not repo-wide by name. Several suites declare their
    // own local `git()` / `build()` helpers, some `: void` and some
    // `: Promise<void>`; a global name table flags awaiting the async ones,
    // which is correct code. A `void` helper is module-local, so its declaring
    // file is the only place an await of it can be wrong.
    const seenNames = new Set();
    const offenders = [];
    for (const file of ownedFiles) {
      const src = fs.readFileSync(path.join(repoRoot, file), "utf8");
      for (const re of [VOID_FUNCTION, VOID_ARROW]) {
        for (const m of src.matchAll(re)) {
          const name = m[1];
          seenNames.add(name);
          if (new RegExp(`await\\s+${name}\\s*\\(`).test(src)) {
            offenders.push(`${file}: await ${name}(`);
          }
        }
      }
    }
    // The artifact this change fixed must be among them, or the guard is inert.
    expect([...seenNames]).toContain("withPiResolve");
    expect(offenders).toEqual([]);
  });

  it("detects an awaited `void` arrow, not just a `function` declaration", () => {
    // Pins the arrow form explicitly: the guard is syntax-only (no type
    // information), so its blind spots have to be closed by example.
    const sample = "const settle = (): void => {};\nawait settle();";
    const names = [...sample.matchAll(VOID_ARROW)].map((m) => m[1]);
    expect(names).toContain("settle");
    expect(new RegExp(`await\\s+settle\\s*\\(`).test(sample)).toBe(true);
  });
});

/**
 * SCOPE, stated precisely because the assertion is easy to over-read: this is a
 * CHANGE-SCOPED baseline guard, not a repo-wide prohibition. 54 bare discards
 * predate this change across the three packages; they are recorded in the
 * fixture and explicitly permitted. What the guard proves is that the live set
 * never grows. Driving the baseline to zero is a separate rung's job.
 */
describe("E3: no NEW bare `void` discard (change-scoped baseline guard)", () => {
  it("the baseline fixture is non-empty, so a subset check can actually fail", () => {
    // Guards the guard: an empty baseline would make the subset assertion below
    // pass for any tree.
    expect(baseline.sites.length).toBeGreaterThan(0);
  });

  it("this change introduced no new bare `void` discard", () => {
    const live = scanBareVoidDiscards(
      (f) => fs.readFileSync(path.join(repoRoot, f), "utf8"),
      ownedFiles,
    );
    const added = newBareVoidSites(live, baseline.sites);
    expect(added, `new bare void discards:\n${added.join("\n")}`).toEqual([]);
  });

  it("the discards this change DID add are the guarded form", () => {
    // Positive assertion — the subset check above cannot distinguish "added a
    // guarded discard" from "added nothing at all".
    const main = fs.readFileSync(path.join(repoRoot, "packages/electron/src/main.ts"), "utf8");
    expect(main).toMatch(/void quit\(\)\.catch\(/);
    const wiring = fs.readFileSync(
      path.join(repoRoot, "packages/extension/src/__tests__/prompt-bus-wiring.test.ts"),
      "utf8",
    );
    expect(wiring).toMatch(/void present\(\)\.catch\(/);
  });

  it("a bare discard is detected and a guarded one is not", () => {
    // Unit-checks the scanner itself, so a regex that silently matches nothing
    // cannot make the tree assertions vacuous.
    const files = ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"];
    const sources = {
      "a.ts": "void doThing();",
      "b.ts": "void doThing().catch((e) => log(e));",
      "c.ts": "function f(): void {}\n * void inACommentBlock();",
      // Regression: comments discuss this very pattern at the sites that apply
      // it, and an earlier scanner reported those comments as violations.
      "d.ts": "// void promise.then(clearPending, onErr) is the guarded form",
      "e.ts": "const x = 1; // void doThing();",
    };
    const hits = scanBareVoidDiscards((f) => sources[f], files);
    expect(hits).toEqual(["a.ts\tvoid doThing();"]);
  });

  it("a `//` inside a string does not hide a discard after it", () => {
    // Without string-blanking the line truncates at the URL and the real
    // discard escapes the scan entirely.
    const line = 'const u = "http://x"; void work();';
    expect(scanBareVoidDiscards(() => line, ["s.ts"])).toEqual([`s.ts\t${line}`]);
  });

  it("an EMPTY `.catch()` is not a guarded discard", () => {
    // `.catch()` installs no handler, so the rejection is still swallowed —
    // D1 requires the handler to exist.
    expect(scanBareVoidDiscards(() => "void work().catch();", ["t.ts"])).toEqual([
      "t.ts\tvoid work().catch();",
    ]);
    expect(scanBareVoidDiscards(() => "void work().catch((e) => log(e));", ["u.ts"])).toEqual([]);
  });
});

describe("E6: graduation — this change's claimed sites are clear", () => {
  it("both rules report zero across the owned packages", () => {
    for (const rule of ["noFloatingPromises", "noMisusedPromises"]) {
      const mine = sitesOwnedBy(liveSites(rule), CHANGE);
      expect(mine, `${rule} still open in this change's scope`).toEqual([]);
    }
  }, 180_000);

  it("both rules report zero repo-wide, so the ratchet can graduate", () => {
    // The ratchet in `code-quality-loop` graduates on repo-root `biome lint .`.
    // The sibling rung landed first, so after this change the whole ladder is
    // discharged — including `tunnel-core.ts:156,167`, which the sibling fixed.
    for (const rule of ["noFloatingPromises", "noMisusedPromises"]) {
      expect(liveSites(rule), `${rule} still has sites repo-wide`).toEqual([]);
    }
  }, 180_000);
});
