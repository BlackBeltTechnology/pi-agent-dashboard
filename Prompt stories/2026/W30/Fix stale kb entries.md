---
session: 019f8575
week: 2026/W30
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
---

# How we did it: Fix stale KB DOX entries — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The user opened with a three-word prompt: **"Fix stale kb entries"**. The real
objective, once the work unfolded, was: drive `kb dox lint` back to **0 stale** —
but *correctly*. That means distinguishing rows whose documented purpose genuinely
drifted (which must be **rewritten**) from rows that only drifted by incidental
source-hash change (which are safely **re-acknowledged**). By the end it also meant
reconciling a *second* staleness counter (the dashboard KB server) that disagreed
with the CLI, excluding a scratch dir that was spamming phantom entries, and landing
a clean, scoped commit.

## 2. TL;DR playbook

1. Load the project skill: `fix-stale-kb-dox-rows` (auto-loads on "fix stale kb").
2. Enumerate: `node_modules/.bin/kb dox lint | awk '{print $1}' | sort | uniq -c` to
   bucket by category (`stale`, `missing`, `missing-companion`, `over-threshold`).
3. **Don't read every stale file.** For each stale row, `git diff` the source against
   its state *when the owning `AGENTS.md` was last updated* — that reveals material vs.
   incidental drift cheaply.
4. **Material drift → rewrite the row.** Incidental (import moves, version bumps,
   passthrough fields) → **re-acknowledge the hash** in `.pi/dashboard/kb/dox-staleness.json`
   (`map[relPath] = sha256(currentFile)`).
5. Verify: `kb dox lint` shows `0 stale`, and `npx vitest run -t 'dox'` (30 tests) stays green.
6. If a scratch/experiment dir spams `missing`/`missing-companion`, add it to
   `DEFAULT_EXCLUDE` in `packages/kb/src/dox.ts`, then **rebuild** (`cd packages/kb && npm run build`)
   because the bin runs `dist/cli.js`.
7. If the dashboard shows a *different* stale count than the CLI, it's the server's
   `countStale` reading the **whole** map (incl. `.pi/skills/*` that lint's exclude
   skips). Re-ack those hashes directly — no restart needed (`countStale` re-reads per request).
8. Stage **only your files** (`git status --short` first; leave unrelated pre-existing
   changes like `openspec/groups/groups.json` unstaged), then commit.

## 3. How the collaboration unfolded

**Phase 1 — Discovery & triage.** The AI loaded the `fix-stale-kb-dox-rows` project
skill, ran `kb dox lint`, and found 52 stale rows. Instead of reading 52 files, it
built a review sheet grouping stale entries by their owning `AGENTS.md` and captured
each current purpose row. *Why it worked:* the batch was too big to eyeball; the
grouping turned it into a per-owner review.

**Phase 2 — Measure drift, not files.** The key move: for each stale source, diff it
against the commit where its `AGENTS.md` row was last touched. This split 52 rows into
**3 material** (purpose text now factually wrong) and ~40 **incidental** (import
relocations, `0.5.x→0.6.1` bumps, console tweaks, passthrough field adds). *Decision
point:* rewrite the 3, hash-refresh the rest.

**Phase 3 — Fix + re-ack.** Rewrote 3 rows: `ActionList.tsx`/`StatusPill.tsx`
(`@mdi/js` went eager, not lazy), `Dockerfile` (npm→corepack/pnpm), and
`verify-lockfile-versions.mjs` (now parses `pnpm-lock.yaml`). Re-acknowledged the rest
into `dox-staleness.json`. `kb dox lint` → **0 stale**; 30 dox tests green.

**Phase 4 — The scratch-dir noise (steering "yes").** The user unlocked a follow-up:
a `.reverse-spec-scratch/` dir was generating 42 phantom `missing` entries. The AI
confirmed it's gitignored/fs-walk-only (same class as `out`/`bundled-extensions`),
added it to `DEFAULT_EXCLUDE`, rebuilt the kb dist, and gave the *real* tracked harness
`scripts/ab-context/` its own `AGENTS.md`. Editing `dox.ts` re-staled its own row →
updated + re-acked.

**Phase 5 — The counter discrepancy (steering "5 stale").** The user reported "5 stale"
that the CLI didn't show. The AI traced it to the dashboard's `countStale`
(`kb-routes.ts`, `GET /api/kb/stats`) iterating the **entire** map, while `dox lint`
only checks non-excluded dirs. The 5 were `.pi/skills/*` SKILL edits — documented in
`.pi/skills/AGENTS.md` (pointer rows) but invisible to lint because `.pi/` is excluded.
Confirmed their summaries still held, re-acked the 5 hashes. Both counters → 0.

**Phase 6 — Scoped commit ("commit").** Checked `git status`, spotted an unrelated
pre-existing `openspec/groups/groups.json`, deliberately left it unstaged, and committed
only the 6 owned files.

## 4. Prompts that worked

- **The goal prompt — "Fix stale kb entries"** — terse but sufficient *because a project
  skill exists for it*. When a repeatable workflow is skill-backed, a short trigger phrase
  is enough; the skill supplies the procedure.
- **"yes"** — a high-leverage unlock: approved the scratch-dir exclusion + harness-doc
  path the AI had proposed, letting it clear 42 phantom entries in one pass.
- **"5 stale"** — a two-word correction that surfaced the CLI-vs-server counter blind
  spot. Reporting the *exact number you see* (and where) is what let the AI find the
  second counter fast.
- **"commit"** — trusted the AI to stage correctly; it self-scoped and excluded unrelated
  work.

*Stronger kickoff for next time:* "Fix stale kb entries — rewrite rows only where the
documented purpose actually drifted, hash-refresh incidental drift, and reconcile the
dashboard's `countStale` too."

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Stop at "CLI shows 0 stale" | "5 stale" (report the number the dashboard shows) | State up front: reconcile BOTH `kb dox lint` AND the server's `countStale` (whole-map). |
| Focus only on lint-visible rows | Surfacing the scratch-dir noise implicitly ("yes") | Check for gitignored/fs-walk-only dirs spamming `missing`; add to `DEFAULT_EXCLUDE`. |
| Could over-stage the commit | "commit" (and trust it to scope) | Always `git status --short` first; leave unrelated pre-existing changes unstaged. |

## 6. Skills, tools & memory created — and why they're effective

- **`fix-stale-kb-dox-rows` (project skill, patched this session).** Captures the full
  DOX-lint remediation loop: bucket categories, diff-against-last-AGENTS-update to judge
  drift, rewrite-vs-re-ack decision, `DEFAULT_EXCLUDE` for scratch dirs, and — newly added
  — the **CLI-vs-server counter pitfall** (`dox lint` skips `.pi/`, the server's `countStale`
  reads the whole map, so `.pi/skills/*` edits show phantom stale server-side). *Why
  effective:* it removes the "read every stale file" trap and encodes the non-obvious
  second-counter gotcha that cost real investigation time. *Invoke when:* any "fix stale
  kb / DOX drift / missing KB entries" request.

## 7. Pitfalls & dead ends

- **Editing `dox.ts` re-stales its own row.** After changing `DEFAULT_EXCLUDE`, update
  its `AGENTS.md` row *and* re-ack the hash in the same pass.
- **The bin runs `dist/cli.js`, not `src`.** A `DEFAULT_EXCLUDE` change is inert until you
  `cd packages/kb && npm run build`. `dist/` is gitignored, so the source change is what
  you commit; the rebuild is local.
- **Two staleness counters disagree.** `kb dox lint` only scans non-excluded dirs; the
  dashboard's `countStale` iterates the entire `dox-staleness.json`. `.pi/skills/*` is
  documented but excluded from lint → phantom server-side stale. Re-ack those hashes
  directly (lint can't manage them). No restart needed — `countStale` re-reads per request.
- **The hash re-acks are local state.** `.pi/dashboard/kb/dox-staleness.json` is gitignored,
  so it's *not* in the commit — expected, not a mistake.
- **Unrelated working-tree changes.** `openspec/groups/groups.json` was pre-existing; don't
  sweep it into your commit.

## 8. Reproduce it faster — checklist

- [ ] Load skill `fix-stale-kb-dox-rows`.
- [ ] `kb dox lint | awk '{print $1}' | sort | uniq -c` — bucket by category.
- [ ] For each stale row: `git diff <last-AGENTS-commit>..HEAD -- <source>` → material vs incidental.
- [ ] Material → rewrite the `AGENTS.md` row. Incidental → re-ack `map[rel]=sha256(file)` in `dox-staleness.json`.
- [ ] Scratch/fs-walk dir spamming `missing`? → add to `DEFAULT_EXCLUDE` in `packages/kb/src/dox.ts` → `npm run build` in `packages/kb`.
- [ ] Dashboard count ≠ CLI count? → re-ack the `.pi/skills/*` hashes the server's `countStale` sees.
- [ ] Verify: `kb dox lint` = `0 stale`; `npx vitest run -t 'dox'` green.
- [ ] `git status --short`, stage only your files, commit.

**Key inputs:** repo checkout with `node_modules/.bin/kb` built; `.pi/dashboard/kb/dox-staleness.json` present.
**Artifacts produced:** rewritten rows in `docker/AGENTS.md`, `packages/client-utils/src/AGENTS.md`, `scripts/AGENTS.md`; `packages/kb/src/dox.ts` (+ `packages/kb/src/AGENTS.md` row); new `scripts/ab-context/AGENTS.md`; commit `43b2c0e5c`.

---

_Generated from session `019f8575` · `pi-agent-dashboard` · 2026-07-21. Source extract: deterministic facts sheet._
