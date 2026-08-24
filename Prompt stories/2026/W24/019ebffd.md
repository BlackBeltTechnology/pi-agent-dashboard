---
session: 019ebffd
week: 2026/W24
type: planning
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [linkify-any-text-extension, fix-url-routing-overlay, fix-editor-settings-persistence]
proposal_excerpt: "The tool-output/markdown linkifier (packages/client/src/lib/linkify-tool-output.ts) detects file references via a hardcoded extension allowlist (EXTS ~19 entries). This is both too narrow and buggy."
---

# How we did it: Linkify any text-based file extension — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened in **explore mode** (`openspec-explore`) with a stance, not a task:
*think, investigate, don't implement*. The concrete trigger was a bug — the dashboard's
file-link detector was mangling paths (dropping leading dots, turning `.json` into `.js`,
producing bogus absolute paths). Prompt 1 was the explore-mode preamble; the **real
objective** landed in the first steering turn: *"Currently the handled extensions are very
limited. I would like to extend it to every extension which is text based — anything that
can be opened in a text editor."* So the goal is: **replace the linkifier's hardcoded
~19-entry extension allowlist with a model that links any text file, and capture the
decision plus the underlying bug fixes as an OpenSpec change** — without writing the
implementation (explore mode forbids it).

## 2. TL;DR playbook

1. Enter `openspec-explore` mode so the AI investigates and drafts artifacts but does **not** implement.
2. Point it at the symptom (screenshot / broken paths) and ask it to **find the detector**: `grep -rln "tokenize\|linkify-tool-output" packages/client/src`.
3. Have it **characterize the bugs empirically** — run the live regex against real inputs (`.pi/settings.json`, `../../foo.ts`, `.eslintrc.json`) via `ctx_execute`, not by reading the regex.
4. Ask the reframe question: *"is the allowlist even the right model?"* — this shifts the work from *grow the list* to *what actually gates a match*.
5. Let it prove the real prose-guard is **path structure** (`/`, `./`, `../`, drive, `file://`), so the extension allowlist is redundant.
6. Pick a philosophy (generic `\.[A-Za-z][A-Za-z0-9]{0,15}`, keep the bare-filename rule, fix the 3 bugs) and tell it to **scaffold an OpenSpec change**.
7. Check the repo's delta-spec format first (`cat` a sibling change), then `openspec new change <name>`, write proposal/design/spec/tasks, `openspec validate --strict`.
8. Commit **only the change files**: `git add openspec/changes/<name> && git commit` — leave unrelated working-tree edits alone.

## 3. How the collaboration unfolded

**Phase 1 — Locate (grep).** The AI grep'd `packages/client/src` for the tokenizer and
confirmed the same `tokenize`/`COMBINED` regex in `linkify-tool-output.ts` powers both
tool-output AND assistant-markdown inline-code spans (via `MarkdownContent.tsx`) — which is
why the bug showed up in an assistant bubble screenshot. *Why it worked:* one grep tied the
symptom to the single source of truth before any theorizing.

**Phase 2 — Characterize empirically (ctx_execute).** Instead of reading the regex and
guessing, the AI **ran it** against a battery of real paths and printed the actual outputs
(`".pi/settings.json" → [pi/settings.js]` — dot dropped + json→js). This surfaced three
distinct root causes: enumerated-alternation prefix collision (json→js), leading-dot dirs
dropped, and `../../` producing a bogus absolute path. *Why it worked:* empirical
reproduction beats regex-staring; it produced a defensible bug list.

**Phase 3 — Reframe (the human's pivot).** The human's steering turn ("extend to every
text extension") made the AI question the allowlist itself. It then proved that a bare
filename (`package.json`) is *never* linked today — every branch already requires path
structure — so the allowlist is a **redundant second guard**. Conclusion: once path
structure is present, any extension is safe to accept. This is the insight the whole change
rests on.

**Phase 4 — Design & scaffold (OpenSpec).** The AI read a sibling change to learn the
repo's delta-spec format, ran `openspec new change linkify-any-text-extension` (after two
wrong invocations — see Pitfalls), then wrote proposal/design/spec/tasks encoding
"Philosophy B": generic extension group, keep the bare-filename rule, fix all three bugs.
`openspec validate --strict` passed clean.

**Phase 5 — Commit surgically.** On the final "commit changes" turn, the AI noticed
unrelated `AskUserToolRenderer` edits in the tree, **staged only its own 5 change files**,
committed `2b8bf86c`, and flagged the untouched files back to the user.

## 4. Prompts that worked

- **Goal prompt (explore mode):** starting in `openspec-explore` was the right kickoff — it
  kept the AI in *investigate + propose* mode and prevented a premature code edit. A future
  operator with a bug-to-proposal task should open the same way.
- **High-leverage follow-up:** *"the handled extensions are very limited… extend it to every
  extension which is text based."* One sentence flipped the framing from *enumerate more
  extensions* to *drop the allowlist model entirely* — the single most valuable steer in the
  session.
- **Closing prompt:** *"commit changes"* — short, and the AI correctly scoped the commit to
  its own files.
- **Stronger version to reuse:** pair the goal with the constraint up front — *"In explore
  mode: our linkifier uses a hardcoded extension allowlist and mangles some paths. Question
  whether the allowlist is the right model at all, prove the real prose-guard empirically,
  then capture the decision as an OpenSpec change — don't implement."*

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Frame the fix as *growing the allowlist* | "extend to **every** text-based extension" | State the model-level intent (drop the allowlist) in the goal prompt, not just the symptom |
| Stay in analysis / keep exploring | "commit changes" | Say up front "end by scaffolding + validating an OpenSpec change and committing only those files" |
| Risk touching unrelated tree edits | (implicitly) — AI self-caught the `AskUserToolRenderer` diff | Confirm surgical commit scope; `git add openspec/changes/<name>` explicitly, never `git add -A` |

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created — this was a scoped explore-to-proposal run. Reusable
assets that *were* leaned on:

- **`openspec-explore` skill** — kept the AI a thinking partner (read/search/scaffold, never
  implement). Invoke it whenever a bug needs a *decision + proposal*, not an immediate patch.
- **`Explore` subagent** ("Find file-link detection code") — isolated the codebase hunt so the
  main context stayed on the design reasoning.
- **`ctx_execute` for empirical regex characterization** — the highest-leverage move. If you
  repeat this often (proving a regex/parser's real behavior against a battery of inputs), it
  is worth a small skill: *"characterize a regex empirically before proposing a fix."*

## 7. Pitfalls & dead ends

- **`openspec change new <name>` fails** — the correct subcommand in this repo is
  `openspec new change <name>`. Two failed invocations burned before `openspec --help`
  revealed it. If `change new` errors, run `openspec new --help` and use `new change`.
- **Reading a delta-spec cold** — one `find`/`cat` on a sibling change (`fix-url-routing-overlay`,
  `fix-editor-settings-persistence`) errored/was noisy first; check the repo's actual
  delta-spec layout by `cat`-ing a *clean* existing change before scaffolding.
- **Regex-staring** — don't reason about the linkifier from the pattern text; run it. The
  json→js collision and dropped-dot bugs were only obvious from real output.
- **Broad `git add`** — unrelated `AskUserToolRenderer` edits sat in the tree; a `git add -A`
  would have swept them into the docs commit. Stage the change directory explicitly.

## 8. Reproduce it faster — checklist

- [ ] Open in `openspec-explore` mode (thinking, not implementing).
- [ ] `grep -rln "linkify-tool-output\|tokenize" packages/client/src` → confirm single source (also powers `MarkdownContent.tsx`).
- [ ] `ctx_execute` the live regex against `.pi/settings.json`, `.eslintrc.json`, `../../foo.ts` → capture actual (wrong) outputs.
- [ ] Reframe: prove bare filenames are never linked → path structure is the real gate → allowlist is redundant.
- [ ] `cat` a clean sibling `openspec/changes/*/spec.md` to learn the delta format.
- [ ] `openspec new change linkify-any-text-extension` (NOT `change new`).
- [ ] Write proposal / design / spec / tasks → `openspec validate <name> --strict`.
- [ ] `git add openspec/changes/linkify-any-text-extension && git commit` — only these files.
- **Inputs needed:** the failing screenshot / a battery of real path strings; `openspec` CLI.
- **Artifacts produced:** `openspec/changes/linkify-any-text-extension/{proposal,design,tasks}.md` + `specs/tool-output-linkification/spec.md`; commit `2b8bf86c`.

---

_Generated from session `019ebffd-0af8-79c2-b51b-e66ed617bb88` · `pi-agent-dashboard` · 2026-06-13. Source extract: facts sheet (mktemp)._
