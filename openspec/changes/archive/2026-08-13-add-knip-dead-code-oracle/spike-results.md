# Spike results — Semgrep vs Knip on this codebase

Measurement that the original `add-semgrep-knip-oracles` proposal demanded
before adoption ("this change is unmeasured"). Run before any planning artifact
was written. Outcome: **Semgrep dropped, Knip kept.**

## Method

- Semgrep 1.172.0, installed in an isolated venv (Python 3.12.6 host).
- `semgrep scan --config p/typescript --config p/nodejs --config p/react
  --config p/command-injection --config p/secrets --metrics=off`
  over `packages/ scripts/ docker/`, excluding `node_modules dist build *.min.js`.
- Knip via `pnpm dlx knip --reporter json`, no config (default workspace inference).

## Semgrep — 136 rules, 3773 files, 8 findings, 0 true positives

| n | rule | location | triage |
|---|---|---|---|
| 4 | `detected-google-oauth-access-token` | `packages/server/src/__tests__/spawned-turn-log.test.ts` | FALSE POSITIVE — fake fixture `ya29.aBcDeF…TOKEN` inside the test *for* `redactSecrets()`. Flagging a redaction test's input. |
| 4 | `direct-response-write` | `packages/server/src/routes/attachment-routes.ts:84`, `file-routes.ts:813,817,1117` | FALSE POSITIVE — Express-authored rule (advises `resp.render()`); code is Fastify `reply.send()` of a Buffer/ReadStream with explicit `Content-Length` and `X-Content-Type-Options: nosniff`. Not an HTML sink. |

True-positive rate: **0/8**.

### The decisive miss

This repo has a verified, documented, still-unfixed command-injection RCE:

- `run(\`git checkout ${branch}\`, cwd)` — `packages/server/src/git/git-operations.ts:391`
- `run()` is `execSync(command)` → `/bin/sh -c`
- request-supplied `branch`, validated only by `if (!cwd || !branch)`
- repro: `{"branch": "x; id > /tmp/pwned #"}`
- tracked by the open change `fix-git-checkout-command-injection`, found by a
  HUMAN audit (security-boundary-audit VD1)

`p/command-injection` returned **0 findings in git-related files**. The exact
vulnerability class the proposal justified Semgrep with, in the exact file, was
not detected.

### Secondary findings against the proposal's non-goals

- Every finding's matched snippet returned `"requires login"` — Semgrep redacts
  match content without an account. Contradicts "no account required for the
  gate to function".
- 26 scan errors (parse warnings) at ~99.9% parsed lines.
- Proposal states "nine packages"; the workspace has **36**.

### Verdict

The proposal's own exit criterion: *"if the finding count is near zero, the
honest outcome is to drop Semgrep rather than adopt it for the narrative."*
Near zero, and blind to the one known RCE. **Dropped.**

## Knip — re-measured WITH configuration (round 2)

**The first Knip run was invalid.** It executed with no `knip.json`, so the
module graph was never rooted: packages whose entry point is declared in the
project's own `pi-dashboard-plugin` / `pi.extensions` manifest fields (a
convention Knip cannot infer), plus the Vite app and the Electron main/preload
entries, had no reachable root — and every file beneath them was reported unused.
Direct relative imports such as
`import { registerCanvasTool } from "./canvas-tool.js"` were being reported as
dead code. Every number from that run, and both TP rates derived from it, are
withdrawn.

The measured configuration is preserved at `spike/knip.json` and the raw output
at `spike/knip-baseline.json`.

### Baseline convergence as the graph was rooted

| run | config | total | files |
|---|---|---|---|
| v1 | none (unrooted) | 723 | 90 |
| v2 | entry from `exports`/`bin`/`pi.extensions` | 446 | 18 |
| v3 | + canonical `pi-dashboard-plugin` `client`/`server`/`bridge` | 442 | 15 |
| v4 | + shell-invoked scripts as entries | **437** | **10** |

Runtime **measured**: 9.78s real, whole workspace (`/usr/bin/time -p`, warm).

### Final baseline (v4)

| class | n |
|---|---|
| `exports` | 227 |
| `types` | 189 |
| `duplicates` | 11 |
| `files` | 10 |
| **total** | **437** |

### Triage (same standard used to reject Semgrep)

| class | n | method | TP rate |
|---|---|---|---|
| `files` | 10 | **exhaustive**, exact import-specifier resolution | **10/10** |
| `exports` + `types` | 416 | deterministic random sample, n=20 | **17/20**; the 3 apparent consumers are name *collisions* (independent re-declarations in other files), so effectively 20/20 |
| `duplicates` | 11 | not examined | unknown |

Corroboration: `packages/flows-plugin/src/client/FlowsCommandRoutes.tsx` is
already listed in `scripts/i18n-lint.mjs`'s `DEAD_CODE` array — the repo had
independently identified it as dead.

### False positives found and fixed by configuration

All were **shell-invoked entry points**, which Knip structurally cannot discover:

- `scripts/ab-context/{extract,analyze,judge,paired}.mjs` — invoked as
  `node extract.mjs` by `scripts/ab-context/finish.sh` and documented as CLI in
  its README
- `scripts/lib/smoke-spawn-session.mjs` — `docker cp`'d and run as
  `node /smoke-spawn-session.mjs` by `scripts/test-standalone-npm-install-docker.sh`

Consequence: `scripts/**` must be declared entry, which means Knip cannot report
a genuinely dead *script*. Dead-code detection is therefore effective for
`packages/**` source, not for the shell-invoked tooling tree.

### CORRECTION — the `unlisted` class is already owned by Biome (0 new signal)

This spike triaged the `unlisted` class **twice, wrongly, in opposite
directions**, before the correct answer was found during `ship-it` step 2:

1. First pass: dismissed as "pnpm hoisting phantom resolution" — wrong.
2. Second pass: called 63/63 true positives — also wrong. It checked only
   "is the dep declared in the owning manifest?" and never asked whether the
   project had already adjudicated the class.

**The project already owns this class.** `openspec/specs/code-quality-loop/spec.md`
ratifies *"Undeclared-dependency findings reach zero at repo-root scope"*:

- `biome.json` → `linter.rules.correctness.noUndeclaredDependencies = "error"`
- `npx biome lint . --max-diagnostics=20000` → **0** findings in that category
- Biome overrides deliberately exempt exactly the trees Knip flags:
  `**/__tests__/**` + `**/*.test.ts(x)` (the `@testing-library/react` hits),
  `**/vitest.config.ts` (`@vitejs/plugin-react`), and
  `tests/e2e/**` + `qa/scripts/**` + `.pi/skills/**/scripts/**` (`@mdi/js`, others)
- ratified policy: declare where the importing file **is published**; resolve by
  ignore/override where it is **never published**

So all 63 are findings the project has already seen and deliberately exempted.

The `node-pty` case previously flagged here as a shipped defect is likewise a
**false positive**: `scripts/fix-pty-permissions.cjs` resolves it via
`require.resolve("node-pty")` and its header documents the file as deliberately
hoist-aware; `packages/server` declares the dependency properly.

**Consequence:** Knip's `unlisted` class is disabled in `knip.json` and deferred
entirely to Biome. Knip is justified on the orphan/unused-export thesis only.

### Raw issue counts

| count | issue type |
|---|---|
| 274 | exports |
| 205 | types |
| 90 | files |
| 63 | unlisted |
| 41 | devDependencies |
| 23 | dependencies |
| 11 | binaries |
| 11 | duplicates |
| 4 | optionalPeerDependencies |
| 1 | unresolved |

### Real signal (v4, verified)

All 10 unused files, exact-verified:
`packages/client/src/hooks/useAuthStatus.ts`,
`components/diff/DiffView.tsx`, `components/diff/DraggableChangeRow.tsx`,
`components/terminal/TerminalCard.tsx`, `lib/chat/message-queue.ts`,
`lib/chat/prompt-component-registry.ts`,
`packages/flows-plugin/src/client/FlowsCommandRoutes.tsx`,
`packages/server/src/lifecycle/home-lock.ts`,
`packages/electron/src/lib/ensure-windows-path.ts`,
`packages/electron/src/lib/lock-metadata.ts`

Sampled unused exports/types incl. `resolveOpenspecBin`
(`extension/src/openspec-cli-shim.ts`), `isBinaryFile` + `parseBashArtifacts`
(`server/src/session/session-diff.ts`), `discoverProviderModels`,
`detectNgrokBinary`, `parseAuthoredBatch` (`kb/src/migrate-runner.ts`).

### The config is load-bearing, and it encodes project conventions

`spike/knip.json` derives every workspace's entry from repo reality rather than
guesswork:

- `pi-dashboard-plugin.{client,server,bridge}` — the canonical dashboard-plugin
  manifest; without it, whole `src/bridge/**` and `src/server/**` trees are
  unrooted (this alone accounted for the v2→v3 drop)
- `pi.extensions` — pi extension entries (e.g. `packages/extension` →
  `src/bridge.ts`)
- `bin` + real source paths in `exports`
- non-inferable app entries: `client/src/main.tsx`,
  `electron/src/{main,preload}.ts` + `src/preload/*.ts`, `server/src/cli.ts`
- `scripts/**`, `tests/e2e/**`, `qa/**`, `.pi/skills/**/scripts/*.ts`,
  `public/sw.js`, `**/vitest.config.ts`

This config must be regenerated whenever a package adds one of those manifest
fields — a maintenance cost the change must own.

### What Biome cannot do (the actual gap Knip fills)

Verified in `biome.json`: `noUnusedImports` and `noUnusedVariables` are `warn`
and **file-local only**. Biome has no whole-graph unused-export or unused-file
rule. The 437 findings are therefore genuinely undetected by anything currently
in the ladder.

## Conclusion

Knip has **measured** signal on the dead-code classes: 10/10 on files, 17/20
(effectively 20/20) on exports/types, 9.78s whole-workspace, with a config that
encodes real project conventions. Adopt whole-graph, off the per-change loop;
disable the dependency classes (Biome owns them); accept that shell-invoked
scripts are undetectable.

The headline lesson: **an unconfigured Knip run is not evidence.** Rooting the
graph moved the baseline 723 → 437 and the files class 90 → 10, and turned a
25%-precision class into a 100%-precision one.
