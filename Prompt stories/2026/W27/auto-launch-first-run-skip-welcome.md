---
session: 019f2d45
week: 2026/W27
type: development
model: "@fast"
premium: true
premium_reason: "yes — heavy steering (9 user prompts)"
upgrade_status: pending
openspec_changes: [auto-launch-first-run-skip-welcome]
proposal_excerpt: "The first-run wizard is currently a single screen with a single button (`[Launch dashboard]`) and an `Advanced` disclosure for connecting to a remote server. Reading `packages/electron/src/renderer/wizard.html`:"
---

# How we did it: Doubt-reviewing an unimplemented OpenSpec plan — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The user opened with `"The code improved lot. Use doubt review to check"` — expecting a
doubt-driven review of freshly-written implementation code for the
`auto-launch-first-run-skip-welcome` change (a plan to delete the Electron first-run
wizard and auto-launch the dashboard).

The *real* objective, once the AI surfaced the repo state, shifted: **there was no
implementation code** — the worktree was clean, zero commits vs `develop`, all wizard
files intact, every task unchecked. So the work became: (1) doubt-review the **plan
itself** (proposal + tasks + spec delta) as an in-flight architectural decision,
(2) find the load-bearing production wiring the plan would silently delete, (3) fold
the findings back into `tasks.md`, and (4) design the replacement remote-connect UI as
a grounded, accessibility-checked mockup.

## 2. TL;DR playbook

1. **Ground before reviewing.** `git status`, `git diff --stat`, check tasks.md
   checkboxes, and confirm whether the "improved code" actually exists. Flag the
   premise mismatch instead of fabricating a review.
2. **Verify the plan's code claims against source.** Grep the real `main.ts` line
   numbers, call sites, and IPC handlers the proposal cites — reviewers need accurate
   ARTIFACT facts.
3. **Spawn a fresh-context adversarial reviewer** (`Explore`) passing ARTIFACT +
   CONTRACT only — *no* CLAIM, *no* your own findings. Let it converge independently.
4. **Cross-model confirm.** Re-run the same review on a second model
   (`google-vertex/gemini-3.1-pro-preview`) — but **probe the model id first** with a
   trivial prompt; an empty return means the prefix isn't SDK-invocable.
5. **Reconcile, don't rubber-stamp.** Re-read the artifact against each finding;
   independently verify the biggest claims against source before accepting them.
6. **Fold findings into `tasks.md`**, tagging each new task `[doubt-review #N]` for
   provenance, then `npx openspec validate --strict`.
7. **Design the replacement UI as a mockup** grounded in existing renderer tokens
   (lift them verbatim from the file being deleted). Serve it live; gate on WCAG
   contrast — compute ratios by hand if Playwright isn't installed.

## 3. How the collaboration unfolded

**Phase 1 — Discovery / premise check.** The AI loaded `doubt-driven-review`, ran
`git status`/`git diff`/`git log`, and read `tasks.md`. It discovered the premise was
false: no code, clean tree, unchecked tasks, missing `design.md`. *Why it worked:* it
**stopped and flagged the mismatch** rather than inventing a review of nonexistent code.
*Decision point:* an `ask_user` returned no selection, so it defaulted to reviewing the
**plan** — legitimate, since doubt-review targets in-flight decisions and wizard deletion
is hard to reverse.

**Phase 2 — Grounded adversarial review.** It verified the proposal's line-number and
call-site claims against `main.ts`, then spawned a fresh `Explore` reviewer with
ARTIFACT + CONTRACT only. The reviewer returned file:line-cited findings; the AI
independently confirmed the top four against source. *Why it worked:* clean-room review
(no leaked conclusions) + independent verification = real findings, not doubt theater.

**Phase 3 — Cross-model confirmation.** The user chose "second option, use vertex ai
gemini 3.1 pro model as pi subagent." The AI **probed three prefixes**
(`google/`, `vertex/`, `google-vertex/`) with a trivial prompt before the real review —
only `google-vertex/gemini-3.1-pro-preview` returned "OK". Gemini converged on the same
three core findings and added a sharp distinction: **Known Servers (`config.json`, the
React client's routing) ≠ `mode.json` (the Electron main process's attach switch)** —
two different systems the proposal had blurred.

**Phase 4 — Fold findings into tasks.md.** Five corrections applied, each tagged
`[doubt-review #N]`: hoist `registerBundledBridgeExtension()` out of the deleted arm,
fix the `doctor-window.ts` build break, don't orphan remote-mode, decide marker-on-
attach, and sweep dead handlers. Validated: 28 → 36 tasks.

**Phase 5 — Design the replacement UI.** Prompted by "Is it possible to set in
electron's app menu?" the AI proposed an app-menu `Connect to Remote Dashboard…` item
whose main-process `click:` handler calls `writeModeFile()` directly (no IPC). It then
built a mockup **grounded in `wizard.html`'s exact tokens**, served it live, computed
WCAG ratios by hand (Playwright absent), and fixed inherited contrast debt. Subsequent
steering added a server-side-network help note and a **Recent servers** list.

**Phase 6 — Settle the architecture.** Final steering (`mode.json be renamed to
dashboard-settings.json - B is not correct, because server needed to get servers`)
settled it: the recent-servers list must be **shell-local** (the shell reads the file at
startup, *before* any server connection, so a server can't host its own list), and
`mode.json` → `dashboard-settings.json` (it now holds mode + remoteUrl + recents).
Recorded in `tasks.md` with migration task; validated.

## 4. Prompts that worked

- **The goal prompt** — `"The code improved lot. Use doubt review to check"`. Weak: it
  asserted a false premise (code that didn't exist). *Stronger version:* "Doubt-review
  the `auto-launch-first-run-skip-welcome` change — verify whether it's implemented yet,
  and if not, review the plan for production wiring it would delete."
- **`"second option, use vertex ai gemini 3.1 pro model as pi subagent"`** — high
  leverage: escalated to a **cross-model** review, which produced independent
  confirmation and one novel finding.
- **`"Is it possible to set in electron's app menu?"`** — a *question* that unlocked the
  cleanest architecture (no-IPC main-process write). Asking "is X possible?" invites the
  AI to evaluate an option instead of just executing.
- **`"mode.json be renamed to dashboard-settings.json - B is not correct, because server
  needed to get servers"`** — decisive: rejected an option *with rationale*, letting the
  AI capture the reasoning verbatim in tasks.md.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| accept the "code improved" premise | (AI self-corrected first) — but user then chose the review target implicitly | state up front whether code exists or only a plan does |
| pick a single reviewer model | "use vertex ai gemini 3.1 pro model" | make cross-model doubt review the default for hard-to-reverse deletions |
| leave remote-mode routing ambiguous | "what means remote mode?" then rejecting option B with reasoning | document the shell-reads-before-connect constraint in the change's design |
| stop at a Settings-UI idea | "Is it possible to set in electron's app menu?" | prefer main-process app-menu handlers when the writer already lives in main |
| ship UI without prerequisites | "Add remarks that on server machine the network have to be enabled" | add server-side network/firewall notes to any remote-connect UI |
| treat switching as retyping URLs | "Can save the remote machines to recent list?" | design recognition-over-recall (MRU list) into connection dialogs |

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was persisted, but the session **exercised** three reusable
disciplines worth codifying:

- **`doubt-driven-review` on a plan, not just code.** Effective because it caught a plan
  that "deletes live production wiring it never grepped for" — before any code was
  written. *Invoke when:* an irreversible deletion/migration is proposed, even
  pre-implementation.
- **Model-probe-before-spawn.** Probe a provider/model id with a trivial prompt before
  the real subagent call — an empty return means the prefix isn't invocable. Saved a
  wasted full review on the wrong `vertex/` prefix. *Invoke when:* overriding a subagent
  model with a non-default provider prefix.
- **Mockup grounded in the file being deleted.** Lifting design tokens verbatim from
  `wizard.html` (the doomed file) kept the replacement on-brand for free. *Invoke when:*
  replacing an existing UI surface.

*Recommended skill to create:* "cross-model-doubt-review" — codify the ARTIFACT+CONTRACT
clean-room handoff, the probe-first step, and the reconcile-don't-rubber-stamp loop.

## 7. Pitfalls & dead ends

- **`mktemp`-style stale state / false premise.** The opening ask assumed code existed.
  *If you hit this, do:* ground with `git status`/`git diff`/tasks checkboxes and flag
  the mismatch before doing the requested work.
- **Wrong model prefix returns empty, not an error.** `google/` and `vertex/` returned
  empty; only `google-vertex/gemini-3.1-pro-preview` was reachable. *If you hit this,
  do:* probe each candidate prefix with a one-word prompt first.
- **Playwright browser not installed** blocked automated mockup scoring. *If you hit
  this, do:* compute WCAG contrast ratios by hand from the known hex values — don't skip
  the accessibility gate.
- **Inherited contrast debt.** The mockup's tokens (`#64748b`, `#3b82f6`, `#2563eb`)
  were below AA *in the shipped app*. *If you hit this, do:* swap to the nearest
  in-system token that passes (`--muted #94a3b8`, `--primary-hover #2563eb`, badge
  `#60a5fa`) rather than inventing new colors.
- **Stray `project` key in edits** caused two edit retries. Minor, but re-read the file
  section before precise edits.

## 8. Reproduce it faster — checklist

- [ ] `git status && git diff --stat <base>` — confirm code exists before "reviewing code."
- [ ] Read `tasks.md`; check whether tasks are actually checked off.
- [ ] Grep the proposal's cited line numbers / call sites against real source.
- [ ] Spawn `Explore` with ARTIFACT + CONTRACT only; no leaked conclusions.
- [ ] Probe the second model id (`google-vertex/...`) with a trivial prompt, then re-run
      the review cross-model.
- [ ] Independently verify the top findings against source; reconcile.
- [ ] Fold corrections into `tasks.md` tagged `[doubt-review #N]`; `npx openspec validate --strict`.
- [ ] Ground the replacement mockup in the deleted file's tokens; serve live; gate on WCAG.

**Key inputs to have ready:** the worktree path, the OpenSpec change name, a reachable
second-model provider/model id, and the renderer file (`wizard.html`) whose tokens to reuse.

**Final artifacts produced:** updated
`openspec/changes/auto-launch-first-run-skip-welcome/tasks.md` (28 → 36 tasks, then the
2B rename/migration decision) and the live mockup `/tmp/remote-connect-mockup/index.html`.

---

_Generated from session `019f2d45-bb6a-724c-b2fc-7cef90f77642` · `/Users/robson/Project/pi-agent-dashboard` · 2026-07-04. Source extract: session facts sheet._
