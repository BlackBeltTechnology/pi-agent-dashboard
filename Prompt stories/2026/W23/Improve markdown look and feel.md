---
session: 019e9e8c
week: 2026/W23
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
---

# How we did it: Improve markdown look and feel — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened in **explore mode** (the `openspec-explore` stance: think, don't
implement). The operator's real objective was concrete and visual: **improve the look
and feel of the dashboard's rendered markdown — specifically tables and code blocks —
without touching production code yet.** The steering turn that clarified it was
"`start a server for mockups and open`": the operator wanted a **live, tunable browser
mockup** grounded in the real theme, not a written design doc. The deliverable is a
self-contained HTML mockup that shows *current vs proposed* styling and lets the
operator fine-tune the values before any CSS is committed.

## 2. TL;DR playbook

1. Enter explore mode (`openspec-explore`) so the AI investigates and mocks up but
   does **not** modify production CSS/TSX.
2. Prompt: *"improve the markdown table + code-block look; ground it in the real
   theme tokens and build a tunable mockup I can open in a browser."*
3. Let the AI locate the real renderer + tokens first: `MarkdownContent.tsx` +
   `index.css` theme variables (`--bg-*`, `--text-*`, `--border-*`, `--link*`).
4. Have it do a short web-search pass on modern table/markdown design (zebra,
   header elevation, dividers-over-grids) to justify the direction.
5. Have it write **one self-contained** `mockups/<name>/index.html` that copies the
   theme tokens **verbatim**, shows **current vs proposed side-by-side**, toggles
   **light/dark**, and exposes **live sliders** for the few variables worth tuning.
6. Serve it: `cd mockups && (python3 -m http.server 8777 &)` then open
   `http://localhost:8777/<name>/` — refresh picks up edits.
7. Screenshot both themes to confirm faithfulness before handing back.
8. When done, **commit the mockup** (`git add mockups/... && commit && push`) — a
   branch checkout can wipe an uncommitted working-tree file between sessions.

## 3. How the collaboration unfolded

**Phase 1 — Ground in real code (Discovery).** Before designing anything, the AI ran
`find`/`grep` to locate the actual markdown renderer (`packages/client/src/components/
MarkdownContent.tsx`) and the theme CSS, then pulled the exact `--bg-*/--text-*/
--border-*/--link*` custom properties. *Why it worked:* the mockup uses the real
tokens, so what the operator tunes maps 1:1 onto production.

**Phase 2 — Justify the direction (Research).** One `web_search` on modern table
design confirmed the recipe: subtle zebra (2–4% lightness), an elevated/treated
header, horizontal row dividers instead of full cell grids, row-hover for tracking,
keep `<th>` semantics. *Why it worked:* a quick external check turned taste into a
defensible design spec.

**Phase 3 — Build the tunable mockup (Design/Generate).** The AI wrote a single
self-contained `index.html`: current-vs-proposed columns, light/dark toggle, and
**live sliders** for stripe opacity, header lift, radius, density. *Why it worked:*
sliders move the decision from the AI to the operator — no round-trips to re-render.

**Phase 4 — Verify visually (Verify).** It opened the page in the browser and
screenshotted both themes to prove they render faithfully.

**Phase 5 — Persist it (much later).** On resuming, the mockup file had vanished
(clean working tree — a branch checkout wiped the uncommitted file). The AI recreated
it from the content it had written, then committed + pushed to `develop`
(`282cbf78`).

## 4. Prompts that worked

- **The goal prompt (explore-mode kickoff).** Entering `openspec-explore` framed the
  work as *think + mock up, don't implement* — which is exactly right for a look-and-feel
  exploration. A stronger one-liner to bake in next time: *"In explore mode, improve the
  markdown table/code-block styling; ground it in the real theme tokens and give me a
  browser mockup with current-vs-proposed and live sliders."*
- **"`start a server for mockups and open`"** — high leverage. It converted an abstract
  design into a *hands-on artifact* the operator could tune, and told the AI the expected
  deliverable shape (served HTML, not prose).
- **"`seems ok`"** — a cheap approval that let the AI stop iterating and hand off.
- **"`commit and push`"** — the persistence trigger; see the pitfall in §7.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Stay in "discuss the design" mode | "start a server for mockups and open" | Ask for a **served, tunable mockup** in the goal prompt |
| Leave the mockup uncommitted in the working tree | "commit and push" | Commit the mockup as soon as it's built — don't rely on the working tree surviving a checkout |
| Risk drifting from the real look | (implicit) it grounded in tokens first | Always say "copy the real theme tokens verbatim" |

The session was low-friction (4 prompts, all short), because the AI self-imposed the
right quality bars: ground-in-real-code, research-then-design, verify-with-screenshots.

## 6. Skills, tools & memory created — and why they're effective

No skill or memory was created this session. But the workflow is clearly repeatable and
worth a skill: **"tunable-mockup-loop"** — *given a UI surface, locate its real renderer
+ theme tokens, write one self-contained `mockups/<name>/index.html` (current-vs-proposed
+ theme toggle + live sliders), serve it on a fixed port, screenshot both themes, and
commit it immediately.* It removes the manual work of wiring tokens, avoids production
edits during exploration, and gives the operator a hands-on tuning surface. (Note: the
repo already has adjacent design skills — `frontend-mockup-loop-dashboard`,
`isolated-ui-verification`, `theme-system` — this session's pattern overlaps and could be
folded into those rather than a new skill.)

## 7. Pitfalls & dead ends

- **Uncommitted mockup vanished between sessions.** The working tree was cleaned (branch
  checkout) and `mockups/` was gone; the AI had to **recreate the file from the content it
  had written** before committing. *If you hit this:* commit the mockup the moment it
  builds — don't leave design artifacts uncommitted across a session gap.
- **`http.server` background launch reported an error the first time.** The first
  `python3 -m http.server 8777` attempt was flagged failed (port/`curl -I` timing); the
  retry using `curl -s -o /dev/null -w "%{http_code}"` succeeded. *If you hit this:* poll
  the server with a status-code check after a short `sleep`, not `curl -I` immediately.
- **`git check-ignore` / early `git status` calls errored** while probing whether the file
  was ignored — harmless, but confirm the mockup path isn't gitignored before assuming a
  commit will include it.
- A `ctx_batch_execute` pair errored (2/2) — noise, not on the critical path.

## 8. Reproduce it faster — checklist

- [ ] Enter `openspec-explore` (no production edits).
- [ ] Locate the real renderer (`MarkdownContent.tsx`) + theme tokens in `index.css`.
- [ ] One web-search pass to justify the design direction.
- [ ] Write **one** self-contained `mockups/<name>/index.html`: real tokens verbatim,
      current-vs-proposed, light/dark toggle, live sliders for the few key vars.
- [ ] Serve: `cd mockups && (python3 -m http.server 8777 &)`; open
      `http://localhost:8777/<name>/`; poll with a status-code check.
- [ ] Screenshot both themes to verify faithfulness.
- [ ] `git add mockups/... && git commit && git push` **immediately**.

**Inputs needed:** the target UI surface + its theme token source.
**Final artifact:** `mockups/markdown-style/index.html` (committed as `282cbf78` on
`develop`).

---

_Generated from session `019e9e8c` · `pi-agent-dashboard` · 2026-06-07. Source extract: session facts sheet._
