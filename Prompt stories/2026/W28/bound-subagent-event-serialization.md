---
session: 019f5363
week: 2026/W28
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [bound-subagent-event-serialization]
proposal_excerpt: "A single `Agent` (subagent) call crashed the **whole dashboard server** with a fatal V8 out-of-memory. Confirmed from `~/.pi/dashboard/server.log`:"
---

# How we did it: Automate a P0 OOM-crash guard with a Playwright liveness spec — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened with an open-ended feasibility question:

> "Is it possible to create e2e tests with playwright system browser and docker test?"

Once the AI confirmed the harness already existed and the two later steering turns
("create and archive this", "commit") landed, the **real objective** crystallized:
take the nearly-done OpenSpec change `bound-subagent-event-serialization` — a P0 fix
that bounds per-event serialized size so an oversized subagent payload can't
OOM-crash the dashboard server — and **automate its one remaining manual task (5.3):**
prove via a Playwright + Docker e2e that `/api/health` stays up after a subagent-heavy
turn. Then sync specs, archive the change, and commit *only* its files in a shared
working tree.

## 2. TL;DR playbook

1. Ask the feasibility question; let the AI confirm the harness (`npm run test:e2e`,
   `PW_CHANNEL=chrome`, faux-scenario bind-mount) before writing anything.
2. Read the OpenSpec change to find the *real* deliverable — here, the one open
   **manual** task (5.3) is exactly what a Playwright e2e can automate.
3. Inspect the faux-scenario dispatch path: is the catalog bind-mounted (edit picks up
   without image rebuild)? Does any test iterate *all* SCENARIOS (would force a matrix)?
4. Add a faux scenario (`oversized-turn`: `seq 1 8000` ≈ 90 KB tool-result) that flows
   through the real ingest→persist→broadcast (`JSON.stringify`) path — the exact OOM path.
5. Write the spec: drive `[[faux:oversized-turn]]`, assert `/api/health` 200, then prove
   a follow-up `[[faux:plain-text]]` round-trips **in the same session** (a restarted
   server would drop it), health green again. Reuse `spawnFreshGitSession` + the
   3-consecutive-OK health gate.
6. `npx tsc --noEmit` the new files only; add the two doc rows (`tests/e2e/AGENTS.md`,
   `qa/AGENTS.md`) directly per protocol.
7. Sync the delta spec's ADDED requirements into the main spec (append-only), validate
   *only your spec* (`openspec validate <spec> --type spec`), then archive.
8. Commit with explicit pathspec (`git commit --only -- <paths>`) so concurrent
   sessions' staged work is never swept in. Use a message file placed *before* the `--`.

## 3. How the collaboration unfolded

**Phase 1 — Discovery (feasibility).** The AI ran a single `kb_search`/`grep` sweep over
`docs/faq.md`, `README.md`, `package.json`, `playwright.config.ts` and answered "yes,
already supported," enumerating the harness lifecycle, `PW_CHANNEL`, and the convention
that browser scenarios live in `tests/e2e/`. *Why it worked:* it grounded the whole
session in existing infrastructure before proposing new code.

**Phase 2 — Disambiguation (decision point).** On "create and archive this," the AI
**stopped and asked** which "this" — the e2e discussion or the attached OpenSpec change
(11/12 tasks done). This one `ask_user` avoided building the wrong artifact.

**Phase 3 — Understand-the-change.** It read the proposal and found task 5.3 was a
*manual* liveness check — the automatable target. Then it de-risked the addition with
three surgical greps: is the faux catalog bind-mounted read-only (`compose.test.yml:79`)?
how is `[[faux:...]]` dispatched? does any test iterate all SCENARIOS? All green → safe
to add one scenario.

**Phase 4 — Generate.** Three pieces: the `oversized-turn` faux driver, the
`oversized-event-liveness.spec.ts`, and two doc rows. Typecheck clean on the new files.

**Phase 5 — Sync & archive.** The delta spec's two ADDED requirements weren't in the
main spec; the AI appended them (no conflicts), validated *only* the touched spec (repo
had many pre-existing failures), marked 5.3 done, and archived to
`openspec/changes/archive/2026-07-12-bound-subagent-event-serialization`.

**Phase 6 — Isolated commit.** In a shared `develop` working tree with other sessions'
staged renames and `groups.json` edits, the AI committed **only** its 10 paths via
explicit pathspec, verified the unrelated in-flight work stayed untouched, and did **not**
push (the user asked only to commit).

## 4. Prompts that worked

- **Goal prompt** — "Is it possible to create e2e tests with playwright system browser
  and docker test?" A good *feasibility-first* kickoff: it invited the AI to survey
  existing infra before coding. Stronger next time: name the target up front —
  *"Automate task 5.3 of bound-subagent-event-serialization as a Playwright e2e that
  proves /api/health survives an oversized subagent turn."*
- **"create and archive this"** — high-leverage but ambiguous; it worked only because
  the AI paused to disambiguate. Prefer *"create the e2e for change X, then sync specs
  and archive it."*
- **"commit"** — terse and effective *because* the AI already knew the shared-tree
  constraint and self-imposed pathspec isolation.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| treat "this" as the recent e2e topic | (AI self-corrected via `ask_user`) | name the exact OpenSpec change / artifact in the prompt |
| default to a broad `openspec validate` | (AI scoped to the one touched spec) | validate only your spec when the repo has pre-existing failures |
| risk sweeping concurrent staged work into the commit | "commit" (AI self-imposed `--only` pathspec) | state "shared tree — commit only my change's paths" up front |
| put commit options after `--` | (AI moved message-file flag before `--`) | remember: `git` options must precede the `--` pathspec |

## 6. Skills, tools & memory created — and why they're effective

No skill or memory was created this session — but the workflow is clearly repeatable and
warrants one. **Recommended skill: `automate-manual-openspec-task-as-e2e`** (project
scope). It would capture: (1) find the lone *manual* task in a near-done change; (2)
verify the faux catalog is bind-mounted + no all-SCENARIOS matrix before adding a
scenario; (3) the liveness-assertion shape (heavy turn → health 200 → same-session
follow-up round-trips → health green); (4) sync-spec-then-archive; (5) isolated
`git commit --only -- <paths>` in a shared tree. That removes the repeated discovery
greps and the pathspec-safety reasoning every future "automate task N.M" run needs.

## 7. Pitfalls & dead ends

- **Ambiguous "this."** With both an e2e discussion and an attached change in context,
  "create and archive this" is under-specified — the `ask_user` pause was correct, not
  overhead.
- **Repo-wide `openspec validate` is noisy.** Many pre-existing failures across the repo;
  validate only the spec you touched (`openspec validate <spec> --type spec`).
- **Test harness needs an ephemeral HOME.** The first vitest run misbehaved; re-run with
  `HOME=$(mktemp -d) npx vitest run …`.
- **`git commit` flag ordering.** Options after `--` fail — put the `-F <msgfile>` before
  the pathspec. Use `--only -- <paths>` in a shared tree so others' staged work is untouched.
- **Don't push unless asked.** The user said "commit" — the AI stopped there.

## 8. Reproduce it faster — checklist

- [ ] Confirm the harness: `npm run test:e2e`, `PW_CHANNEL=chrome`, faux catalog
      bind-mounted read-only (`compose.test.yml`).
- [ ] Identify the change's single **manual** task as the automation target.
- [ ] Grep-gate: catalog bind-mounted? no all-SCENARIOS matrix? `[[faux:…]]` dispatch path?
- [ ] Add faux scenario emitting a genuinely large tool-result (≈90 KB) with an end marker.
- [ ] Write spec: heavy turn → `/api/health` 200 → same-session follow-up round-trips →
      health green. Reuse `spawnFreshGitSession` + 3-consecutive-OK gate, `PI_E2E_SEED=1`.
- [ ] `npx tsc --noEmit` new files; add `tests/e2e/AGENTS.md` + `qa/AGENTS.md` rows.
- [ ] Sync delta ADDED reqs into main spec (append-only); validate only that spec; archive.
- [ ] `git commit --only -- <paths>` (message file before `--`); verify others' work
      untouched; do **not** push.

**Key inputs:** a near-done OpenSpec change with a manual liveness task, the Docker e2e
harness, the faux-scenario mechanism.
**Final artifacts:** `tests/e2e/oversized-event-liveness.spec.ts`,
`qa/fixtures/faux-scenarios.ts` (`oversized-turn`), synced
`openspec/specs/in-memory-event-buffer/spec.md`, archived change, doc rows, commit
`0b718ab6a` (10 files, +186 −4).

---

_Generated from session `019f5363-40df-717e-b569-425a399caa39` · `pi-agent-dashboard` · 2026-07-12. Source extract: session facts sheet (deterministic extract)._
