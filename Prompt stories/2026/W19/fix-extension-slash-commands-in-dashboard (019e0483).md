---
session: 019e0483
week: 2026/W19
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [fix-extension-slash-commands-in-dashboard]
proposal_excerpt: "Pi extensions that register slash commands via `pi.registerCommand(name, { handler })` are silently broken in dashboard sessions. When the user types e.g. `/ctx-stats` or `/curator` in chat, the registered handler n…"
---

# How we did it: Re-validate a stale OpenSpec proposal against the live codebase — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator opened with:

> *"Recheck proposal fix-extension-slash-commands-in-dashboard that current codebase how is affected. Is there any new thing to clarify?"*

The real objective: an OpenSpec proposal had been sitting for a while, and the dependencies it assumed (a specific `pi-coding-agent` version, two exact call sites, a native-commands set) may have moved underneath it. The task was **not** to implement the fix — it was to **audit whether the proposal is still accurate**: are the buggy lines still there, did a newer pi ship the API (`dispatchCommand`) that would make the stopgap unnecessary, and is there anything new to clarify before building. A small UI-readability fix got folded in at the end as an unrelated but adjacent steering turn.

## 2. TL;DR playbook

1. **Anchor on the proposal.** `ls`/read `openspec/changes/<name>/proposal.md` to recover the exact assumptions: version numbers, file:line targets, and the constant/set the fix depends on.
2. **Verify the buggy call sites still exist.** `grep -n` the exact symbols (`sendUserMessage`, `registerCommand`, `dispatchCommand`, the native-command set) in the target files; confirm line numbers match the proposal.
3. **Check for intervening commits.** `git log --oneline -- <target files>` to prove no later commit already touched the dispatch path.
4. **Resolve the *installed* pi version, not the assumed one.** Follow `which pi` → `readlink -f` → the real `node_modules/@mariozechner/pi-coding-agent` and read `dist/core/extensions/types.d.ts`. Confirm whether the newer API (`dispatchCommand`) exists yet.
5. **Write the recheck verdict** as a table: each assumption → still-true / changed, with the evidence line. State clearly whether the stopgap path is still required.
6. **(Folded-in UI fix)** For the layout steering turn: locate the component (`grep` for the render), open the dashboard in the browser to see the actual breakage, make a **count-conditional** layout change, `npm run build`, restart via `pi-dashboard restart`, re-screenshot to confirm.

## 3. How the collaboration unfolded

**Phase A — Recover the proposal's assumptions (Discovery).** The AI listed the change folder, read the proposal, and pulled out the concrete claims: two file:line call sites, `DASHBOARD_NATIVE_COMMANDS = new Set(["roles"])`, and an assumed pi version of 0.70. This is the right first move — a "recheck" is only meaningful against the proposal's *stated* assumptions.

**Phase B — Confirm the bug still lives (Verify code).** `grep -n` on the exact symbols confirmed `bridge.ts:722` and `command-handler.ts:297` were unchanged, and `git log` on those files showed the last commit (`abc70f97`, a provider-retry fix) didn't intersect the dispatch path. Verdict: bug still present, fix still needed.

**Phase C — Pin the *real* pi version (Verify dependency).** This was the most valuable and most error-prone part. The proposal assumed 0.70; the installed pi was **0.73.0**. Several path-guessing commands failed (searching `~/.pi-dashboard`, `node -e require(...)`) before the AI resolved the binary properly via `which pi` + `readlink -f` and read `dist/core/extensions/types.d.ts`. Result: the newer API (`dispatchCommand`) was **still absent**, so the stopgap path in the proposal remained required. The version bump didn't invalidate the plan.

**Phase D — Fold in an unrelated UI fix (Generate + Verify visually).** A later steering turn asked to fix an unreadable layout where multiple sessions attached to one proposal wrapped horizontally with every name truncated to `add-dashboard-model-...`. The AI grepped for the component (`FolderOpenSpecSection.tsx`), opened the dashboard in the browser to *see* the breakage, then made a **count-conditional** change: 1 session keeps the inline pill; 2+ sessions stack vertically with full-width readable names. Then `npm run build` → restart → re-screenshot to confirm.

## 4. Prompts that worked

- **The goal prompt** — *"Recheck proposal X: how is the current codebase affected? Is there anything new to clarify?"* Effective because it scopes the task to an **audit against stated assumptions**, not an implementation. It implicitly asks the AI to compare proposal-time reality against now.
- **High-leverage follow-up** — *"the last command run too long time"* redirected the AI off a slow/hanging command quickly instead of waiting it out.
- **Scope-expanding follow-up** — the layout prompt (*"Fix layout … when openspec have attached session list it in 2 or more lines below the proposal name"*) was effective because it stated the **desired end state** (stacked, multi-line, readable) rather than a mechanism, leaving the count-conditional implementation to the AI.

Stronger rewrite of the goal for next time: *"Recheck proposal `<name>` against HEAD: (1) confirm each targeted file:line still matches, (2) resolve the **installed** pi version and check whether `<new API>` shipped, (3) give a per-assumption still-true/changed table with evidence. Don't implement."*

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Guess dependency install paths (`~/.pi-dashboard`, `node -e require(...)`) — 3 failed lookups | (implicit; the AI self-corrected) | State up front: "resolve pi via `which pi` + `readlink -f`, then read `dist/core/extensions/types.d.ts`" |
| Let a command hang | *"the last command run too long time"* | Add a timeout / prefer non-interactive flags; kill and retry rather than wait |
| Fix layout uniformly | *"list in 2 or more lines … when multiple sessions attached"* | Ask whether the common (single) case should stay unchanged — here a count-conditional layout preserved it |
| Reason about UI breakage from code alone | (operator's framing forced a visual look) | Open the dashboard in the browser to *see* the truncation before editing |

## 6. Skills, tools & memory created — and why they're effective

No skill or memory was created this session. The workflow is, however, clearly repeatable and worth capturing:

- **Recommended skill: "revalidate-openspec-proposal".** It would encode the audit loop: recover proposal assumptions → grep the exact file:line targets → `git log` the target files → resolve the *installed* dependency version (never the assumed one) → emit a per-assumption still-true/changed table. This removes the manual path-guessing that cost several failed commands here and makes "is this proposal still accurate?" a one-shot, evidence-backed answer.

## 7. Pitfalls & dead ends

- **Dependency-path guessing.** Searching `~/.pi-dashboard` and `node -e require("@mariozechner/pi-coding-agent/package.json")` failed. **Do instead:** `PI=$(readlink -f $(which pi)); ls "$(dirname "$PI")/.."` then read `dist/core/extensions/types.d.ts`.
- **The assumed version is a trap.** The proposal said 0.70; reality was 0.73.0. Always re-derive the version from the on-disk package, and re-check whether the version bump shipped the API the proposal was waiting on (it hadn't — stopgap still required).
- **`curl` to `/api/restart` was flaky** (3 failed attempts). **Do instead:** `pi-dashboard restart` then `pi-dashboard status` to confirm.
- **A command hung** and had to be aborted — prefer bounded/non-interactive invocations.

## 8. Reproduce it faster — checklist

- [ ] Read `openspec/changes/<name>/proposal.md`; list its assumptions (versions, file:line targets, constants/sets).
- [ ] `grep -n` the exact symbols in the target files; confirm line numbers still match.
- [ ] `git log --oneline -- <target files>` — prove no intervening commit touched the path.
- [ ] Resolve installed dependency: `readlink -f $(which pi)` → read `dist/core/extensions/types.d.ts`; check for the awaited API.
- [ ] Write a per-assumption still-true/changed table with the evidence line for each.
- [ ] (If a UI fix is folded in) grep the component → open dashboard in browser → count-conditional edit → `npm run build` → `pi-dashboard restart` → re-screenshot.

**Inputs to have ready:** the OpenSpec change name; a running dashboard on `localhost:8000` (for any visual step); `pi` on `PATH`.

**Artifacts produced:** edited `packages/client/src/components/FolderOpenSpecSection.tsx` (count-conditional linked-sessions layout); a written recheck verdict confirming the proposal's stopgap path is still required against pi 0.73.0.

---

_Generated from session `019e0483-6551-7515-96ba-8a2939df750f` · `pi-agent-dashboard` · 2026-05-08. Source extract: `/tmp/facts-1784851991N.md`._
