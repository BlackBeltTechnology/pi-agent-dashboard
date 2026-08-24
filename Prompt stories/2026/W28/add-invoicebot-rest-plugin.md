---
session: 019f451f
week: 2026/W28
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [add-invoicebot-rest-plugin]
proposal_excerpt: "The InvoiceBot React app (Board / Opened-invoice / Ask / Settings surfaces) has no backend. Every screen calls a typed `InvoiceBotClient` whose methods are stubs. InvoiceBot's logic already exists as four role-scoped…"
---

# How we did it: Add a REST plane to InvoiceBot — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator kicked off a single skill command:

```
/skill:openspec-apply-change add-invoicebot-rest-plugin
```

The *real* objective, once the proposal + tasks.md were absorbed: give the InvoiceBot
React app (Board / Opened-invoice / Ask / Settings) a real backend by building a new
**server-only dashboard plugin** (`packages/invoicebot-plugin/`) that exposes the four
existing role-scoped `ib_*` selectors (`query`/`review`/`setup`/`rules`) over REST —
**without forking their logic**. The heavy lift was a *cross-repo* one: the plugin lives
in `pi-agent-dashboard`, but the invoice logic lives in the sibling repo
`pi-invoice-bot`, whose state-dir globals had to become request-scoped so one engine
process can serve many cwds. This was an apply-an-existing-plan run, so the plan (42
tasks) was the spec; the AI executed it end-to-end, then the operator said **"commit and
push to remote."**

## 2. TL;DR playbook

1. **Invoke the apply skill on the change name** (`/skill:openspec-apply-change
   add-invoicebot-rest-plugin`). Let the AI read `tasks.md`, `proposal.md`, and the
   `api-contract.md` before writing a line.
2. **Batch-read the port source-of-truth** from the sibling repo first
   (`pi-invoice-bot/extensions/invoicebot/index.ts` + the `flows/invoicebot/process/*`
   importers) — the plugin must *mirror*, not reinvent, the tool shapes.
3. **Capture a test baseline before touching anything** (`npm test` backgrounded to a
   log). Record which tests already fail so your work is distinguishable from pre-existing
   breakage.
4. **Do the scoping refactor in the source repo** (`AsyncLocalStorage` for `STATE_DIR`/
   `BLOB_DIR`; convert top-level path consts to lazy getters) and **verify no regression**
   before adding any facade.
5. **Extract shared logic into an `engine-core.ts`** in the source repo so the in-session
   `ib_*` tools and the dashboard facade run *one* implementation (DRY / port fidelity).
6. **Scaffold the server-only plugin** against the manifest validator: `port.ts` (the
   `InvoiceEngine` interface) → `fake.ts` (fixtures) → `real.ts` (facade pass-through) →
   `select.ts` (Real if the `file:` link resolves, else Fake) → `routes.ts` → `session-link.ts`.
7. **Test through the plugin's own vitest config first**, then register it in the root
   workspace so `npm test` picks it up; typecheck with `tsc --noEmit -p`.
8. **Run the quality gate** (`biome check --error-on-warnings`), fix cognitive-complexity
   warnings by extracting helpers, and re-run the full suite for a zero-regression tally.
9. **Commit surgically per repo** — stage only your files, leave pre-existing dirty files
   alone — then push each repo to its tracked remote.

## 3. How the collaboration unfolded

**Phase 1 — Discovery & context load.** The AI read `tasks.md` (42 tasks, fresh start),
the proposal, and the API contract, then batch-read the *reference* files from the sibling
`pi-invoice-bot` repo (`extensions/invoicebot/index.ts`, the `process/*` importers, the
plugin-runtime context API). *Why it worked:* it treated the sibling repo's tool code as
the source-of-truth to mirror, so nothing was invented.

**Phase 2 — Scope confirmation (the one human gate).** Before writing code the AI used a
single `ask_user` to confirm two consequential scope points, then proceeded. *Decision
point:* the operator authorized the ALS refactor scope up front, which unblocked the whole
run.

**Phase 3 — Baseline capture.** `npm test` was backgrounded to `/tmp/ib-baseline-test.log`;
the AI grepped for failing test files and recorded **22 pre-existing failures** as the
baseline. *Why it worked:* every later "did I break something?" question had a reference.

**Phase 4 — Source-repo refactor (§5b).** `STATE_DIR`/`BLOB_DIR` moved to
`AsyncLocalStorage`; the two files with top-level path consts (`_rules.ts`, `_handoff.ts`)
had those consts converted to lazy functions (they evaluated at import). The AI verified
via a **jiti smoke test** (the exact loader the RealInvoiceEngine uses) after discovering
the sibling repo's vitest was broken by an unrelated `pi-ai` export error.

**Phase 5 — Plugin generation (§2–§7).** Server-only manifest → engine port → Fake →
Real → select → 4 routes (keyed by `cwd`, `badCwd → 400`) → session-link seam (reuse a
live cwd-matched session via `emitEventToSession`, else spawn + correlate by runId). 41
plugin tests written against the plugin's own vitest config, then wired into the root
workspace.

**Phase 6 — Verify, quality-gate, ship.** `tsc --noEmit` clean; `biome
--error-on-warnings` surfaced two cognitive-complexity warnings, fixed by extracting
helpers (one intentional fixture switch got a justified `biome-ignore`). Full suite ran
green (a flaky `recovery-offer` timing test passed standalone; a new
`publish-allowlist-complete` failure was fixed by adding the package to `publish.yml`).
On **"commit and push to remote"** the AI committed surgically in each repo and pushed to
each tracked remote.

## 4. Prompts that worked

- **The goal prompt** — `/skill:openspec-apply-change <change-name>`. Effective because the
  plan already existed: a single, unambiguous skill invocation with the change name lets
  the AI self-source every artifact (spec, contract, tasks) and execute the full task list.
  The lesson: **when a good OpenSpec plan exists, apply it by name — don't re-describe it.**
- **High-leverage follow-up** — `commit and push to remote`. Short, but it triggered the
  correct surgical multi-repo commit behavior (stage-only-mine, per-repo tracked-remote
  push). Effective because the AI had already kept the working tree clean throughout.

Rewrite of a weak-but-implied instruction: instead of relying on the AI to *guess* which
dirty files are yours, a stronger kickoff addendum is **"this change spans pi-agent-dashboard
and pi-invoice-bot; commit only files you create/edit, never the pre-existing dirty ones."**

## 5. Steering & corrections (what to watch for)

This was a low-steering run (2 prompts) because the plan was solid. The guardrails below
come from the *self-corrections* the AI made — bake them in to skip the loop:

| The AI tended to… | The human/AI had to steer by… | Bake this in next time by… |
|-------------------|-------------------------------|----------------------------|
| Trust the sibling repo's vitest suite | Discovering it fails identically on a clean tree (unrelated `pi-ai` export error) | State up front "the sibling suite is pre-broken; smoke-test via jiti, not vitest" |
| Add invalid edit properties / broken helpers mid-refactor | Re-doing edits with minimal unique anchors, removing a stray `tryReuse`/`newText_more` | Prefer small single-anchor edits; re-read the region before a multi-line block edit |
| Leave a non-private package out of the publish allowlist | A failing `publish-allowlist-complete` test caught it | Whenever you add a publishable package, add it to `publish.yml` `PACKAGES` in the same step |
| Stage everything including regen drift | Reverting the auto-regenerated `plugin-registry.tsx` and skipping `.pi/settings.json` | Commit surgically: `git add <your files>` only, verify `git diff --cached` before commit |

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was saved this session; it *consumed* `openspec-apply-change`. One
subagent was spawned:

- **`general-purpose` subagent — "Add architecture.md pointer for invoicebot REST plane."**
  Captures the repo rule that all `docs/` prose writes go through a subagent in caveman
  style (Rule 6). Effective because it keeps the main context focused on code while the
  doc pointer is written correctly. Invoke it whenever a landed change needs a `docs/`
  pointer.

**Skill worth creating:** a *cross-repo state-scoping* playbook — "make a globals-based
engine request-scoped with AsyncLocalStorage, extract an `engine-core`, add a thin facade
export, and verify via jiti when the host repo's test runner is broken." This exact pattern
(lazy-ify top-level consts + ALS + jiti smoke) recurs whenever a single-tenant tool becomes
a multi-cwd service.

## 7. Pitfalls & dead ends

- **Sibling repo tests are pre-broken.** `pi-invoice-bot`'s vitest fails on a
  `@earendil-works/pi-ai` `./providers/faux` export error on a *clean* tree. → Don't chase
  it; confirm with `git stash` + re-run, then smoke your changes through **jiti** instead.
- **Native `node --experimental-sqlite` type-stripping can't resolve extensionless imports.**
  The invoice-bot uses extensionless imports needing a loader. → Smoke through jiti (the
  loader the RealInvoiceEngine actually uses), not plain node.
- **Top-level path consts evaluate at import** — swapping `STATE_DIR` to ALS isn't enough
  if `_rules.ts`/`_handoff.ts` compute paths at module load. → Convert them to lazy getters.
- **The `file:` optional dep degrades to a dangling symlink in a worktree.** That's *by
  design* here (→ Fake binds); in the main repo it resolves → Real. Don't "fix" the dangling
  link inside the worktree.
- **New non-private package fails the publish allowlist test.** → Add it to `publish.yml`
  `PACKAGES` (and check the companion `jiti-packages-parity` test) as part of scaffolding.
- **`npm install` regenerates `plugin-registry.tsx`** and can drop unrelated fixtures. → A
  server-only plugin adds *no* client entry; revert the regen drift to keep the diff surgical.
- **Cognitive-complexity biome warnings fail `--error-on-warnings`.** → Extract helpers;
  for an intentional fixture switch, use a justified `biome-ignore`.

## 8. Reproduce it faster — checklist

**Inputs to have ready:**
- The OpenSpec change name + its `tasks.md`/`proposal.md`/`api-contract.md`.
- Path to the sibling source repo (`<invoicebot-checkout>`) and its port
  source-of-truth (`extensions/invoicebot/index.ts`, `flows/invoicebot/process/*`).
- Awareness that the sibling test suite is pre-broken (use jiti to smoke).

**Steps:**
- [ ] `/skill:openspec-apply-change <change>`; let the AI read all artifacts + port source first.
- [ ] Capture a `npm test` baseline to a log; record pre-existing failures.
- [ ] Source repo: ALS-scope `STATE_DIR`/`BLOB_DIR`, lazy-ify top-level path consts, extract `engine-core.ts`.
- [ ] Verify the refactor via a jiti smoke test (not the broken vitest).
- [ ] Scaffold server-only plugin: `port → fake → real → select → routes → session-link`.
- [ ] Test through the plugin's own vitest config, then register it in the root workspace; `tsc --noEmit -p`.
- [ ] `biome check --error-on-warnings`; fix complexity by extracting helpers; add the package to `publish.yml`.
- [ ] Run full suite for a zero-regression tally; revert any `npm install` regen drift.
- [ ] Commit surgically per repo (stage only your files); push each to its tracked remote.

**Artifacts produced:**
- Dashboard (`origin/private/invoicebot`, `a8c546bcc`): `packages/invoicebot-plugin/` (port,
  Real/Fake engines, 4 routes, session seam, 41 tests, AGENTS tree, README) + `publish.yml`
  allowlist, root `vitest.config.ts`, `docs/architecture.md` pointer, synced `api-contract.md`/`tasks.md`.
- invoice-bot (`origin/master`, `392d298`): §5b `AsyncLocalStorage` state-dir scoping, extracted
  `engine-core.ts`, `engine.ts` facade + `./engine` export, `tests/state-dir-scoping.test.ts`.

---

_Generated from session `019f451f-731d-7a63-8add-c1678e0d7027` · `/Users/robson/Project/pi-agent-dashboard/.worktrees/private-invoicebot-plugin` · 2026-07-09. Source extract: session facts sheet._
