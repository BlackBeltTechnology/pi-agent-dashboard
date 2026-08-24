---
session: 3f9ccca8
week: 2026/W14
type: other
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [specs-browser-and-search]
proposal_excerpt: "OpenSpec has 107+ main specs in `openspec/specs/` but no way to browse them from the dashboard. Bulk Archive lives in the folder header where it's less discoverable — it makes more sense on session cards where users i…"
---

# How we did it: Verify + archive the `specs-browser-and-search` change — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator had a finished OpenSpec change (`specs-browser-and-search`: a fuzzy
markdown search box, a specs browser view, and a Bulk-Archive relocation from the
folder header onto session cards) and wanted to **close it out cleanly**. The first
prompt was a single slash-command:

```
/opsx:verify specs-browser-and-search
```

The real objective, once the second turn landed, was the full landing ritual:
**verify that the implementation actually matches the four delta specs and all tasks,
then archive the change and sync its delta specs into the main `openspec/specs/`
tree.** Two commands, one outcome: a green verification report followed by an archived,
spec-synced change.

## 2. TL;DR playbook

1. Run `/opsx:verify <change>` — let the AI load every artifact (proposal, tasks,
   delta specs) and cross-check them against the code.
2. Let it confirm the three dimensions: **Completeness** (all tasks + all specs
   covered), **Correctness** (each requirement is really implemented), **Coherence**
   (follows existing project patterns).
3. Have it prove completeness with evidence, not claims: `grep` the test files, run
   `npx vitest run --reporter=verbose` on the change's test files, and `npx tsc --noEmit`
   filtered to the changed files.
4. Read the verification report. If green, proceed.
5. Run `/opsx:archive <change>` — the AI re-checks tasks/artifacts are `done`, then
   diffs each delta spec against its main-spec counterpart.
6. Let it classify every delta as **NEW** (no main spec yet) vs **DIFFERS** (append /
   modify an existing spec), then apply each one correctly (copy new specs, surgically
   edit changed ones).
7. Confirm the `mv` into `openspec/changes/archive/<date>-<change>/` and read the final
   archive summary.

## 3. How the collaboration unfolded

**Phase 1 — Verify (load → check → prove).** On `/opsx:verify`, the AI listed the
change dir, pulled `openspec status --json` and the apply instructions, then read every
delta `spec.md` and the matching implementation files (`MarkdownSearch.tsx`,
`SpecsBrowserView.tsx`, `useMainSpecsReader.ts`, `FolderOpenSpecSection.tsx`,
`SessionOpenSpecActions.tsx`, `App.tsx`). *Why it worked:* it treated "verify" as
evidence-gathering, not vibe-checking — it grepped for `fuse.js` in `package.json`,
grepped for the `onBulkArchive`/`onOpenSpecs` wiring across components, ran the 5 test
files (65 tests green), and ran a type-check filtered to just the change's files so the
47 pre-existing unrelated errors didn't create noise. It then emitted a structured
report (Completeness 20/20, Correctness, Coherence) per milestone.

**Phase 2 — Archive (re-check → classify → sync → move).** On `/opsx:archive`, the AI
re-confirmed all artifacts and 20/20 tasks were `done`, then diffed each delta against
`openspec/specs/<name>/spec.md`. The decision point it navigated well: two deltas were
**NEW** (`markdown-fuzzy-search`, `specs-browser` — no main spec) and two **DIFFERED**
(`openspec-attach-combo` needed the Bulk-Archive requirement *appended*;
`openspec-folder-section` needed the header requirement *modified*, the folder-level
Bulk-Archive *removed*, and a Specs-button requirement *added*). It copied the new
specs wholesale and made surgical edits to the two that differed, then `mv`d the change
into `openspec/changes/archive/2026-04-04-specs-browser-and-search/`.

## 4. Prompts that worked

- **The goal prompt — `/opsx:verify specs-browser-and-search`.** Effective because the
  slash-command carries the whole verification protocol; naming the change explicitly
  (not "the last one") removed ambiguity and let the AI go straight to loading artifacts.
- **High-leverage follow-up — `/opsx:archive specs-browser-and-search`.** One short
  command that triggered the re-check → diff → sync → move pipeline. The operator didn't
  micro-manage the spec-sync classification; the command + a clean verify were enough.

Both prompts share the winning shape: **invoke the workflow skill by name and pass the
exact change slug.** A weaker version — "can you check my change is done and file it
away" — would have forced the AI to guess which change and which ritual. Prefer the
slash-command + slug.

## 5. Steering & corrections (what to watch for)

This was a near-zero-steering session — the two slash-commands did the work — but the
guardrails that kept it clean are worth baking in:

| The AI tended to… | The human relied on… | Bake this in next time by… |
|-------------------|----------------------|----------------------------|
| Trust the task checkboxes ("20/20 done") as proof | The verify protocol forcing real evidence | Always run the tests + `tsc` before believing tasks.md |
| Flag pre-existing unrelated type errors as noise | Filtering `tsc` output to the changed files | Grep `tsc --noEmit` to the change's file names only |
| Treat every delta spec the same | The archive step diffing NEW vs DIFFERS | Diff each delta against its main spec before syncing |

The key discipline: **verify with evidence, archive with a diff.** Don't let a green
tasks.md substitute for a test run, and don't blind-copy delta specs over existing main
specs — classify each as new-vs-modified first.

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created this session — and that's the point. The work
was fully carried by two existing OpenSpec workflow skills:

- **`openspec-verify-change` (`/opsx:verify`)** — captures the "prove it's really done"
  ritual: load artifacts, cross-check against code, run tests + type-check, emit a
  three-dimension report. Invoke it whenever a change's tasks are all checked but before
  you archive — it's the gate that catches checkbox-lies.
- **`openspec-archive-change` (`/opsx:archive`)** — captures the safe-landing ritual:
  re-confirm done-ness, diff/classify delta specs, sync them into `openspec/specs/`, and
  `mv` the change into the dated archive dir. Invoke it as the final step of a change,
  and only after verify is green.

If you find yourself hand-running `openspec status`, hand-diffing specs, and hand-`mv`ing
the archive folder, stop — those two skills already encode the whole flow.

## 7. Pitfalls & dead ends

- **Zero failed commands this run**, but the near-misses are instructive.
- *Pre-existing type errors masquerading as regressions:* `tsc --noEmit` surfaced 47
  errors in unrelated files. If you hit this, re-run with a `grep` filtered to your
  change's filenames — don't let the global count block the archive.
- *Delta-spec sync as blind copy:* two of the four deltas modify existing main specs
  rather than adding new ones. If you `cp` all four over the main tree you'll clobber
  unrelated requirements. Diff each delta first; only `cp` the NEW ones, surgically edit
  the DIFFERS ones.
- *Archiving before verifying:* archive re-checks task done-ness, but it does **not**
  re-run tests. If you skip `/opsx:verify`, you can archive a change whose tests are red.
  Always verify first.

## 8. Reproduce it faster — checklist

Inputs to have ready:
- The change slug (here `specs-browser-and-search`) and a fully-implemented,
  all-tasks-checked change in `openspec/changes/<slug>/`.
- A working `npx vitest` + `npx tsc` toolchain in the repo.

Steps:
- [ ] `/opsx:verify <slug>` — load artifacts, cross-check code.
- [ ] Confirm test evidence: `npx vitest run --reporter=verbose <change test files>`.
- [ ] Confirm types: `npx tsc --noEmit` grepped to the change's filenames.
- [ ] Read the Completeness / Correctness / Coherence report; proceed only if green.
- [ ] `/opsx:archive <slug>` — re-check done-ness.
- [ ] Verify the delta-vs-main classification (NEW vs DIFFERS) before sync.
- [ ] Confirm the `mv` into `openspec/changes/archive/<date>-<slug>/`.

Final artifacts produced:
- `openspec/specs/markdown-fuzzy-search/spec.md`, `openspec/specs/specs-browser/spec.md` (new)
- edited `openspec/specs/openspec-attach-combo/spec.md`, `openspec/specs/openspec-folder-section/spec.md`
- archived change at `openspec/changes/archive/2026-04-04-specs-browser-and-search/`

---

_Generated from session `3f9ccca8` · `pi-agent-dashboard` · 2026-04-04. Source extract: session facts sheet (`specs-browser-and-search`)._
