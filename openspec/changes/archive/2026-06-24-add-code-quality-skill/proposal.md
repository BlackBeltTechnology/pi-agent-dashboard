# Add a code-quality skill (Biome analyze → fix → test), goal-loop drivable

## Why

The repo has **no code-quality analyzer**. `npm run lint` is just `tsc --noEmit`
(type checking), and `npm test` is vitest. There is no ESLint, Biome, Prettier,
or dead-code tool, and no `.editorconfig`. 1712 tracked `.ts`/`.tsx` files
(567 in `packages/client`, 425 in `packages/server`) are space-indented by
convention only.

Users want a **complete, reusable procedure** — analyze → fix → test — that an
agent can run, and that the existing `goal-plugin` (the `@ricoyudog/pi-goal-hermes`
"Ralph loop") can drive autonomously: set a standing goal, a judge model reads a
deterministic exit code after each turn and decides "done or continue" until the
code is clean or a turn budget runs out.

The skill owns the **HOW** (the procedure + project commands). The goal loop owns
the **WHEN-TO-STOP** (judge oracle = exit code of one npm script). They compose.

Two facts shape the design:

1. **Biome covers the React blind spot.** Biome keeps `useExhaustiveDependencies`
   (the hooks rule) in its recommended set, so a single tool covers correctness,
   style, and React-hooks linting for both client and server — no ESLint side
   layer needed. Biome's `--changed` (with `vcs.defaultBranch`) provides native
   changed-files scoping, so no custom git-diff glue is required for the common
   case.
2. **Biome severity is the ratchet, and it maps 1:1 to the three scopes.**
   `warn` diagnostics show but exit 0 (soft); `error` diagnostics exit non-zero
   (hard gate). The same `biome.json` serves all scopes by varying only the flag:
   goal loop runs `biome check --changed --error-on-warnings` (warn+error both
   block on touched files); CI runs plain `biome lint .` (only `error`-tier
   fails — the requested "soft warn"); cleanup runs `biome lint <path> --only=…`.

## What Changes

- **New Biome config** (`biome.json`) — `formatter.enabled: false` initially
  (avoid reformatting 1712 files), `indentStyle: "space"` for when it is enabled,
  `vcs` integration (`clientKind: git`, `useIgnoreFile: true`,
  `defaultBranch: "develop"` — the repo's integration branch; no `main` exists),
  ignores for `dist/`, `**/dist/`, `*.tsbuildinfo`,
  generated plugin-registry output, and `openspec/changes/archive/**`. Rules
  organized into a **tier ladder** (see design.md): Tier A high-signal rules,
  Tier B noisy-but-valuable rules, Tier C style/complexity, plus a11y scoped to
  `packages/client/**` and relaxed overrides for `__tests__/**` and `scripts/**`.

- **New npm scripts** (`package.json`):
  - `lint:biome` → `biome lint .` (whole-repo analyze)
  - `fix:changed` → `biome check --changed --write` (safe autofix on diff vs develop)
  - `quality:changed` → `biome check --changed --error-on-warnings --write && tsc --noEmit && npm test` — **the goal-loop oracle** (single exit code)
  - `quality:report` → `biome lint . --reporter=github` (whole-repo, advisory)
  - `lint` stays `tsc --noEmit` (CI already depends on it).

- **New skill** `.pi/skills/code-quality/SKILL.md` — the analyze → fix → test
  procedure for both scopes (changed-files goal-loop mode; whole-repo cleanup
  mode), the guardrails (surgical changes, test gate after every fix batch, safe
  fixes auto-applied while unsafe/manual surface as a report, no scope creep),
  and the two goal-text templates the judge consumes.

- **CI soft-warn step** (`.github/workflows/ci.yml`) — add
  `npx biome lint . --reporter=github` after the existing `npm run lint`. With
  Tier A at `error` (post-cleanup) it hard-gates regressions; Tier B/C at `warn`
  annotate without failing the build.

- **Docs** — `docs/code-quality.md` (tier ladder, graduation criterion, rollout
  phases, the whole-file-on-touch rough edge) plus file-index rows for the new
  files, per the Documentation Update Protocol.

### Rollout (phased, ratchet)

- **Phase 0 — bootstrap (1 PR, fully soft):** config in, all tiers `warn`, CI
  annotates only. Goal loop usable on changed files immediately.
- **Phase 1 — graduate Tier A (1 cleanup PR):** `biome check --write` repo-wide
  clears Tier A safe-fixes; flip Tier A → `error`; CI now hard-gates Tier A.
- **Phase 2+ — per-area Tier B campaigns:** lowest-count package first, drive a
  rule to zero, graduate `warn → error`. a11y graduated per-rule on the client.

### Out of scope (v1)

- Enabling the Biome **formatter** repo-wide (deferred to avoid a 1712-file diff).
- A **count-ratchet** baseline script for un-zeroable rules (e.g. `noExplicitAny`)
  — added later only if a warn-tier rule proves un-zeroable.
- A custom git-diff script — native `--changed` covers the branch-vs-develop case;
  the script is a documented fallback only if merge-base or line-level filtering
  is needed.
- Replacing `tsc --noEmit` as the type gate — kept as-is.

## Impact

- Affected specs: new `code-quality-loop` capability.
- Affected code: `biome.json` (new), `package.json` scripts, `.github/workflows/ci.yml`,
  `.pi/skills/code-quality/SKILL.md` (new), `docs/code-quality.md` (new), one
  cleanup PR touching Tier-A violations repo-wide.
- New dev dependency: `@biomejs/biome`.
- Risk: low. Phase 0 is non-blocking; the goal loop is opt-in; CI stays green
  until a tier is deliberately graduated to `error`.
