# Tasks

## 0. Probe the reporter's host before changing code (C, first)

- [x] 0.1 Reply on issue #408 with the mechanism (jiti CJS wrapper →
      `SyntaxError` on raw `import.meta` → native-ESM fallback → `data:` URL →
      Bun resolves it as a package name) and ask the reporter to confirm
      `JITI_ESM_EVAL_TEMP_FILE=1` unblocks their **existing** binary, unchanged.
      **Posted 2026-08-10:** comment `5234626346`. Also credited the reporter's
      correct finding on jiti's `ENAMETOOLONG`-only guard, and withdrew our
      "dist wouldn't fix it" argument in public (their fix would have worked; we
      decline on architecture, not efficacy).
- [ ] 0.2 Green → corroborated; proceed. Red → **reopen investigation, do not
      redirect it**: candidate causes are a read-only `os.tmpdir()` in the
      compiled binary, jiti-version drift, a non-jiti transpiler in their host,
      or a second `data:`-URL producer. Ask for `JITI_DEBUG=1` output to
      discriminate before concluding anything.
- [ ] 0.3 Record the outcome in the issue thread so the evidence chain is public.

## 1. Red tests first

- [ ] 1.1 Add `scripts/__tests__/jiti-cjs-transpile-safety.test.mjs`. Discover
      the file set from a **derived rule** (first-party source loaded through
      jiti at runtime), run jiti's real `transform()` in CJS mode over each, and
      report every module retaining `import.meta` in code position, naming paths.
- [ ] 1.2 Detection is **AST-level** — parse the emitted module, locate
      `MetaProperty` nodes. Do **not** substring/regex the emitted text.
- [ ] 1.3 Exclusions, each with a comment saying why: Vite/client source
      (`import.meta.env` is legitimate there), build output — explicitly
      `packages/electron/out` (gitignored, present after a local Electron build,
      contains `.tsx` retaining `import.meta`; a naive walk goes red only on
      developer machines), and `__tests__` / `*.test.*`.
- [ ] 1.4 Seed the walk from **three** manifest-derived sets, not one. Cycle 4
      established that an earlier draft covered only the first and missed the
      majority of jiti-loaded first-party TypeScript.
- [ ] 1.4a **Seed 1 — `pi.extensions`.** Read from every
      `packages/*/package.json`, not hardcoded. Assert the derived set is a
      **superset** of the four known today: `extension`, `image-fit-extension`,
      `kb-extension`, `mockup-loop`.
- [ ] 1.4b **Seed 2 — the dashboard server itself.** Key on a workspace whose
      `main` resolves to a `.ts` file: `packages/server` declares
      `main: src/cli.ts`, and `bin/pi-dashboard.mjs` re-execs Node with
      `--import <jiti-url> cli.ts`. Assert `packages/server/src/**` is in the
      file set. Keying on `bin` cannot find this — `bin` is the `.mjs` wrapper.
      This is also what makes 1.7 non-vacuous: `changelog-fs.ts` lives here.
- [ ] 1.4b2 **Seed 3 — `pi-dashboard-plugin` `server` / `bridge` entries.** Read
      from the manifests; a walk cannot reach them, because
      `packages/dashboard-plugin-runtime/src/server/loader.ts:442` loads them via
      `await import(plugin.serverEntryPath)` over glob-discovered paths. Assert
      the derived set is a superset of the twelve known today (eight `server`,
      four `bridge`).
- [ ] 1.4b3 The walk follows ESM `import` **and** CJS `require()` specifiers
      (jiti transpiles both), resolves relative paths and workspace names, stops
      at `node_modules`. Assert `packages/dashboard-plugin-runtime/src/server/`
      is reached — from **seed 2** (`packages/server/src/server.ts` imports it),
      not from `bridge.ts`, which has no edge to it. Do not hardcode it.
- [ ] 1.4b4 Assert raw-`.ts` `bin` entries are **excluded** unless reached by a
      seed. They carry `#!/usr/bin/env node` and run under native
      type-stripping as ESM — no CJS wrapper, so the fault class cannot arise.
      A draft of this task included them on the false premise that
      "executed from source" implies "transpiled by jiti".
- [ ] 1.4c Confirm `packages/client-utils` stays out: re-run the check that no
      `packages/*/src/server/` or `packages/server/src/` file imports it. If one
      ever does, the rule pulls it in automatically — assert the rule, not the
      current answer.
- [ ] 1.5 Assert the discovered set is **non-empty** and fail with a
      discovery-specific message when it is not. Do **not** add a hardcoded
      count floor.
- [ ] 1.6 Fixtures under `scripts/__tests__/fixtures/`: (a) cast-wrapped
      `import.meta` → MUST be reported; (b) comment-only mention → MUST NOT;
      (c) string-literal mention → MUST NOT. (a) is the fails-closed proof.
- [ ] 1.7 Assert the two real **erasable-shape** files stay green:
      `packages/extension/src/model-tracker.ts` (`:143`, a direct uncast
      `import.meta.resolve(spec)`) and
      `packages/server/src/changelog/changelog-fs.ts` (`:103` —
      `createRequire(import.meta.url)`, `:120` — bare `import.meta.url`).
      **Correction:** an earlier draft called these "comment-only". They are
      not — all three occurrences are in **code** position and are green because
      jiti erases those shapes. They prove the *erasure* limb; the 1.6(b)
      fixture proves the comment limb. Keep both.
- [ ] 1.8 Run: 1.1 **must fail**, naming
      `packages/shared/src/tool-registry/strategies.ts`. A green first run means
      the checker is broken, not the repo clean.
- [ ] 1.9 Add a focused test asserting `strategies.ts` transpiles to
      `jitiESMResolve(` with no code-position `import.meta`.

## 2. Behaviour-preservation tests (the contract the reorder must satisfy)

> These exist because the **existing suite cannot see this change**: under vitest
> `import.meta.resolve` is present but throws, so the ESM step is dead before and
> after. "Existing tests still green" is a vacuous signal here — do not treat it
> as evidence of behaviour preservation.
>
> **The ESM step is an inert guard.** Doubt cycle 2 established it is unreachable
> in position 3: `bareImportStrategy` anchors the dir-walk and the ESM step at
> the same URL (`strategies.ts:468`; the sole production caller of
> `defaultResolveModule` is `definitions.ts:290` — `:333`/`:697` call their own
> `createRequire` wrapper and never reach it), and
> `readEntryFromPackageJson` returns a string for every manifest it
> can parse (`strategies.ts:150`, where the following `typeof` guard can never
> fire). So the dir-walk answers whenever the package is present, and when it is
> absent the ESM step fails too. Do **not** write a test that requires the ESM
> step to produce a value — no such case exists, and any test that appears to
> pass is testing a synthetic anchor, not production behaviour.

- [ ] 2.1 Build fixture `node_modules` trees for the three shapes where the
      resolvers disagree: (i) no `exports`, `module` + `main`; (ii)
      `exports["."]` nesting `node` / `default`; (iii) `exports` with subpaths
      but no `"."`.
- [ ] 2.2 Assert for each: when the dir-walk returns a path, that path is what
      `defaultResolveModule` returns — i.e. the ESM step never overrides it.
- [ ] 2.3 Assert shape (iii) — where the dir-walk succeeds via `main` and ESM
      would throw — is unaffected.
- [ ] 2.3a Assert the guard is inert: with all three fixture shapes installed,
      `defaultResolveModule` SHALL never reach the ESM step. Instrument the ESM
      call (spy/counter) and assert the call count is **zero**. This is the
      test that would have caught the false "recovery" claim.
- [ ] 2.3b Pin the two preconditions that make 2.3a true, so a future change
      cannot void them silently: (i) a fixture registering a **subpath** id
      (`pkg/sub`) SHALL show the dir-walk returning `null` and the ESM step
      firing — documenting the one shape where the guard is reachable; (ii) a
      fixture passing a **non-default `anchor`** to `bareImportStrategy` SHALL
      show the two steps searching different trees. Both are contract
      documentation, not regressions — assert current behaviour and reference
      the inert-guard requirement.
- [ ] 2.4 Pin the live-registry invariant: `@earendil-works/pi-coding-agent` and
      `@earendil-works/pi-ai` resolve to `./dist/index.js` — the same path as
      before the change. This is the regression that would actually hurt users.
      Capture the expected paths from the **pre-change** chain (e.g. `git
      stash`, record, restore) so the assertion cannot be satisfied by the new
      implementation agreeing with itself.
- [ ] 2.5 Exercise these through a **jiti-loaded** `strategies.ts`, not a
      vitest-native import. Under a vitest-native import the ESM step is dead
      for a *different* reason (the function throws), so the fixtures would
      appear to pass without exercising the shipped path at all.

## 3. Implement (A)

- [ ] 3.1 Reorder `defaultResolveModule` to `createRequire → dir-walk → ESM
      resolve`.
- [ ] 3.2 Replace the ESM step with a direct `import.meta.resolve(id)` call
      inside a `try`; delete the `metaResolve` binding and the `typeof` guard.
      Keep the `file:` scheme check and `fileURLToPath` conversion.
- [ ] 3.3 Rewrite the ordering doc-comment. It MUST say: (a) the ESM step is an
      **inert guard**, retained for shape-correctness, not an expected code
      path; (b) *why* it cannot fire — it shares an anchor with the dir-walk,
      and the dir-walk returns non-`null` for any manifest it can parse
      (`strategies.ts:150`); (c) that behaviour preservation holds **because
      step 2 was already dead**, not because the dir-walk is authoritative — a
      future reader who "repairs" the order by promoting the ESM step breaks the
      invariant. Add `See change: fix-jiti-cjs-transpile-safety`.
- [ ] 3.3a Record the pre-existing defect without fixing it: the entry falls back
      to `"index.js"` with **no existence check**, so the dir-walk can return a
      path that is not on disk — including for the `exports`-without-`"."` case
      the old comment cited as step 3's reason to exist. Out of scope here;
      note it so the inert guard is not mistaken for its mitigation.
- [ ] 3.4 In the same comment, correct two standing falsehoods: the synchronous
      `import.meta.resolve` **does** accept a parent specifier (Node 20.6+) —
      not passing `from` is a deliberate choice, not an API limit; and the cited
      `>=22.12` engines floor does not exist (root is `>=22.19.0 <27`;
      `packages/shared` / `packages/extension` declare none).
- [ ] 3.5 Re-run 1.1, 1.9, and all of §2 — green.
- [ ] 3.6 Run the existing `tool-registry` suite unchanged. Green is necessary
      but **not sufficient** (see §2 note); it only rules out a gross break.
- [ ] 3.7 `npm run lint` (`tsc --noEmit`) — the direct call must type-check with
      no cast and no ambient declaration.

## 4. Verify the whole graph

- [ ] 4.1 Transpile the full bridge-reachable import graph through jiti; assert
      **zero** modules take the ESM fallback path.
- [ ] 4.2 Smoke: start a pi session with the bridge from source, confirm it
      registers on the dashboard and that `command-handler` / `process-scanner`
      tool resolution still works.
- [ ] 4.3 Confirm gate runtime is acceptable in the default `npm test` run;
      note that jiti's fs-cache writes under `node_modules/.cache/jiti` during
      the run (content-keyed, harmless) and that this does not leak between runs.

## 5. Docs — delegated per the Documentation Update Protocol

- [ ] 5.1 Spawn `DocScribe` for the `docs/faq.md` entry: keyed on **both**
      symptoms (async `NameTooLong` / `data:text/javascript`, and the sync bare
      `SyntaxError`), remedy `JITI_ESM_EVAL_TEMP_FILE=1`, note that `-ne`
      disables the bridge and is not acceptable, note the writable-`tmpdir`
      precondition. Pass the caveman-style rule verbatim.
- [ ] 5.2 Apply DocScribe's returned tree rows; never edit `docs/` directly.
- [ ] 5.3 `packages/shared/src/tool-registry/AGENTS.md` — `strategies.ts` row
      gains `See change: fix-jiti-cjs-transpile-safety`.
- [ ] 5.4 Add a `scripts/__tests__/AGENTS.md` row for the new gate.
- [ ] 5.5 `kb dox lint` clean.

## 6. Review + land

- [ ] 6.1 `doubt-driven-review` **cycle 2** on the rewritten artifacts. Cycle 1
      produced the step-2-is-dead finding plus 8 corrections; the reorder is a
      new decision that has not itself been adversarially reviewed. Targets:
      is monotonicity actually guaranteed by `1 → 3 → 2`, or only usually? Does
      the derived scope rule have an exploitable gap?
- [ ] 6.2 `review-code` on the diff once vitest is green.
- [ ] 6.3 `npm run quality:changed`.
- [ ] 6.4 Full `npm test` green (pipe once to `/tmp/`, then grep — do not rerun
      to inspect errors).
- [ ] 6.5 Ship; close #408 referencing the landed fix. Offer the reporter the
      choice: upgrade, or keep `JITI_ESM_EVAL_TEMP_FILE=1` (both work).
- [ ] 6.6 File the deferred upstream jiti issue/PR — teach the `ENAMETOOLONG`
      data-URL fallback to also recognise Bun's `ResolveMessage` / `NameTooLong`
      — and link it from #408. Not a blocker.
