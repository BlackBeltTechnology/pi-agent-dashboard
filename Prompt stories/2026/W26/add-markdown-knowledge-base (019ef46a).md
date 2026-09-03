---
session: 019ef46a
week: 2026/W26
type: planning
model: "@fast"
premium: true
premium_reason: "created 0 skill(s) / 2 memory(ies); heavy steering (9 user prompts)"
upgrade_status: pending
openspec_changes: [add-markdown-knowledge-base]
proposal_excerpt: "Agents working in this repo (and any markdown-heavy project) repeatedly need to look up facts that are already written down — architecture decisions, API patterns, prior fixes, conventions — but have no fast, local, s…"
---

# How we did it: refine & commit the `add-markdown-knowledge-base` OpenSpec proposal — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened with a deceptively small question — `"What is current proposal?"` — but
the real objective emerged through nine steering turns: **understand, refine, and commit the
`add-markdown-knowledge-base` OpenSpec proposal.** The operator wanted to (a) get oriented in
a repo with 60+ active proposals, (b) interrogate specific design decisions (why the dashboard
server plugin was deferred, how setup/init works), (c) fold in two new capabilities — a
`kb-setup` skill and a `kb dox lint` operation adapted from Karpathy's Memex gist — (d) fix a
wrong npm scope, and finally (e) commit only the KB work cleanly onto a real branch, despite a
detached-HEAD session and a git index that kept resetting itself.

## 2. TL;DR playbook

1. **Find the "current" proposal deterministically** — don't guess; sort `openspec/changes/*/`
   by newest file mtime (`stat -f '%m %N'`), then read the winner's `proposal.md`.
2. **Interrogate design decisions against their source** — for "why is X deferred?", grep the
   `proposal.md` Non-goals + `research.md`/`design.md` sections and quote the actual rationale
   rather than improvising.
3. **When adding a capability, ask a tight `ask_user` batch first** (delivery location? new CLI
   command? wrap in a skill?), then fold the answer into **all four artifacts atomically**:
   `spec.md` (canonical) → `proposal.md` → `design.md` → `tasks.md`.
4. **Validate after every fold**: `openspec validate <change>` (or `npx openspec validate`).
5. **Fix naming/scope drift with `sed`** when the replacement is unambiguous, then re-grep to
   confirm *legitimate* upstream refs (`@earendil-works/pi-coding-agent`) were left untouched.
6. **Before committing on a dashboard-spawned session, check `git branch --show-current`** — a
   detached HEAD means create a branch first (`git checkout -b …`) or the commit is unreachable.
7. **Stage + commit atomically in ONE shell call** (`git checkout -b … && git add <paths> && git commit`)
   — a concurrent process resets the index between separate Bash calls.
8. **Scope the commit tightly**: add only the paths the operator named; leave unrelated churn
   (`groups.json`, `.gitignore`, a second proposal) uncommitted.

## 3. How the collaboration unfolded

**Phase 1 · Discovery (prompts 1–2).** The AI's first instinct on "what is current proposal?"
was to pick the most-recently-touched dir (`convert-docs-to-inplace-agents`) by mtime — a good
deterministic heuristic, but *wrong*: the operator meant `add-markdown-knowledge-base`. One
steering turn corrected the target. **Lesson:** "current" is ambiguous in a 60-proposal repo;
mtime is a guess, the human owns the ground truth.

**Phase 2 · Interrogation (prompts 3–4).** Two "why/how" questions ("why is the server plugin
deferred?", "when/how does the plugin set up the KB?"). The AI answered well because it grounded
each reply in the actual artifact text — quoting `proposal.md:202–205` Non-goals and research
§5.2/§5.3 — rather than reasoning from memory. It correctly drew the key distinction: **this
change has no dashboard UI at all; setup is file-based config + CLI + lazy on-demand indexing.**

**Phase 3 · Fold-in #1: the setup skill (prompts 5, 8).** The operator asked whether a shipped
skill could help init/configure a directory. The AI grounded delivery in the existing precedent
(`packages/extension/package.json` ships skills via paired `pi.skills` + `files` lists), used an
`ask_user` batch to pin down the shape, then added a `kb-setup` skill + a new `kb init` CLI
command across all four artifacts and validated.

**Phase 4 · Scope correction (prompt 6).** The operator flagged the npm scope was wrong. The AI
verified against every existing package (all use `@blackbelt-technology`), fixed 7 occurrences
with `sed`, and re-grepped to confirm the legit upstream `@earendil-works/pi-coding-agent` refs
survived. It tried to save the convention to memory — **blocked, store at capacity.**

**Phase 5 · Fold-in #2: `kb dox lint` (prompts 7–8).** The operator asked to adapt Karpathy's
Memex gist. The AI *fetched it first* before judging fit, mapped its Ingest/Query/Lint operations
against the existing design, and folded only the genuinely-additive piece — a deterministic
`kb dox lint` health-check — into all four artifacts, keeping the "detect, don't LLM-rewrite"
boundary explicit.

**Phase 6 · Commit (prompt 9).** "commit changes" surfaced two blockers: a **detached HEAD**
(commit would be unreachable) and a **self-resetting git index**. The AI diagnosed both, created
`os/add-markdown-knowledge-base`, and landed a tightly-scoped 24-file commit atomically.

## 4. Prompts that worked

- **Goal prompt — `"What is current proposal?"`** — weak on its own (ambiguous), but fine as an
  orientation opener. **Stronger version:** *"Which proposal is `add-markdown-knowledge-base`, and
  what's its current state?"* — names the target, skips the guess.
- **`"Why dashboard server plugin deferred?"`** — high-leverage: a precise "why is X the way it is"
  that forces the AI to quote the artifact's own rationale. Reproduce this pattern for any design
  decision you want to trust.
- **`"Is it possible to add a pi skill … which helps to init, setup correctly …?"`** — an
  open capability question that the AI turned into a grounded, precedent-backed proposal + an
  `ask_user` batch. Effective because it invites the AI to check feasibility against the repo.
- **`"yes"` (prompt 8)** — a one-word unlock that confirmed the `ask_user` batch and let the AI
  fold all three sub-decisions (delivery / CLI / skill) in one pass. High leverage precisely
  because the AI had already laid out the exact shape to approve.
- **`"The group name is not earendil-works instead of same as pi-dashboard"`** — a surgical
  correction that caught a scope error before it shipped.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Pick "current proposal" by file mtime → wrong target | "Current proposal be add-markdown-knowledge-base" | Name the exact change up front; treat mtime as a hint, not truth |
| Use the wrong npm scope (`@earendil-works`) for the new package | "The group name is not earendil-works … same as pi-dashboard" | State the repo scope rule (`@blackbelt-technology`) before scaffolding any package |
| Consider adopting a whole external pattern wholesale | Ask specifically "adapt … maybe dox part" | Scope the borrow — ask which *piece* of a reference fits, not "adopt it" |
| (Would) commit on detached HEAD / with a racing index | "commit changes" (AI self-caught) | Check `git branch --show-current` first; stage+commit atomically |

Quality bars the operator imposed implicitly: fold changes into **all four** OpenSpec artifacts
(spec is canonical), **validate after each fold**, and keep commits **tightly scoped** to the
named work only.

## 6. Skills, tools & memory created — and why they're effective

No skills were created, but **two memories were attempted** (both hit a full store):

1. **Project convention (`add` → project):** *npm scope for ALL pi-agent-dashboard packages =
   `@blackbelt-technology`; do NOT use `@earendil-works` for repo packages* (that scope is the
   upstream `pi-coding-agent` package only). **Why effective:** this exact drift cost a
   correction turn this session — persisting it prevents the AI from mis-scoping the next new
   package.
2. **Tool-quirk / failure (`add` → failure):** *dashboard-spawned sessions often run on a
   DETACHED HEAD; the git index gets reset between separate Bash calls (a concurrent process
   unstages). Fix: run `git add` + `git commit` atomically in one shell invocation.* **Why
   effective:** turns a 30-minute live diagnosis into a one-line precaution.

**Recommended skill to create:** a `commit-on-dashboard-session` micro-skill encoding the
detached-HEAD check + atomic add/commit, since it's a repeatable trap for any session spawned by
the dashboard. **Note:** both memory writes silently failed — the store was at capacity
(4912/5000 chars). If persistence matters, prune the memory store first (see the
`consolidate-pi-memory-store` skill).

## 7. Pitfalls & dead ends

- **Detached HEAD commit would be lost.** If `git branch --show-current` is empty, the session
  is on a detached HEAD (common for dashboard-spawned sessions). **Do:** `git checkout -b <name>`
  before committing, or the commit is unreachable and garbage-collectable.
- **The git index resets between Bash calls.** A concurrent process (the dashboard managing the
  session) unstages your `git add`. **Do:** run `git add <paths> && git commit …` in a **single**
  shell invocation so nothing can reset in between. The first non-atomic attempt showed
  `git diff --cached` empty and `git log -1` unchanged.
- **`skipMatchValidation` slipped into an edit twice** and had to be removed — a disallowed field
  that the AI reflexively re-added. Watch edit payloads for it.
- **Memory writes fail silently at capacity.** Two useful memories were lost because the store
  was full. Check capacity, or prune, before relying on a memory write.
- **Don't over-adopt external patterns.** Karpathy's gist has Ingest/Query/Lint; only **Lint**
  was genuinely additive here (the rest was already designed). Map, then borrow the delta.

## 8. Reproduce it faster — checklist

- [ ] Name the exact proposal you mean (`add-markdown-knowledge-base`) — skip mtime guessing.
- [ ] State the repo package scope (`@blackbelt-technology/pi-dashboard-*`) before scaffolding.
- [ ] For each capability fold: `ask_user` batch → edit `spec.md` → `proposal.md` → `design.md`
      → `tasks.md` → `openspec validate <change>`.
- [ ] For any borrowed external pattern: fetch it, map operations against the existing design,
      fold only the delta.
- [ ] Before committing: `git branch --show-current`; if empty, `git checkout -b <branch>`.
- [ ] Commit atomically: `git checkout -b … && git add <named-paths> && git commit -F -`.
- [ ] Keep scope tight — leave unrelated churn (`groups.json`, `.gitignore`, other proposals) out.

**Inputs needed:** the OpenSpec change dir, the reference gist URL (if adapting), `openspec`
CLI. **Final artifacts:** branch `os/add-markdown-knowledge-base`, commit `80d3e841`
(24 files, +3970 lines) — the KB proposal (proposal/design/research/tasks/spec/prototype) +
`packages/kb` Phase-1 scaffold.

---

_Generated from session `019ef46a-924d-788d-8688-423376e15754` · `/Users/robson/Project/pi-agent-dashboard` · 2026-06-23. Source extract: deterministic facts sheet._
