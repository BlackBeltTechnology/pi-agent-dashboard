---
session: da7d08cf
week: 2026/W14
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (29 user prompts); large facts sheet (~11442 tok)"
upgrade_status: pending
openspec_changes: [ui-tweaks-image-collapse-fix]
proposal_excerpt: "Headless (dashboard-spawned) pi sessions use RPC mode but their stdin/stdout are disconnected — `extension_ui_request` events from `ctx.ui.confirm()`, `ctx.ui.select()`, etc. go nowhere. Extensions that prompt for use…"
---

# How we did it: A batch of dashboard UI tweaks, shipped through OpenSpec — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator opened in explore mode with a loose grab-bag of UI complaints:

> ```
> /skill:openspec-explore
> There is a lot of things in UI I would like to tweak:
> 1. All message box can accept image as chat window.
> 2. The left session panel collapse icon is on the header. Put in the vertically center and right border of chat window
> 3. Somhow the pasted image link became broken in chat window after the insert.
> ```

The **real objective**, once the steering turns landed, was: turn a fuzzy pile of
client-UI annoyances into **one scoped OpenSpec change** (`ui-tweaks-image-collapse-fix`),
implement it TDD-style, and archive it with synced specs. The final scope covered six
fixes: image-data truncation bug, sidebar collapse-button relocation, default sidebar
width, folder pin-icon consolidation, selected-session-card visibility, and (added
mid-flight) mermaid diagram fonts. Item #1 (image paste in *every* input box) was
deferred — it needs a protocol change across extension/server/client.

## 2. TL;DR playbook

1. Kick off in `/skill:openspec-explore` with the raw list — let the AI read the
   client code and separate "one-line fix" from "needs a protocol change."
2. **Before writing any OpenSpec artifact, run `ls openspec/changes/`** to learn the
   real layout. Prefer `openspec change new <name>` over hand-writing files.
3. Iterate the proposal in place: paste screenshots of each broken state, say
   "Update proposal:" and let the AI fold each new symptom into the doc.
4. `/opsx:ff <name>` to fast-forward design + specs + tasks once the proposal settles.
5. `/opsx:apply <name>` and drive it with terse "go on" turns; the AI does TDD
   (red test → implement → green) per task.
6. When a fix is visually wrong, **paste a fresh screenshot every iteration** — do not
   trust "it should work now"; the loop needs the actual rendered pixels.
7. `/opsx:verify <name>` catches out-of-scope changes (mermaid, double-click removal)
   that were done during implementation but never tracked — backfill them into tasks.md.
8. `/opsx:archive <name>` to sync the 4 delta specs into main specs and archive.

## 3. How the collaboration unfolded

**Phase A — Discovery (explore mode).** The AI grepped `src/client/` for image/paste/
clipboard/collapse handling and traced the image flow through the event reducer and
`memory-event-store.ts`. It found the root cause of the broken-image bug fast:
`DEFAULT_MAX_STRING_SIZE = 4_000` in `truncateStrings()` chops base64 image data
(50KB–500KB) in `message_start` events. **Why it worked:** the AI read the data path
end-to-end before proposing, so the proposal named a concrete line, not a guess.

**Phase B — Proposal iteration.** The operator added items one at a time ("Update
proposal: …"), often with a screenshot. Each new symptom (broken "🖼 Attachment 1"
placeholders, barely-visible selected card, invisible collapse chevron) got folded into
proposal + design + specs + tasks together. **Decision point:** image-in-all-inputs was
explicitly deferred as out-of-scope (protocol change).

**Phase C — The OpenSpec path mistake.** The AI first wrote the proposal to
`openspec/changes/active/<name>/`, assuming `active/` was a status subdirectory. It
wasn't — changes live flat at `openspec/changes/<name>/`. The activity detector's regex
`/openspec\/changes\/([^/]+)\//` captured `active` as the change name, so the change
never attached. The operator drilled in with five "why" turns until the AI landed the
real lesson: **it assumed a directory convention instead of running `ls` first.** Fix:
moved the dir + added a guardrail to `AGENTS.md`.

**Phase D — Implementation (TDD).** `/opsx:apply` then "go on" ×4. Per task: write the
failing test, implement, confirm green. 32 tests across 3 files at the end. A couple of
tests hit a **pre-existing** `localStorage.clear is not a function` jsdom shim issue —
correctly identified as not-our-bug and left alone.

**Phase E — The mermaid font rabbit hole.** The longest stretch (~17:16→18:29). Mermaid
SVG text rendered monospace. The AI cycled through: `fontFamily` config → `themeVariables`
→ SVG cache clear → CSS `!important` override → and finally discovered the true culprit:
`MermaidBlock` renders inside ReactMarkdown's `<pre><code>`, and the existing
`.markdown-content pre * { font-family: inherit !important }` rule forced monospace on
the SVG. Then a **second** problem: bumping font size via CSS *after* mermaid sized the
boxes made clipping worse — the size must be set in mermaid's `init` config so it measures
box geometry with correct metrics. A concurrent session also touched the file mid-edit.

**Phase F — Verify & archive.** `/opsx:verify` flagged that mermaid + double-click removal
were done but untracked; the operator said "fix" and they were backfilled into tasks.md.
`/opsx:archive` synced 4 delta specs into main specs.

## 4. Prompts that worked

- **Goal prompt** — `/skill:openspec-explore` + the numbered list. Effective because
  explore mode reads code first and separates cheap fixes from protocol-level work
  *before* committing to a proposal.
- **"Update proposal: <new symptom>" + [image]** — the highest-leverage pattern in the
  session. A screenshot pins the AI to the actual rendered state and folds a new item
  into every artifact at once.
- **"go on"** — terse unlocks that let the AI march through TDD tasks without re-approval.
- **The "why" ladder** ("Why not attached? / why wrong place? / how prevent this?") —
  turned a one-off mistake into a durable `AGENTS.md` guardrail instead of a silent fix.

Rewrite of a weak prompt: instead of "not changed" / "Still monospace" (which forced the
AI to guess what you were looking at), say **"still monospace — here is the current
rendered SVG [image]; inspect the actual `font-family` on the text element."**

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Assume `openspec/changes/active/<name>/` was the right path | "I don't see proposal in openspec list" → 5 "why" turns | State up front: changes live flat at `openspec/changes/<name>/`; prefer `openspec change new`. Guardrail now in `AGENTS.md`. |
| Say "it should work now" on visual fixes | Paste a new screenshot every round ("not changed", "Still monospace") | Always re-verify UI with a fresh screenshot; never trust a claim without pixels. |
| Chase mermaid fonts via config/cache first | "The SVG files still have fixed fonts" / "Minimal font size change needed" | Inspect the real CSS cascade (`pre *` monospace `!important`) before touching config. |
| Fix font-size via CSS after render | "The clipping is worst" | Set font size in mermaid `init` config so box geometry is measured correctly — not post-hoc CSS. |
| Do bonus fixes without tracking them | `/opsx:verify` caught untracked mermaid + double-click changes → "fix" | Add every in-flight change to tasks.md as you make it, so verify stays clean. |

## 6. Skills, tools & memory created — and why they're effective

No skill or memory was saved this session — but two reusable assets came out of it:

- **`AGENTS.md` OpenSpec-path guardrail** (edited in): *"When creating OpenSpec changes,
  always use `openspec/changes/<name>/` (never nest under `active/`/`archive/`). Prefer
  `openspec change new`."* Effective because it turns a 15-minute detour (wrong path →
  detector attaches "active" → move dir → re-attach) into a rule every future agent reads
  first.
- **Recommended memory to save:** a `tool-quirk` note that mermaid SVG text inherits the
  `.markdown-content pre *` monospace `!important` rule, and that mermaid font *size* must
  be set in `init` config (not CSS) to avoid box clipping. This session spent >1h
  rediscovering it; a memory would collapse that to seconds.

## 7. Pitfalls & dead ends

- **`openspec/changes/active/` is not a status folder.** If a new change doesn't appear in
  `openspec list`, check you didn't nest it under `active/`. `ls openspec/changes/` first.
- **Mermaid monospace fonts.** The culprit is `.markdown-content pre * { font-family:
  inherit !important }`, not mermaid config. Override specifically for `.mermaid-diagram`
  and descendants.
- **Mermaid box clipping.** Setting font-size via CSS after render clips text. Set it in
  mermaid `init` so box geometry is computed with the right metrics.
- **Cached SVGs.** Mermaid caches rendered SVGs (keyed by code+theme); font changes need a
  cache clear + hard browser refresh (Cmd+Shift+R) to show.
- **`localStorage.clear is not a function`** in `useSidebarState.test.ts` — a pre-existing
  jsdom shim issue, not yours. Don't chase it.
- **Concurrent edits.** Another session modified `MermaidBlock.tsx` mid-edit; re-read the
  file before continuing when you suspect drift.

## 8. Reproduce it faster — checklist

- [ ] Start in `/skill:openspec-explore`; let the AI read the code path before proposing.
- [ ] `ls openspec/changes/` before writing any artifact; use `openspec change new <name>`.
- [ ] Grow the proposal with "Update proposal: … [screenshot]" — one symptom per turn.
- [ ] `/opsx:ff <name>` → design + specs + tasks once the proposal settles.
- [ ] `/opsx:apply <name>`, drive with "go on"; expect TDD (red → green) per task.
- [ ] For any visual fix, re-verify with a fresh screenshot every iteration.
- [ ] Set mermaid fonts in `init` config; override `pre *` monospace for `.mermaid-diagram`.
- [ ] `/opsx:verify <name>` — backfill any untracked in-flight changes into tasks.md.
- [ ] `/opsx:archive <name>` — syncs delta specs into main specs.

**Key inputs:** a running dashboard to screenshot; the client source in `src/client/`.
**Final artifacts:** `openspec/changes/archive/2026-04-04-ui-tweaks-image-collapse-fix/`
(proposal, design, 4 specs, tasks), edits to `memory-event-store.ts`, `useSidebarState.ts`,
`SessionList.tsx`, `SessionCard.tsx`, `ResizableSidebar.tsx`, `MermaidBlock.tsx`,
`index.css`, and 4 synced main specs.

---

_Generated from session `da7d08cf` · `/Users/robson/Project/pi-agent-dashboard` · 2026-04-04. Source extract: deterministic facts sheet._
