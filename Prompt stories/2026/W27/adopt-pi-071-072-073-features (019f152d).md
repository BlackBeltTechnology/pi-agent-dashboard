---
session: 019f152d
week: 2026/W27
type: planning
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [adopt-pi-071-072-073-features]
proposal_excerpt: "The pi compatibility floor is already at 0.78.0 (`packages/server/package.json::piCompatibility`), so pi 0.71/0.72/0.73 are firmly below the floor — every API, event, and UX affordance those releases shipped is guaran…"
---

# How we did it: Revalidating a possibly-stale OpenSpec proposal — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator opened with a one-line hunch: *"Maybe this proposal obsolate"* — a
suspicion that the OpenSpec change `adopt-pi-071-072-073-features` had been overtaken
by events and no longer worth keeping. The real objective, once the follow-ups
clarified it, was a **triage decision, not a rewrite**: verify against live source
whether the six implementation pieces were already done (→ archive it) or whether
only the *framing* had gone stale (→ surgically refresh it). The answer turned out to
be the second: the work was untouched, but the "why" leaned on an obsolete
precondition (a sibling change that had moved the version floor), so three targeted
edits and a scoped commit closed it out.

## 2. TL;DR playbook

1. **Ask the AI to verify, not assume.** "Is this proposal obsolete? Check each piece
   against current source before deciding."
2. **Grep every implementation target** in real source — and explicitly exclude
   `node_modules`/electron-resources vendored copies (they produce false "it exists"
   matches).
3. **Get a piece-by-piece verdict table** (implemented? ❌/✅ with file:line evidence).
4. **Separate two failure modes:** *stale-because-done* (archive) vs
   *stale-because-framing* (refresh). Name which one applies.
5. **Check the precondition reality** — read the referenced sibling change / the actual
   version floor (`packages/server/package.json::piCompatibility`).
6. **Make surgical edits only** to the framing that drifted (proposal "Why",
   cross-references, tasks.md precondition), leaving valid work untouched.
7. **Validate:** `openspec validate <change>`.
8. **Stage only your files**, confirm nothing unrelated is caught, commit with a
   precise message.

## 3. How the collaboration unfolded

**Phase 1 — Discovery / verification (the bulk of the value).** From the single
"maybe obsolete" prompt, the AI did not guess. It ran a battery of `grep -rn` over the
six targets (`geminiCliHandler`/`antigravityHandler`, `deriveEffectiveAssistantText`,
`thinking_level_select`, `supportedThinkingLevels`, `stop_after_turn`,
`truncateLines(text, 30)`) and — crucially — recognised that the only matches were in
vendored `node_modules`/electron pi code, not dashboard source. That distinction is
what kept it from a wrong "already done" verdict.

**Phase 2 — Precondition reality check.** It then inspected the referenced sibling
change (`modernize-pi-version-handling`) and the actual compatibility floor, finding
the floor already at 0.78.0 — meaning the proposal's premise was *over-satisfied*, not
unmet.

**Phase 3 — Verdict.** The AI produced a table: all six pieces still un-done; the
proposal is **not obsolete**, but its framing (a version-guard precondition that no
longer exists) is stale. Decision point: refresh, don't archive.

**Phase 4 — Surgical edit + commit.** On the "fix proposal" steer, it made exactly
three edits (proposal "Why", proposal "Cross-references", tasks.md R.2), ran
`openspec validate`, then on "commit" staged **only** the two changed files, verified
nothing unrelated was swept in, and committed `c951b7f8`.

## 4. Prompts that worked

- **The goal prompt — "Maybe this proposal obsolate."** Terse, but effective *because
  the AI treated it as a hypothesis to test against source, not a fact to act on.* A
  stronger version a future operator should use: **"Verify whether
  `<change>` is obsolete — check each task against current source (exclude
  node_modules), then tell me: archive, refresh-framing, or keep as-is."**
- **"fix proposal"** — a high-leverage two-word unlock: it worked only because the
  prior turn had already produced a precise change-list, so "fix" had an unambiguous
  referent. Do the diagnosis first; then a one-word go is safe.
- **"commit"** — same pattern: safe because the AI had already scoped the staging to
  its own files.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Treat a vague "maybe obsolete" as needing action | Nothing — the AI self-corrected to verify-first | State it explicitly: "verify against source before deciding" |
| Risk trusting `grep` hits from vendored `node_modules` | Not needed — the AI flagged them itself | Always add "exclude node_modules/electron-resources" to source-existence greps |
| Could have rewritten more than needed | "fix proposal" (after a scoped change-list existed) | Demand a change-list *before* any edit, then edit only those lines |
| Could have committed unrelated working-tree changes | "commit" — AI pre-scoped `git add` to its own paths | Always `git add <specific paths>`, then `git status --short` to confirm scope |

The through-line: this session needed *little* steering because the AI front-loaded
verification and scoping. The guardrails worth internalising are the ones the AI
applied unprompted — make them explicit so a weaker model repeats them.

## 6. Skills, tools & memory created — and why they're effective

No skill or memory was created this session. The workflow is, however, clearly
repeatable and would benefit from one:

- **Recommended skill: "revalidate-openspec-proposal"** — given a change name,
  grep every implementation target against real source (excluding vendored copies),
  emit a piece-by-piece verdict table, classify the change as
  *done→archive* / *framing-stale→refresh* / *keep*, and (on refresh) constrain edits
  to the drifted framing only. It removes the manual, error-prone step of
  distinguishing real source from `node_modules` matches and enforces
  surgical-scope discipline before any edit.

## 7. Pitfalls & dead ends

- **False positives from vendored pi code.** `grep -rn` across the repo surfaces the
  bundled pi runtime in `node_modules`/electron resources. If you hit an
  "it already exists" match, confirm the *path* is dashboard source before concluding
  the work is done.
- **Precondition drift.** A proposal can reference a sibling change or version floor
  that has since moved. Before archiving-as-obsolete, read the *current*
  `piCompatibility` floor — the premise may be over-satisfied (work still valid) rather
  than met (work done).
- **Scope leak at commit time.** With unrelated working-tree changes present, a blanket
  `git add -A` would sweep them in. Stage explicit paths and verify with
  `git status --short` before committing.

## 8. Reproduce it faster — checklist

- [ ] Name the change and list its implementation targets (symbols / file:line anchors).
- [ ] `grep -rn "<symbol>" packages/*/src` for each — **exclude** `node_modules`/electron.
- [ ] Build a verdict table: each piece implemented? with evidence.
- [ ] Read the actual precondition (sibling change status, `piCompatibility` floor).
- [ ] Classify: archive / refresh-framing / keep.
- [ ] If refresh: edit ONLY the drifted framing (proposal Why, cross-refs, tasks precondition).
- [ ] `openspec validate <change>`.
- [ ] `git add <specific paths>` → `git status --short` → commit with a scoped message.

**Key inputs:** the OpenSpec change dir (`openspec/changes/<name>/`), read access to
`packages/server/package.json`, `openspec` CLI, git.
**Artifacts produced:** refreshed `proposal.md` + `tasks.md`, commit `c951b7f8`.

---

_Generated from session `019f152d` · `/Users/robson/Project/pi-agent-dashboard` · 2026-06-29. Source extract: facts sheet (mktemp)._
