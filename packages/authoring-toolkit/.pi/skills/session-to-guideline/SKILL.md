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
2. **Synthesis (you, the agent)** — read the facts sheet and write the guideline using
   `references/guideline-template.md`. The *why it's effective* and *what to steer* parts
   require judgment; that's your job.

## Where sessions live

`~/.pi/agent/sessions/--<cwd-with-slashes-as-dashes>--/<timestamp>_<uuid>.jsonl`
(JSONL tree; see the pi `session-format` docs). The scripts locate files for you.

## Procedure

1. **Pick the session.** If the user didn't name one, list candidates:
   ```bash
   npx tsx scripts/list_sessions.ts --cwd "$(pwd)" --limit 20      # this project
   npx tsx scripts/list_sessions.ts --all --limit 30               # every project
   ```
   (`tsx` runs the `.ts` directly, no build step.)
   Show the table and confirm which one (by 8-char id or # index). The *current* live
   session is usually #0/`latest`; documenting a finished prior session gives a complete
   picture (the live one won't include the not-yet-written tail).

2. **Extract the facts sheet** (cheap, deterministic):
   ```bash
   npx tsx scripts/extract_session.ts <id-or-'latest'> --cwd "$(pwd)" \
       --out-md /tmp/session_facts.md --out-json /tmp/session_facts.json
   ```
   - `<selector>` may be an 8-char id, a full path, or `latest` (use `--index N` for the
     Nth most recent).
   - Use `--max-text` / `--max-cmd` to widen truncation if you need more prompt/command text.

3. **Read the facts sheet** (`/tmp/session_facts.md`). Pay attention to:
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

5. **Write the deliverable.** Default location, unless the user says otherwise:
   ```
   <cwd>/Prompt stories/<Topic>.md
   ```
   (Do NOT write it inside a skill folder.) Name the file after the session name/topic.
   When the write-up references images (storyboards, screenshots), link them with paths
   relative to `Prompt stories/` (e.g. `../Projektek/<Project>/.../shot_01.png`) and verify
   each resolves. Tell the user the path.

## Selector cheatsheet

| Goal | Command |
|------|---------|
| Latest session in this project | `npx tsx scripts/extract_session.ts latest --cwd "$(pwd)"` |
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
