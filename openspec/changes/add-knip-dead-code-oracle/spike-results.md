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

## Knip — 723 issues across 431 files, triaged

Runtime **measured**: 5.59s real (`/usr/bin/time -p`, warm, whole workspace).

### Triage (applied with the same standard used to reject Semgrep)

| class | n | triage | TP rate |
|---|---|---|---|
| `unlisted` | 63 | **exhaustive** — every finding checked against its owning `package.json` AND the root manifest | **63/63 true positive** |
| `exports` + `types` | 479 | deterministic random sample, n=20 | **15/20 clear TP**; of the 5 apparent consumers, 3 are name *collisions* (independent re-declarations, not imports) → effective ~18/20 |

Overall measured TP rate is high enough to adopt — in contrast to Semgrep's 0/8.

### The `unlisted` class is TRUE POSITIVE, not noise (corrected)

An earlier pass in this spike wrongly dismissed these as "pnpm hoisting phantom
 resolution". That is backwards. `nodeLinker: hoisted` (mandatory here —
`electron-forge` hard-fails otherwise) lets a package import a dependency it
never declared and still resolve at runtime. That is the phantom-dependency
hazard itself, and it breaks on publish, on standalone consumption, or on any
linker change. This is a **publishing monorepo**, so that is not hypothetical.

Verified case: `@testing-library/react` is imported by
`packages/automation-plugin/src/__tests__/*.tsx`, and is declared in **neither**
`packages/automation-plugin/package.json` **nor** the root `package.json`.

7 distinct phantom packages across 63 import sites:
`node-pty`, `@mdi/js`, `@vitejs/plugin-react`, `@testing-library/react`,
`jszip`, `@pi/anthropic-messages`, `@electron-forge/shared-types`.

These must be **fixed in the manifests**, never configured away.

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

### Real signal (sample)

- Orphaned scripts: `scripts/heap-probe.mjs`, `scripts/i18n-migrate-auto-keys.mjs`,
  `scripts/measure-replay-compaction.mjs`, `scripts/_windows-introspection-probe.ts`
- Unused exports in live modules: `packages/kb/src/dox.ts` (`AREA_FILE_THRESHOLD`,
  `ROW_CAP`, `sourceFiles`), `packages/client/src/components/chat/CommandInput.tsx`
  (`MIN_FILE_QUERY_LEN`)
- `site/src/lib/__tests__/classify.test.ts` — unresolved import `~/lib/github-release`

### Genuine config work (unresolved-graph shapes, NOT dismissals)

These are places Knip cannot see an entry point, and where config should teach it
the graph — distinct from the `unlisted` class above, which must be fixed in code:

- `react-dom` + `@types/react-dom` reported unused devDeps across every
  `*-plugin` package (plugin client entry points not traced)
- Binaries `vite`, `electron`, `mktemp`, `xattr`, `hdiutil` reported missing
- `.pi/skills/**/scripts/*.ts` exports flagged (skill scripts are not graph roots)
- Config/entry files flagged as unused: `public/sw.js`, `site/astro.config.mjs`,
  `packages/*/vitest.config.ts`
- One likely genuine FP: `ConfigOk` (`blackhole-plugin/src/server/config-io.ts`)
  IS imported by `src/client/BlackholeSettings.tsx` — a server/client boundary
  Knip did not follow.

Conclusion: Knip has measured signal. Adopt advisory-first, whole-graph, off the
per-change loop; fix the 63 phantom deps in manifests; teach the config the
entry-point shapes above.
