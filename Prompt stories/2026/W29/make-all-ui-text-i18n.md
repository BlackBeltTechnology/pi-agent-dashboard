---
session: 019f6111
week: 2026/W29
type: development
model: "@fast"
premium: true
premium_reason: "created 0 skill(s) / 1 memory(ies); large facts sheet (~11572 tok)"
upgrade_status: pending
openspec_changes: [make-all-ui-text-i18n]
proposal_excerpt: "The dashboard has a working client-side i18n system (`packages/client/src/lib/i18n.tsx`: `t()` + `useI18n()`, `en` source + `zh-CN` catalog), but coverage is partial. An audit (parallel sweep across client components,…"
---

# How we did it: Full-app i18n coverage (`make-all-ui-text-i18n`) — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was a single skill invocation:

```
/skill:openspec-apply-change make-all-ui-text-i18n
```

The real objective, once the change's proposal + tasks were read: take a dashboard
with a *partial* client-side i18n system (`packages/client/src/lib/i18n.tsx` — `t()` +
`useI18n()`, an `en` source and a `zh-CN` catalog) and make **every user-facing string
translatable** — across ~141 client files, 8 plugin packages, and server/extension
emit sites — while adding **Hungarian (`hu`)** as a first-class language and completing
the `zh-CN` catalog. That's ~711 hardcoded strings and ~1000 keys × 3 locales
(~2000 new translation values). 29 tasks. One of the largest single changes in the repo.

## 2. TL;DR playbook

1. **Read the whole change first.** `openspec status --change <name> --json` + read
   `proposal.md`, `design.md`, `tasks.md`. For a 29-task change, do NOT start coding —
   propose a phase plan (Foundation → Zone 1 client → Zone 2 plugins → Zone 3
   server → Translations → Validate) and align on it.
2. **Build the foundation by hand, before parallelizing.** Add the new language, a
   structured-key taxonomy with `LEGACY_ALIASES`, a parity script
   (`scripts/i18n-parity.mjs`), a lint script (`scripts/i18n-lint.mjs`), and unit tests.
   This is the contract everything else depends on — get it green + committed first.
3. **Codemod the mechanical migration, don't hand-edit.** 751 `auto.*` keys at 751
   call sites → write a deterministic codemod (`scripts/i18n-migrate-auto-keys.mjs`)
   that harvests English source, assigns structured domains by keyword, rewrites call
   sites + dict, and emits `LEGACY_ALIASES`. Run `--write`, verify no `auto.*` remains.
4. **Fan translations out to parallel `translator` subagents.** Split the ~997-key
   source map into ~8 batches, dispatch one subagent per batch, then **merge centrally**
   and verify coverage against the source key count before writing catalogs.
5. **Design the plugin i18n contract additively** (Zone 2). Runtime can't import the
   client's i18n (dependency direction) — so add `t`/`language` to `PluginContextValue`
   (wired by the shell), a scoped `useT()`/`useLanguage()` in the runtime, a
   `manifest.i18nCatalog` field, and generator wiring that imports each plugin's catalog
   (**aliased per-plugin** to avoid `catalog` name collisions).
6. **Parallelize plugin wiring one subagent per package.** Each plugin is an
   independent package → safe to fan out. Have each subagent **wrap call sites + emit
   keys JSON only**; the main agent merges catalogs and regenerates the registry **once**
   at the end (never let subagents race on shared files).
7. **Zone 3 = code-mapping, not string-wrapping.** Server errors carry `{code, vars}`;
   the client resolves via `resolveServerMessage` → `err.*` keys. Skip emit sites whose
   routes drop the `code` field (dead tagging) and API-format responses to external
   clients (not UI).
8. **Verify with the full monorepo suite + parity + lint + biome** after each
   milestone, then commit. Finish by shipping through `ship-change`.

## 3. How the collaboration unfolded

Six phases across ~2h34m, opus-4 at high/medium thinking, 244 assistant turns, 23
subagents.

### Phase A — Read & phase-plan (Discovery)
- **What the AI did:** read the SKILL, `tasks.md`, `openspec status`, mapped the
  `auto.*` call-site shape (`i18nT("auto.key", undefined, "English")`), counted 751 keys.
- **Why it worked:** it refused to grind blindly. It surfaced a 5-phase plan (A–E) and,
  per the repo's "check in before any major change" rule, stated the plan before writing.
- **Decision point:** the plan itself — Foundation first, mechanical bulk via subagents.

### Phase B — Foundation by hand (Build the contract)
- Added `hu`, `LEGACY_ALIASES`, plugin-catalog merge, exported `normalizeLanguage`;
  wrote the codemod, parity script, lint script, 10 unit tests; committed.
- **Why it worked:** everything downstream (translations, plugin wiring, validation)
  keys off this. Green + committed foundation = a safe base to parallelize from.

### Phase C — Codemod + translation fan-out (Generate)
- Ran the codemod (751 keys → structured domains, 141 files rewritten, 0 `auto.*` left).
- Built a 997-key English source map, split into 8 batches, dispatched **8 parallel
  `translator` subagents**, merged, verified all 997 had Hungarian, filled missing `zh`.
- **Why it worked:** translation is embarrassingly parallel and the central merge +
  coverage check caught gaps deterministically.

### Phase D — Plugin i18n contract (Design + Generate)
- Added `PluginI18nCatalog` type + `manifest.i18nCatalog`, runtime `useT`/`useLanguage`,
  generator per-plugin aliased import, `App.tsx` registration. Wired **roles-plugin
  end-to-end as the reference**, then fanned **one `react-expert` per plugin** (6 more).
- **Decision point:** the reference-plugin-first pattern surfaced a real bug —
  `validateManifest` was silently stripping `i18nCatalog`, so the generator never
  emitted it. Fixed the passthrough + added a lock-in test.

### Phase E — Zone 3 code-mapping + lint cleanup (Verify)
- `{code, vars}` protocol, client `resolveServerMessage`, `err.*` keys for spawn/resume/
  git (7)/doctor (33). Wrapped remaining leaks via disjoint-file-set subagents (merge
  centrally). Refined lint to exclude dead code + demo scaffold + non-UI technical throws.

### Phase F — Ship (steering #2: "ship-change")
- Full suite green (1042 files / 10182 tests), archived + synced specs, PR **#319**,
  CI pass (10m27s), CodeRabbit auto-skipped (286 files > 150-file cap), squash-merged,
  worktree removed.

## 4. Prompts that worked

- **The goal prompt — `/skill:openspec-apply-change make-all-ui-text-i18n`.** Effective
  because the *heavy lifting was front-loaded into the OpenSpec change itself*: a detailed
  `proposal.md` + a 29-task `tasks.md` with zones and string counts. The skill invocation
  is only as good as the change behind it — a vague change would have produced a vague grind.
- **High-leverage follow-up #1 — "In the task list are unchecked items. Implement them."**
  A 9-word prompt that unlocked the entire second pass (7 plugins, Zone-3 server tagging,
  lint-clean). Worked because the task list was the shared source of truth: "finish the
  checklist" is unambiguous when the checklist is good.
- **High-leverage follow-up #2 — "ship-change".** One word triggered the full ship
  pipeline (verify → archive → PR → CI watch → merge → cleanup).

**Rewrite for next time:** the goal prompt is already strong *because the change is
strong*. If you're starting cold, invest first in a well-zoned `tasks.md` with explicit
counts and acceptance gates — then the one-line skill invocation just works.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Stop after the first pass (foundation + Zone 1) and report status | "In the task list are unchecked items. Implement them." | Make `tasks.md` the contract; instruct "finish every `[ ]`/`[~]` item, don't stop at a milestone" up front |
| Naturally want to hand-edit hundreds of call sites | (self-corrected) chose a codemod + subagent fan-out | State "script the mechanical bulk; parallelize independent packages" in the plan |
| Risk subagents clobbering shared catalog/registry files | (self-corrected) subagents emit **keys JSON only**; main agent merges + regenerates once | Standing rule: fan-out subagents write disjoint files or emit data; central agent owns shared files |
| Consider tagging every server emit site | (self-corrected) skipped sites whose routes drop `code`, and API-format responses to external clients | Define "UI-rendered only" scope for code-mapping before tagging |

The bulk of the "steering" here was **self-correction under good discipline** — the one
true human redirect was "keep going, finish the list," plus the "ship-change" trigger.

## 6. Skills, tools & memory created — and why they're effective

- **Memory saved (project):** *Worktree cross-package typecheck gotcha* — a fresh git
  worktree has an EMPTY `node_modules`, so cross-package `@blackbelt-technology/*`
  imports resolve UP to the MAIN repo's `packages/` (which lack your worktree's changes).
  **Why effective:** it explains a class of phantom tsc errors that look like your bug
  but are topology artifacts. **Invoke when:** typechecking cross-package changes in a
  worktree — run `npm install` in the worktree so workspaces symlink to local source.
- **Scripts created (reusable, repo-lasting):** `scripts/i18n-migrate-auto-keys.mjs`
  (codemod), `scripts/i18n-parity.mjs` (catalog parity — later upgraded to **import**
  plugin catalogs via jiti instead of regex-parsing unquoted JS objects), and
  `scripts/i18n-lint.mjs` (leak detector with dead-code/demo/non-UI exclusions). These
  are the durable i18n guardrails — run them on every future i18n change.
- **Subagent patterns worth reusing:** `translator` (batch-parallel translation with
  central merge + coverage check) and per-package `react-expert`/`nodejs-expert`
  wrapping (disjoint files, emit-keys-JSON, central merge).
- **Skill that SHOULD exist:** an `i18n-coverage-sweep` project skill capturing the
  full recipe (foundation → codemod → translator fan-out → plugin contract → Zone-3
  code-mapping → parity/lint gates). None was created; this playbook is the interim form.

## 7. Pitfalls & dead ends

- **Worktree empty `node_modules`** → cross-package `@blackbelt-technology/*` types
  resolve to the main repo. **Fix:** `npm install` inside the worktree (workspaces
  symlink local packages). Runtime + shared typecheck clean afterward.
- **Pre-existing tsc errors masquerade as yours.** `faux-scenarios` rootDir + 7
  runtime-jsx errors were present in the main repo too. **Fix:** confirm against the
  main repo before "fixing"; filter them out (`grep -v faux-scenarios`).
- **Parity script silently checked only core, not plugins.** Two causes: mis-split of
  `zh-CN`/`hu` blocks, then plugin catalogs use **unquoted** identifier keys
  (`rolesHeading:` not `"rolesHeading":`) the regex missed. **Fix:** stop regex-parsing
  JS objects — **import the actual `catalog` object via jiti**.
- **Duplicate keys after a fill pass.** Merging re-added existing keys → tsc duplicate
  errors. **Fix:** skip keys that already exist during the merge; grep for `^};` to find
  dict boundaries when injecting.
- **Atomic edit rollback hid completed tasks.** A failed edit in a multi-part `tasks.md`
  update rolled back the whole batch, leaving done tasks unchecked. **Fix:** re-inspect
  the file after any edit failure; mark them individually.
- **CodeRabbit auto-skips >150-file diffs** (286 files here) → no review threads, clean
  single-round ship. Don't wait for a review that won't come.
- **`gh` couldn't update local `develop`** (checked out in the parent worktree) — the
  **remote merge + branch delete still succeeded**. The parent had pre-existing unrelated
  uncommitted changes blocking a local ff-pull; leave those untouched (surgical discipline).

## 8. Reproduce it faster — checklist

**Inputs to have ready:** a well-zoned OpenSpec change (`proposal.md` + `tasks.md` with
string counts + acceptance gates); the existing i18n runtime (`packages/client/src/lib/
i18n.tsx`); a worktree for the change.

1. `npm install` **inside the worktree** first (avoid the cross-package resolution trap).
2. Read `tasks.md` + proposal; propose a phase plan; align before coding.
3. Build foundation by hand: new language, `LEGACY_ALIASES`, `i18n-parity.mjs`,
   `i18n-lint.mjs`, unit tests → green → **commit**.
4. Codemod `auto.*` → structured keys (`i18n-migrate-auto-keys.mjs --write`); verify 0
   `auto.*` remain; typecheck.
5. Build the source-key map; split into ~8 batches; dispatch parallel `translator`
   subagents; **merge centrally**; verify coverage; fill catalogs.
6. Add the plugin contract additively (context `t`/`language`, `useT`/`useLanguage`,
   `manifest.i18nCatalog`, **per-plugin aliased** generator import); wire one reference
   plugin end-to-end; fan one subagent per remaining plugin (emit keys JSON); merge +
   **regenerate registry once**.
7. Zone 3: `{code, vars}` protocol + `resolveServerMessage` + `err.*` keys; tag only
   UI-rendered emit sites.
8. Gate: full `npm test` + `i18n-parity` + `i18n-lint --strict` + `biome` → **commit**.
9. `ship-change` → verify → archive + sync specs → PR → CI → squash-merge → remove worktree.

**Final artifacts produced:** structured i18n catalogs (`en`/`zh-CN`/`hu`, 1367 core +
321 plugin keys), 3 i18n scripts under `scripts/`, plugin i18n contract across
`packages/shared` + `dashboard-plugin-runtime`, `err.*` code-mapping (spawn/resume/git/
doctor), tests under `packages/client/src/__tests__/` — all merged via PR #319.

---

_Generated from session `019f6111-8b57-7d26-bf70-fee42c1ac790` · `pi-agent-dashboard` · 2026-07-14. Source extract: session facts sheet (make-all-ui-text-i18n)._
