---
name: session-to-guideline
description: >
  Turn a pi session into a Markdown "how-we-did-it" collaboration guideline. Reads a
  session's JSONL transcript, extracts the user's goal, every steering/correction turn,
  the tools/files/searches used, and any skills or memories created — then synthesizes a
  reusable playbook explaining how the task was performed WITH the AI: which prompts
  worked, what had to be steered, which skills were created and why they're effective,
  and how to reproduce the result faster.
  Use when: "document this session", "write up how we did X with the AI", "make a
  guideline from this session", "turn this session into a playbook/tutorial",
  "summarize what we built and how I steered it".
---

# Session → Collaboration Guideline

Produces a Markdown document that reads like a **playbook for collaborating with the AI**
on a task — not a raw transcript. It separates the *goal* from the *steering*, surfaces
the skills/memories created and why they work, and ends with a reproduce-it checklist.

Two layers:

1. **Deterministic extract** (`scripts/extract_session.ts`) — parses the session JSONL on
   the active branch and emits a structured **facts sheet** (prompts in order, tool usage,
   files written/edited, searches, skills/memories created, failed commands, cost). This is
   raw material, not the deliverable. TypeScript, run with `npx tsx` (repo convention).
2. **Synthesis** — read the facts sheet and write the guideline using
   `references/guideline-template.md`. The *why it's effective* and *what to steer* parts
   require judgment. Run it inline for a single session, or delegate to the
   **`SessionGuideline` subagent** for batch / past-session application (see below) — the
   synthesis is self-contained (facts sheet in, one guideline out), so it isolates cleanly.

## Where sessions live

`~/.pi/agent/sessions/--<cwd-with-slashes-as-dashes>--/<timestamp>_<uuid>.jsonl`
(JSONL tree; see the pi `session-format` docs). The scripts locate files for you.

**Worktrees are included by default.** A project's OpenSpec work runs in `.worktrees/<name>`
sub-checkouts, which get their own encoded session dir (`--<project>-.worktrees-<name>--`).
Both scripts resolve a `--cwd` to the project root + every `.worktrees/*` worktree, so
project-scoped listing/`latest` covers worktree sessions too (rows tagged `[wt:<name>]`).
Pass `--no-worktrees` for the old root-only behavior. Running from *inside* a worktree still
lists the whole project (the root is recovered by stripping `/.worktrees/<name>`).

## Procedure

1. **Pick the session.** If the user didn't name one, list candidates:
   ```bash
   npx tsx scripts/list_sessions.ts --cwd "$(pwd)" --limit 20      # this project + its worktrees
   npx tsx scripts/list_sessions.ts --cwd "$(pwd)" --no-worktrees  # project root only
   npx tsx scripts/list_sessions.ts --all --limit 30               # every project
   ```
   Worktree rows are tagged `[wt:<name>]` so you can tell root work from worktree work.
   (`tsx` runs the `.ts` directly, no build step.)
   Show the table and confirm which one (by 8-char id or # index). The *current* live
   session is usually #0/`latest`; documenting a finished prior session gives a complete
   picture (the live one won't include the not-yet-written tail).

2. **Extract the facts sheet** (cheap, deterministic). Use a UNIQUE output path per run —
   the fixed `/tmp/session_facts.md` is **NOT parallel-safe**: concurrent runs (e.g. a batch
   of `SessionGuideline` spawns) clobber the same file and every reader gets the last
   writer's sheet. Always `mktemp`:
   ```bash
   FACTS=$(mktemp /tmp/session_facts.XXXXXX.md)
   npx tsx scripts/extract_session.ts <selector> --cwd "$(pwd)" --out-md "$FACTS"
   ```
   - `<selector>` may be an 8-char id, a full path, or `latest` (use `--index N` for the
     Nth most recent). In BATCH runs prefer the **explicit JSONL path** — the extract's
     parent-chain walk can drift to a parent file on forked sessions.
   - Use `--max-text` / `--max-cmd` to widen truncation if you need more prompt/command text.

3. **Read the facts sheet** (`$FACTS`). Pay attention to:
   - **Prompt 1 = the goal**; **prompts 2..N = steering** (corrections, scope additions,
     quality bars, yes/all-three style unlocks).
   - **Skills created / Memories saved** — these are the reusable assets; explain *why*.
   - **Tool errors / failed commands** — these become the *Pitfalls* section.
   - **Artifacts** — the files the operator ends up with.

4. **Synthesize the guideline** following `references/guideline-template.md`. Fill every
   section. Rules:
   - Write for a *future operator with the same goal* — instructive, not a log.
   - Turn each steering turn into a **guardrail** ("the AI tended to X → state Y up front").
   - For each skill/memory created, state the reusable problem it solves and when to invoke it.
   - Rewrite weak prompts into the stronger version the reader should use.
   - Quote sparingly; summarize tool activity into phases.

5. **Write the deliverable** into the **weekly** folder. The bucket is the
   `ISO week bucket` line from the facts sheet Metadata (`YYYY/Www`, ISO-8601 week of the
   session start). Default location, unless the user says otherwise:
   ```
   <cwd>/Prompt stories/<YYYY>/W<WW>/<Topic>.md   # e.g. Prompt stories/2026/W30/Hermes memory pressure.md
   ```
   `mkdir -p` the week folder first. (Do NOT write it inside a skill folder.) Name the file
   after the session name/topic. **Begin the file with the YAML frontmatter block** (see
   `references/guideline-template.md`), filled from the facts sheet:
   ```yaml
   ---
   session: <8-char id>
   week: <YYYY/Www>
   type: <development|planning|research|documentation|other>   # copy "Session type" verbatim
   model: "@fast"           # ALWAYS quote — an @-prefixed role is INVALID YAML unquoted
   premium: <true|false>          # copy the "Premium candidate" flag verbatim
   premium_reason: "<reasons from the flag, or empty>"
   upgrade_status: <pending|done|n/a>
   # --- the next two ONLY when the facts sheet has an "OpenSpec changes" line ---
   openspec_changes: [<change-name>, ...]
   proposal_excerpt: "<the facts sheet 'Proposal excerpt' line, or omit if none>"
   ---
   ```
   - **`model`** MUST be quoted (`"@fast"`, `"@research"`): a YAML plain scalar cannot start
     with `@` (reserved indicator) — unquoted `model: @fast` makes the whole frontmatter
     invalid. It is the model that generated THIS story. A subagent **cannot observe its own
     runtime model**, so when spawning `SessionGuideline` the parent MUST state it in the
     prompt (e.g. `generated-by: @fast`) and the subagent writes that verbatim. Getting this
     wrong mis-routes the upgrade queue (a budget story stamped `@research` never gets
     re-run). Inline (non-subagent) runs: use the model you are actually running as.
   - **`type`** is classified deterministically by the extractor (`Session type` line:
     code files → development, proposal/design/spec files → planning, research docs / many
     searches + no code → research, docs → documentation, else other). Copy it; only override
     if the narrative *clearly* contradicts the signal.
   - **`openspec_changes` / `proposal_excerpt`** appear **only when a proposal is attached**
     to the session (the extractor found `openspec/changes/<name>/` in the session's
     files/commands and prints an `OpenSpec changes` line). Omit both fields entirely when
     that line is absent — do not invent a proposal link.
   When the write-up references images (storyboards, screenshots), link them relative to the
   story file — from a week folder that is `../../Projektek/<Project>/.../shot_01.png` — and
   verify each resolves. Tell the user the path.

6. **Mark premium stories for later Opus upgrade.** Premium is decided **deterministically**
   by the extractor — the facts sheet's `Premium candidate` flag is `yes` when the session
   created a skill/memory, OR had ≥5 user prompts, OR produced a facts sheet ≥ ~10K tokens.
   You do NOT judge it; you transcribe it. Set `upgrade_status`:
   - `pending` — `premium: true` AND a **budget** model wrote this story (`@fast`/`@compact`);
     it is a candidate for an Opus re-run.
   - `done` — `@research`/Opus wrote it (already premium quality).
   - `n/a` — `premium: false`.

   When `upgrade_status: pending`, append one row to the queue index
   `<cwd>/Prompt stories/_premium-queue.md` (create with the header if missing):
   ```
   | week | story | model | reason | status |
   |------|-------|-------|--------|--------|
   | 2026/W30 | 2026/W30/<Topic>.md | @fast | heavy steering (7 prompts) | pending |
   ```
   A later upgrade pass re-runs each `pending` story on `@research`/Opus, overwrites the
   file, and flips both its `upgrade_status` and the queue row to `done`.

## Batch / past-session application (via the `SessionGuideline` subagent)

The synthesis is self-contained — facts sheet in, one guideline out, no coherence with any
ongoing work — so it is a clean subagent job. For a SINGLE interactive session, running it
inline (above) is fine. For applying to MANY past sessions, delegate each to the
**`SessionGuideline`** subagent so the facts sheet and the reasoning stay out of the main
context and sessions don't accumulate there:

1. List the target sessions once:
   ```bash
   npx tsx scripts/list_sessions.ts --cwd "$(pwd)" --limit 50    # or --all
   ```
2. For each session, spawn `SessionGuideline` (explicit `Agent` call), passing the
   **explicit JSONL path** (not a partial id — the extract's parent-chain walk can drift to
   a parent file on forked sessions) + an explicit output path. Each spawn runs BOTH layers
   in isolation (extract → synthesise) and returns only the written path + a short abstract:
   ```
   Agent(subagent_type="SessionGuideline", model="@fast",
         prompt="session JSONL <abs-path>; cwd <dir>; generated-by: @fast; write to the weekly
                 folder Prompt stories/<YYYY>/W<WW>/<Topic>.md (bucket from the facts sheet's
                 ISO week line); add frontmatter; if premium+budget-model, queue it")
   ```
   **Pass the model twice:** the `Agent(model=…)` param sets the runtime model, and
   `generated-by: <same model>` in the prompt tells the subagent what to write into
   `model:` (it cannot introspect its own model). Keep them identical.
   ```
   ```
   For **bulk backfill on `@fast`**, each spawn writes into its week folder and self-marks
   premium candidates (`upgrade_status: pending`) into `_premium-queue.md` — a later Opus
   pass drains that queue. See steps 5–6.
3. Collect the returned paths. Parallel batches are safe ONLY because step 2 uses a
   `mktemp` facts sheet per run — the old fixed `/tmp/session_facts.md` raced (concurrent
   spawns overwrote it, so every playbook got the same sheet). Verify no two outputs share
   an H1 title before trusting a batch.

**Model role.** The synthesis is judgment-heavy WRITING on a SMALL, pre-condensed input
(the extract script shrinks the JSONL first — it is NOT a long-context job). Quality lives
in the insight sections (goal-vs-steering, steering→guardrails, why-skills-effective),
where a weak model produces generic slop. Use **`@research`** (the subagent's default) for
quality. For bulk backfill where cost dominates, **`@compact`** is the budget fallback
(mechanical sections stay fine; insight degrades) — pass `model` on the `Agent` call to
override per run.

## Selector cheatsheet

| Goal | Command |
|------|---------|
| Latest session in this project (+ worktrees) | `npx tsx scripts/extract_session.ts latest --cwd "$(pwd)"` |
| Latest, project root only (no worktrees) | `npx tsx scripts/extract_session.ts latest --cwd "$(pwd)" --no-worktrees` |
| 2nd-most-recent | `npx tsx scripts/extract_session.ts latest --cwd "$(pwd)" --index 1` |
| A specific session by id | `npx tsx scripts/extract_session.ts 019ea8a9` |
| A session in another project | `npx tsx scripts/extract_session.ts latest --cwd /path/to/other` |
| An explicit file | `npx tsx scripts/extract_session.ts /abs/path/to/session.jsonl` |

## Notes & pitfalls

- The extractor walks the **active branch only** (leaf → root via `parentId`), so abandoned
  `/tree` branches are excluded — you document what actually happened.
- Tool names are normalized (`mcp__pi__web_search` → `web_search`); `skill` and `memory`
  calls are captured with their action/scope/target so "skills created & why effective" is
  easy to write.
- The `Tokens total` includes cache reads, so it can dwarf the in/out numbers — report cost,
  not raw total, if it looks confusing.
- No third-party deps; TypeScript on Node built-ins (`fs`/`path`/`os`). Run with `npx tsx`
  — no compile/build step. Scripts never write to the session store.
- If a session is huge, raise `--max-cmds` only when you actually need more commands; the
  default keeps the facts sheet token-cheap.
