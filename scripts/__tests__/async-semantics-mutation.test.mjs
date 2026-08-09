/**
 * Mutation check for the test files this change edited (test-plan #X15).
 *
 * Design D3 names the highest-likelihood failure of this change: a promise fix
 * that removes the diagnostic AND the test's teeth at the same time. That is
 * invisible in a green run — the suite passes either way. So each touched test
 * file is checked the only way that can falsify it: break a behaviour the file
 * covers and require the file to go RED.
 *
 * A file that stays green under mutation fails this harness, which is exactly
 * the assertion X15 asks for.
 *
 * Slow by construction — each mutation is a full vitest invocation — so this
 * file carries generous per-test timeouts.
 *
 * See change: cleanup-async-semantics-server-extension (test-plan #X15).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runTestFile, verifyTeeth } from "../mutation-harness.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PER_TARGET_TIMEOUT = 240_000;

/**
 * The four test files this change edited, each paired with mutations to the
 * production behaviour it covers.
 *
 * Anchors are exact single-occurrence substrings; the harness refuses to guess
 * if an anchor becomes ambiguous, which turns anchor rot into a loud failure
 * rather than a silently-skipped check.
 */
const TARGETS = [
  {
    test: "packages/extension/src/__tests__/prompt-bus.test.ts",
    mutations: [
      {
        name: "prompt ids are no longer unique per request",
        source: "packages/extension/src/prompt-bus.ts",
        find: "const id = crypto.randomUUID();",
        replace: 'const id = "mutation-fixed-id";',
      },
    ],
  },
  {
    test: "packages/extension/src/__tests__/prompt-bus-wiring.test.ts",
    mutations: [
      {
        name: "a claimed placement is ignored, everything renders inline",
        source: "packages/extension/src/prompt-bus.ts",
        find: 'resolvedPlacement = componentClaim.claim.placement ?? "inline";',
        replace: 'resolvedPlacement = "inline";',
      },
    ],
  },
  {
    test: "packages/extension/src/__tests__/tui-prompt-adapter.test.ts",
    mutations: [
      {
        name: "confirm loses its message context",
        source: "packages/extension/src/tui-prompt-adapter.ts",
        find: "answer = await ui.confirm(prompt.question, promptMessage(prompt), {",
        replace: 'answer = await ui.confirm(prompt.question, "", {',
      },
    ],
  },
  {
    test: "packages/server/src/embed-lifecycle/__tests__/visitor-session-registry.test.ts",
    mutations: [
      {
        name: "a spawn that never registers no longer rejects",
        source: "packages/server/src/embed-lifecycle/visitor-session-registry.ts",
        find: "reject(new Error(`acquire register timeout for ${key}`));",
        replace: "/* mutated: timeout no longer rejects */",
      },
    ],
  },
];

describe("X15: every touched test file still has teeth", () => {
  it("the four touched test files pass on the unmutated tree", () => {
    // Baseline. Without it, a file that is red for an unrelated reason would
    // "survive" nothing and look like a pass below.
    for (const target of TARGETS) {
      expect(runTestFile(repoRoot, target.test), `${target.test} is red before mutation`).toBe(true);
    }
  }, PER_TARGET_TIMEOUT);

  for (const target of TARGETS) {
    it(`${target.test} goes red under mutation`, () => {
      const results = verifyTeeth(repoRoot, target);
      const survivors = results.filter((r) => r.survived).map((r) => r.mutation);
      expect(survivors, `mutations survived (test proves less than it claims)`).toEqual([]);
    }, PER_TARGET_TIMEOUT);
  }
});

describe("X15: the harness itself fails closed", () => {
  it("refuses an ambiguous anchor rather than guessing", () => {
    expect(() =>
      verifyTeeth(repoRoot, {
        test: "packages/extension/src/__tests__/prompt-bus.test.ts",
        // `const` occurs hundreds of times — the harness must refuse.
        mutations: [
          {
            name: "ambiguous anchor",
            source: "packages/extension/src/prompt-bus.ts",
            find: "const",
            replace: "const",
          },
        ],
      }),
    ).toThrow(/occurs \d+ times/);
  });

  it("reports a survivor when the mutation does not affect the test", () => {
    // A mutation to a file the target test does not cover MUST be reported as
    // survived — proving the harness can distinguish red from green at all.
    const results = verifyTeeth(repoRoot, {
      test: "packages/extension/src/__tests__/tui-prompt-adapter.test.ts",
      mutations: [
        {
          name: "no-op comment change",
          source: "packages/extension/src/prompt-bus.ts",
          find: "const id = crypto.randomUUID();",
          replace: "const id = crypto.randomUUID(); // mutated no-op",
        },
      ],
    });
    expect(results[0].survived).toBe(true);
  }, PER_TARGET_TIMEOUT);
});
