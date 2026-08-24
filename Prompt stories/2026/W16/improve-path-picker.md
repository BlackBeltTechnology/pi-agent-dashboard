---
session: 019da559
week: 2026/W16
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (21 user prompts); large facts sheet (~12329 tok)"
upgrade_status: pending
openspec_changes: [improve-path-picker, polish-header-logo-and-card-stripes]
proposal_excerpt: "The current folder browser (`PathPicker`) has three usability gaps that bite daily:"
---

# How we did it: Improve the PathPicker folder browser — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator opened in **explore mode** ("Enter explore mode. Think deeply… you must
NEVER write code") with a UX complaint about the dashboard's folder browser: typing
`pi` in the PathPicker didn't surface `pi-dashboard`. The *real* objective, once the
steering turns landed, was three concrete usability fixes to `PathPicker`:

1. **Filter that actually finds things** — server-side substring matching so matches
   past the 200-entry cap aren't hidden ("it is not shown because lot of elements
   presented / Support fuzzy/substring matching").
2. **Smarter Enter** — stop confirming non-existent paths; behave differently for a
   typo vs. an exact entry vs. a trailing-slash "current dir".
3. **Create folders inline** — a "New folder" affordance that respects the
   localhost-only trust posture ("Trusted localhost tool").

The whole thing was to run through OpenSpec as **one change** ("One openspec"),
explore → proposal → apply → verify → archive → ship.

## 2. TL;DR playbook

1. **Start in explore mode** and dump the raw symptom, not a solution. Let the AI map
   the current code (`PathPicker.tsx`, `browse.ts`) and enumerate root-cause scenarios
   in a table before choosing a fix.
2. **Answer the disambiguation table tersely** — one line per open question
   ("substring", "trusted localhost", "one openspec"). Terse answers collapse the
   design space fast.
3. **`/opsx:ff improve-path-picker`** — fast-forward all four artifacts
   (proposal → design → delta spec → tasks) in one go once the design is settled.
4. **Ask "Is there anything to clarify?"** before implementing. The AI surfaced the
   genuinely bite-y edge cases (mobile footer layout, stale-parent mkdir). Reply
   **"trust"** to let it apply sensible documented defaults and patch design.md to match.
5. **`/opsx:apply`** — implement TDD, server-first (shared types → browse filter/rank
   → mkdir → client api helper → PathPicker rewrite → Enter state machine → new-folder UI).
6. **When the full suite is red from unrelated pre-existing failures, say "ignore it"**
   — but insist the AI proves its own new tests pass in isolation first.
7. **`/opsx:verify`** → fix warnings → **`/opsx:archive`** (syncs delta specs to main).
8. **Do the manual smoke tests yourself** (big-dir filter, Enter rules, new-folder),
   reply **"all green"**, then let the AI flip the smoke-test checkboxes and archive.
9. **`build and deploy`**: `npm run build` → `POST /api/restart` → `npm run reload`.
10. **Commit only your scope.** In a repo with parallel pi sessions racing the index,
    stage exactly your 13 files and verify the commit landed with the right subject.

## 3. How the collaboration unfolded

**Phase A — Discovery (explore mode).** The AI read `PathPicker.tsx` and `browse.ts`,
then laid out the current behaviour precisely: client-side *prefix* filter,
server `listDirectories` caps at **200** entries sorted alphabetically. It produced a
root-cause table (bare `pi` jumps to `/` vs. sorted-past-the-cap) instead of guessing.
*Why it worked:* the operator's one-liner symptom was ambiguous; the table forced the
real cause (cap + prefix-only) into the open before any code.

**Phase B — Design (still explore).** With "substring, trusted localhost, one openspec"
answered, the AI drew the before/after data flow (push `q` to the server, filter
*before* the 200-cap, 150ms debounce + `AbortController`) and picked **substring +
4-tier ranking** (exact → prefix → word-boundary → substring) over fuzzy subsequence.
Decision point: the human chose predictability over fuzzy matching.

**Phase C — Artifact generation (`/opsx:ff`).** Four artifacts created and
`openspec validate --strict`-clean: proposal, design (7 decisions), delta
`specs/filesystem-browser/spec.md`, tasks (9 groups, ~35 checkboxes, TDD-ordered).

**Phase D — Clarify-before-code.** "Is there anything to clarify?" surfaced two
non-obvious edge cases: where the New-folder button lives on a narrow dialog, and what
"current directory" means for mkdir when the typed parent doesn't exist
(`fetchedDirRef` points at the last *successful* dir → could create a folder in the
wrong place). The operator replied **"trust"**; the AI applied documented defaults
(disable "Create here" when parsed parent ≠ fetched dir; Enter flushes the debounce
synchronously) and **patched design.md so the record matched reality**.

**Phase E — Implementation (`/opsx:apply`, TDD server-first).** Shared types
(`MkdirRequest/Result/Response`) → `listDirectories(dir, q?)` with ranking →
`createDirectory` + `validateMkdirName` → `POST /api/browse/mkdir` route →
`browseDirectory(path,{q,signal})` client helper → PathPicker rewrite + Enter state
machine + new-folder UI. 17 new server tests + ~30 PathPicker tests green.

**Phase F — Verify → smoke → archive.** `/opsx:verify` gave a completeness/correctness/
coherence report; the AI fixed warnings (added word-boundary and arrow-key nav tests),
left the 3 manual smoke tests for the human. After "all green" it flipped 8.3–8.5 and
`/opsx:archive` synced the delta spec to `openspec/specs/filesystem-browser/spec.md`.

**Phase G — Build, deploy, commit.** `npm run build` → `POST /api/restart` →
`npm run reload`. Then a **messy commit fight** (see Pitfalls) with parallel sessions
racing the git index, finally landing all 13 files under a dedicated
`feat(path-picker): …` subject.

## 4. Prompts that worked

- **Goal prompt (explore mode + raw symptom).** Opening in explore mode with just the
  observed behaviour ("typing `pi` doesn't show pi-dashboard") — not a prescribed fix —
  let the AI find the real root cause (200-cap + prefix filter). *Effective because* it
  didn't anchor the AI on a wrong solution.
- **The terse design answers** — "Support substring / Trusted localhost tool / One
  openspec". Four words each, but each closes a whole branch of the design tree.
  *High-leverage.*
- **"trust"** — after the AI listed the edge-case defaults, this one word unlocked the
  entire implementation while still forcing the AI to *write the defaults into design.md*.
- **"The full tests failed. ignore it"** — correctly scoped the AI to its own change
  when the repo had pre-existing unrelated failures. Stronger version: *"Ignore the
  pre-existing repo failures — but first prove YOUR new tests pass in isolation and
  tell me the count."* (The AI did exactly this: 17/17 server, 30/30 client.)
- **"all green OK"** — the human ran the manual smokes and reported back, the one thing
  the AI genuinely cannot do from the shell.

Weak prompt to rewrite: **"fix" / "go on" / "commit changes"** were fine mid-flow but
carry no scope. Prefer *"commit ONLY the improve-path-picker files; there are parallel
sessions — verify the commit landed with the right subject before moving on."*

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Jump toward a fix from the ambiguous symptom | "it is not shown because lot of elements presented / substring" | Open in explore mode; demand a root-cause table before any fix |
| Over-engineer (fuzzy matching, extra Fastify-inject test for shared middleware) | "substring" / accept documented "shared networkGuard" rationale | State the simpler choice up front; trust shared-middleware coverage |
| Treat the whole red test suite as its problem | "The full tests failed. ignore it" | Say "scope to your change; pre-existing failures are out of scope" from the start |
| Assume it could run the UI smoke tests | Human ran them and replied "all green" | Reserve 8.x manual-smoke tasks for the human explicitly |
| Lose the commit to a racing parallel session (twice) | "there is changes belongs this change not committed" | Stage + `git commit`, then immediately re-read `git log` to confirm it landed |

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created this session — it ran entirely on the existing
**OpenSpec `/opsx:*` command surface** (`ff`, `apply`, `verify`, `archive`, `explore`)
plus the project's build/reload triad.

**Recommended skill to create:** a *"commit-my-scope-under-parallel-sessions"* guard.
The single biggest time sink here was the git index being clobbered by concurrent pi
sessions — the commit was lost, silently amended over, and re-lost across three
attempts. A small skill that (a) stages an explicit file list, (b) commits, (c)
re-reads `git log -1 --stat` to assert the SHA/subject/file-count match, and (d) refuses
to `--amend` when the tree changed underneath, would remove that entire failure class.

## 7. Pitfalls & dead ends

- **Pre-existing repo test failures masquerade as your bug.** 3 server tests failed due
  to a repo-restructure assumption, unrelated to the change. *Fix:* run your new tests in
  isolation (`npx vitest run <your test file>`), report the count, and `git stash`-compare
  if unsure before blaming your diff.
- **Client test flakiness from React render timing.** `waitFor` returned as soon as the
  create-here row appeared but before `entries` updated. *Fix:* wait for the *old* entries
  to disappear, not just the new row to appear.
- **`null` vs `undefined` dedup collision.** The PathPicker fetch-dedup key collapsed a
  `null` fetched-dir and an `undefined` arg to the same key, suppressing a real fetch.
- **Session-card state-derivation bug (logged, not fixed).** With all artifacts done but
  3 tasks unchecked, `deriveChangeState()` returned `IMPLEMENTING`, so the card showed
  *Apply* instead of *Verify/Archive*. Flipping the last checkboxes fixed the display,
  confirming the theory. Worth a follow-up change `fix-session-openspec-state-derivation`.
- **Parallel-session git race (the big one).** A concurrent pi session grabbed the staged
  files and committed them under the wrong subject; a later `--amend` replayed the OLD
  commit without the files, silently losing them. It took three passes to land the 13
  files under `feat(path-picker): …`. *Fix:* never trust that a `git commit` ran — re-read
  `git log` after every commit; avoid `--amend` when other sessions are active.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** dashboard running at `localhost:8000`; a directory with 200+
sibling folders to smoke-test the filter; no other pi sessions racing the git index (or
commit with extreme care).

**Steps:**
- [ ] Explore mode + raw symptom → demand root-cause table.
- [ ] Answer design questions in one-liners (substring, localhost-trust, one change).
- [ ] `/opsx:ff improve-path-picker` → 4 artifacts, `validate --strict` clean.
- [ ] "Is there anything to clarify?" → reply **"trust"** → AI patches design.md with defaults.
- [ ] `/opsx:apply` → TDD server-first; prove new tests pass in isolation.
- [ ] `/opsx:verify` → fix warnings → run manual smokes yourself → "all green".
- [ ] `/opsx:archive` (syncs delta spec to main).
- [ ] `npm run build` → `POST /api/restart` → `npm run reload`.
- [ ] Stage only your 13 files → commit → **re-read `git log` to confirm it landed**.

**Artifacts produced:**
- `openspec/changes/archive/2026-04-20-improve-path-picker/` (proposal, design, spec, tasks)
- `openspec/specs/filesystem-browser/spec.md` (synced: `q` filter + ranking, mkdir API, new Enter rules)
- `packages/shared/src/rest-api.ts` (Mkdir types, `q` param)
- `packages/server/src/browse.ts`, `routes/file-routes.ts` (`listDirectories(dir,q)` + `POST /api/browse/mkdir`)
- `packages/client/src/lib/browse-api.ts`, `components/PathPicker.tsx` (+ tests)
- `docs/architecture.md` (updated)

---

_Generated from session `019da559-8b6d-7269-8f63-06e2133190f0` · `pi-agent-dashboard` · 2026-04-20. Source extract: deterministic facts sheet._
