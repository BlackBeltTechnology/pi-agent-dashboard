## Context

`worktreeInit` (`.pi/settings.json`) is a project-declared, gated init hook. The engine (`packages/server/src/worktree-init.ts`, from `2026-06-03-generalize-worktree-init-hook`) reads the hook, evaluates the bash `gate` (exit 0 ⇒ `needsInit`), and — once TOFU-trusted — runs the `run` command. Auto-run on spawn is gated by the `autoInitWorktreeOnSpawn` preference (`2026-06-15-auto-init-worktree-on-spawn`).

Observed symptom: a new worktree is missing the `opsx` (`openspec-*`) skills and `node_modules`. Both are gitignored/generated; only `worktreeInit` restores them.

```
git-tracked  →  git worktree add restores  →  present in fresh worktree
generated    →  only worktreeInit restores →  ABSENT until the hook runs

  node_modules/                 gitignored   → npm ci
  .pi/skills/openspec-*         generated    → npx openspec init --tools pi
  .pi/dashboard/kb/index.db     gitignored   → kb index  (MISSING FROM run today)
```

## Root causes (two, independent)

1. **`run` omits `kb index`.** The command restores deps + opsx skills but never builds the kb DB. `kb_search` auto-reindexes lazily, so the DB does appear eventually — but the first search pays a full cold index. Pre-warming in init moves that cost to setup time.

2. **Gate under-detection (the real defect).** `gate = test ! -d node_modules` uses `node_modules` as the sole sentinel. If a worktree has `node_modules` but is missing opsx skills or the kb index, the gate exits non-zero → `needsInit: false` → the entire hook is skipped, so those assets are never restored. The gate must detect absence of *everything* the run produces.

## Decisions

### D1 — Broaden the gate to cover all restored assets
`test ! -d node_modules || test ! -d .pi/skills/openspec-explore || test ! -f .pi/dashboard/kb/index.db`. Any one missing ⇒ needs init. `openspec-explore` is a stable sentinel for the generated opsx skill set; `index.db` is the kb sentinel.

- **Alternative rejected**: keep the single `node_modules` sentinel and rely on the run always doing everything. Rejected — it only works when `node_modules` itself is missing; a half-initialized worktree stays broken forever.

### D2 — Append `kb index` to the run, not a separate hook
The engine supports exactly one hook per project. Chaining in `run.command` keeps one atomic init. Final command:
`npm ci && npx openspec init --tools pi --force && npm run build --workspace=@blackbelt-technology/pi-dashboard-kb && NODE_OPTIONS=--experimental-sqlite npx kb index`. Order matters: `npm ci` first (links kb bin), then openspec init, then build kb `dist/`, then kb index.

- **kb build is mandatory, not conditional.** `node_modules/.bin/kb` links to `packages/kb/dist/cli.js`, but `packages/kb/dist/` is gitignored and `packages/kb/package.json` has no `prepare` script — so `npm ci` never builds it. On a fresh worktree `dist/cli.js` is ALWAYS absent, so the build step precedes `kb index` unconditionally. Verified empirically (task 1.3). The CLI needs `NODE_OPTIONS=--experimental-sqlite` (node:sqlite, Node ≥ 22.5).
- **kb sources**: config at `.pi/dashboard/knowledge_base.json` is git-tracked (restored by `git worktree add`), so `kb index` finds `sources[]` with no seeding. `dbPath` there = `.pi/dashboard/kb/index.db`, matching the gate sentinel.

### D3 — Do NOT fix "auto-init doesn't fire" here
`autoInitWorktreeOnSpawn` defaults off and the hook needs a one-time TOFU trust grant (via `WorktreeInitButton`). That is the specified behavior (`worktree-auto-init` spec: "Preference defaults off", "Auto-trigger cannot bypass trust"). Changing defaults or the trust model is a separate policy decision, deliberately out of scope. This change only makes the hook *do the right thing when it runs*.

### D4 — Capture the coherence property in the spec
The gate/run mismatch is a general engine-adjacent pitfall, not a one-off config typo. Encoding "gate SHALL cover every asset the run restores" in `worktree-init-hook` guards future hook authors (and other projects using the engine) from the same silent-skip trap.

## Risks

- **Init duration** grows by one kb full-index on fresh setup. Acceptable — it replaces the first-search cold index, net-neutral to slightly better for the user.
- **TOFU re-prompt**: editing `worktreeInit` rehashes it; the next run returns `init_untrusted` until re-confirmed. Expected and desirable (trust boundary intact).
- **kb build dependency**: if `dist/cli.js` is absent post-`npm ci`, the step fails; task 1.3 gates on verifying the bin resolves.
