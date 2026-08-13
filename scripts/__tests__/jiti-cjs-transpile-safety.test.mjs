/**
 * Repo gate for the `jiti-cjs-transpile-safety` capability.
 *
 * No first-party TypeScript that jiti evaluates at runtime may transpile to
 * CommonJS retaining `import.meta` in code position — that shape is a
 * `SyntaxError` inside jiti's `vm` wrapper and forces its native-ESM fallback,
 * which hands the module over as a `data:text/javascript;base64,…` specifier.
 * Node accepts such a specifier; a Bun single-file executable resolves it as a
 * package name and dies with `NameTooLong` before the agent runs (issue #408).
 *
 * Detection is AST-level, discovery is a derived rule — both load-bearing; see
 * `scripts/lib-jiti-scope.mjs`.
 *
 * See change: fix-jiti-cjs-transpile-safety.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkFile,
  discoverJitiLoadedFiles,
  discoverSeeds,
  hasCodePositionImportMeta,
  isExcludedPath,
  repoRoot,
  transformToCjs,
} from "../lib-jiti-scope.mjs";

const FIXTURES = path.join(repoRoot, "scripts/__tests__/fixtures/jiti-transpile");
const fixture = (name) => {
  const abs = path.join(FIXTURES, name);
  return hasCodePositionImportMeta(transformToCjs(fs.readFileSync(abs, "utf8"), abs));
};

const seeds = discoverSeeds();
const files = discoverJitiLoadedFiles();

describe("gate fails closed", () => {
  it("reports a cast-wrapped import.meta fixture", () => {
    expect(fixture("cast-wrapped.ts")).toBe(true);
  });

  it("does not report a comment-only mention", () => {
    expect(fixture("comment-only.ts")).toBe(false);
  });

  it("does not report a string-literal mention", () => {
    expect(fixture("string-literal.ts")).toBe(false);
  });

  it("does not report erasable shapes (url, called and uncalled resolve)", () => {
    expect(fixture("erasable-shapes.ts")).toBe(false);
  });

  it("treats an empty discovery set as a discovery failure, not a pass", () => {
    // No hardcoded count floor — a magic number breaks under legitimate
    // workspace restructuring and buys nothing the fixture proof lacks.
    expect(
      files.length,
      "jiti scope discovery yielded no files — the discovery rule is broken, " +
        "not the repo clean. Check scripts/lib-jiti-scope.mjs seeds.",
    ).toBeGreaterThan(0);
  });
});

describe("scope is a derived rule", () => {
  it("seed 1 — pi.extensions is a superset of the four known entry points", () => {
    // Superset, not equality: equality would go red exactly when a fifth
    // extension is added correctly.
    for (const e of [
      "packages/extension/src/bridge.ts",
      "packages/image-fit-extension/src/extension.ts",
      "packages/kb-extension/src/extension.ts",
      "packages/mockup-loop/src/extension.ts",
    ]) {
      expect(seeds.piExtensions).toContain(e);
    }
  });

  it("seed 2 — a jiti-bootstrapped `main: *.ts` workspace pulls its whole src tree", () => {
    // `packages/server` declares `main: src/cli.ts`; `bin` is the `.mjs`
    // wrapper, so a `bin`-keyed limb cannot find this.
    expect(seeds.mainTs).toContain("packages/server/src/cli.ts");
    // ...but `main: *.ts` alone is NOT the rule. `packages/bus-client` declares
    // one too and is a plain library no host re-execs through jiti; seeding on
    // `main` alone would sweep its whole `src/**` in on a mechanism it does not
    // share. The seed additionally requires a `bin` wrapper that boots jiti.
    expect(seeds.mainTs).not.toContain("packages/bus-client/src/index.ts");
    expect(files).toContain("packages/server/src/server.ts");
    // Non-vacuity of the erasure assertions below depends on this seed.
    expect(files).toContain("packages/server/src/changelog/changelog-fs.ts");
  });

  it("seed 3 — plugin server/bridge entries are a superset of the twelve known", () => {
    for (const e of [
      "packages/apple-tools/src/server/index.ts",
      "packages/automation-plugin/src/server/index.ts",
      "packages/flows-anthropic-bridge-plugin/src/server/index.ts",
      "packages/flows-plugin/src/server/index.ts",
      "packages/goal-plugin/src/server/index.ts",
      "packages/hermes-memory-plugin/src/server/index.ts",
      "packages/kb-plugin/src/server/index.ts",
      "packages/subagents-plugin/src/server/index.ts",
      "packages/automation-plugin/src/bridge/index.ts",
      "packages/flows-anthropic-bridge-plugin/src/bridge/index.ts",
      "packages/flows-plugin/src/bridge/index.ts",
      "packages/goal-plugin/src/bridge/index.ts",
    ]) {
      expect(seeds.pluginEntries).toContain(e);
    }
  });

  it("the walk reaches dashboard-plugin-runtime/src/server via seed 2", () => {
    // Reached from `packages/server/src/server.ts`, NOT from `bridge.ts`, which
    // has no edge to it. Asserted as a walk outcome, never hardcoded as a seed.
    expect(seeds.piExtensions.concat(seeds.mainTs, seeds.pluginEntries)).not.toContain(
      "packages/dashboard-plugin-runtime/src/server/loader.ts",
    );
    expect(files.some((f) => f.startsWith("packages/dashboard-plugin-runtime/src/server/"))).toBe(
      true,
    );
  });

  it("the walk reaches the bridge's tool-registry graph", () => {
    expect(files).toContain("packages/extension/src/bridge.ts");
    expect(files).toContain("packages/shared/src/tool-registry/strategies.ts");
  });

  it("excludes build output, tests, and Vite-only client source", () => {
    // `packages/electron/out` is gitignored, exists after a local build, and
    // contains `.tsx` retaining `import.meta` — a naive walk goes red only on
    // developer machines.
    expect(isExcludedPath(path.join("packages", "electron", "out", "main.tsx"))).toBe(true);
    expect(isExcludedPath(path.join("packages", "client", "src", "App.tsx"))).toBe(true);
    expect(isExcludedPath(path.join("packages", "server", "src", "x.test.ts"))).toBe(true);
    expect(files.every((f) => !isExcludedPath(f))).toBe(true);
    // `packages/client-utils` is a HARD exclusion, not a reachability outcome:
    // it IS transitively reachable (via `shared/src/dashboard-plugin/
    // ui-primitives.ts`) and is kept out anyway because Vite, not jiti,
    // compiles it. Adding a workspace to that list narrows the gate.
    expect(files.some((f) => f.startsWith("packages/client-utils/"))).toBe(false);
  });

  it("excludes raw-.ts bin entries not reached by a seed", () => {
    // They carry `#!/usr/bin/env node` and run under Node's native
    // type-stripping as ESM — no CJS wrapper, so the fault class cannot arise.
    for (const b of [
      "packages/dashboard-plugin-skill/src/bin/scaffold.ts",
      "packages/nano-banana/src/bin/nano-banana.ts",
      "packages/video-production/src/bin/veo.ts",
      "packages/video-transcription/src/bin/transcribe.ts",
    ]) {
      expect(files).not.toContain(b);
    }
  });
});

describe("no jiti-loaded module retains import.meta in code position", () => {
  it("the erasable-shape files in the repo stay green", () => {
    // Both use `import.meta` in CODE position — `model-tracker.ts:143` is a
    // direct uncast `import.meta.resolve(spec)`, `changelog-fs.ts:103,120` are
    // `createRequire(import.meta.url)` and a bare `import.meta.url`. They are
    // green because jiti ERASES those shapes; they prove the erasure limb.
    for (const f of [
      "packages/extension/src/model-tracker.ts",
      "packages/server/src/changelog/changelog-fs.ts",
    ]) {
      expect(files, `${f} must be in scope or this assertion is vacuous`).toContain(f);
      expect(checkFile(f).violates, `${f} unexpectedly retains import.meta`).toBe(false);
    }
  });

  it("every discovered file transpiles cleanly", () => {
    const violations = files.filter((f) => checkFile(f).violates);
    expect(
      violations,
      `These modules retain \`import.meta\` after jiti's CommonJS transform and will\n` +
        `force jiti's native-ESM \`data:\` URL fallback (fatal on Bun hosts, issue #408).\n` +
        `Fix: drop the TypeScript cast and call \`import.meta.<x>\` directly.\n` +
        violations.map((v) => `  - ${v}`).join("\n"),
    ).toEqual([]);
  });

  it("strategies.ts transpiles to jitiESMResolve with no code-position import.meta", () => {
    const res = checkFile("packages/shared/src/tool-registry/strategies.ts");
    expect(res.emitted).toContain("jitiESMResolve(");
    expect(res.violates).toBe(false);
  });
});
