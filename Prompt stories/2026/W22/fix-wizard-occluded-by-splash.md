---
session: 019e6114
week: 2026/W22
type: other
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [fix-wizard-occluded-by-splash]
proposal_excerpt: "On Windows (and likely macOS in some workspace setups), the first-run wizard window never becomes visible because the splash window — which is `alwaysOnTop: true`, `frame: false`, `transparent: true`, and centred on s…"
---

# How we did it: fix-wizard-occluded-by-splash — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator opened with one line: **"Proposal: fix-wizard-occluded-by-splash.
Windows tested."** The code fix already existed on a branch — the splash window
(`alwaysOnTop: true`, `frame: false`, `transparent: true`) was covering the first-run
wizard so it never became visible. The *real* objective of this session was not to
write the fix but to **drive an OpenSpec change the last mile to done**: confirm the
Windows smoke test, prove macOS didn't regress, delegate the docs update, archive the
change, sync the delta spec into the main spec, and commit — cleanly, on the right
branch, without disturbing unrelated working-copy changes.

## 2. TL;DR playbook

1. State the change name + what's already verified: *"Proposal: <name>. Windows tested."*
2. Let the AI mark the validated task done in `tasks.md` and run the cheap invariant
   proxy (call-order unit test + typecheck on touched files) instead of a full rebuild.
3. For the OS you *can* test locally, ask for a build and a **manual launch handoff** —
   the AI builds, then stops and gives you the `open …app` command.
4. Launch it yourself, eyeball the 3 acceptance points (wizard shows, no double-flash,
   dashboard opens on wizard close), reply **"yes"**.
5. Delegate all `docs/` writes to a subagent with the caveman-style rule (Documentation
   Update Protocol) — never edit `docs/` inline.
6. Archive via the `openspec-archive-change` skill; let it sync ADDED requirements into
   the main spec.
7. Say **"commit"** — the AI stacks the archive commit above the code fix and leaves
   unrelated changes untouched; confirm the branch/bookmark placement before pushing.

## 3. How the collaboration unfolded

**Phase A — Close out the verification tasks (Discovery → Verify).**
The AI opened `tasks.md`, marked task 4 (Windows smoke) done from the operator's
"Windows tested", then made a *cost-conscious* call on task 5 (macOS no-regression):
rather than rebuild the whole Electron app just to check an invariant, it ran the
splash/wizard **call-order unit test** as a proxy plus a typecheck on the touched
files. Effective because the structural invariant (splash resolves before
`showWelcomeStep()`) is exactly what the unit test guards.

**Phase B — Build + human-in-the-loop launch (Verify).**
For macOS — which the operator *can* run — the AI built the Electron app and **stopped**,
handing back the `open packages/electron/out/PI-Dashboard-darwin-x64/PI-Dashboard.app`
command and a 3-point checklist. The human launched it, saw the wizard behave, and
replied "yes". Decision point: the AI didn't pretend to verify a GUI it can't see — it
scoped its own work to what's automatable and delegated the eyeball test.

**Phase C — Delegate docs (Generate).**
Per AGENTS.md, all `docs/` writes go through a subagent with caveman-style rules passed
verbatim. The AI spawned `general-purpose` to update `docs/electron-bootstrap-flow.md`
(wizard-welcome row) and the electron file-index with the splash/wizard ordering
invariant + `See-change` tokens. Main context stayed clean.

**Phase D — Archive + sync spec (Verify → Ship).**
The `openspec-archive-change` flow moved the change to
`openspec/changes/archive/2026-05-26-fix-wizard-occluded-by-splash/` and synced 2 ADDED
Requirements into `openspec/specs/first-run-wizard/spec.md`. The AI surfaced honest
loose ends: one optional task deferred, `design.md` never created (small fix didn't
warrant it), and a **pre-existing** structural spec issue it explicitly flagged as *not
introduced here*.

**Phase E — Commit on the right branch (Ship).**
On "commit", the AI wrote the message to a temp file, committed only the archive/docs
changes (`7ea1dbcc`), stacked above the already-committed code fix (`3bc3b7d3`), and left
unrelated working-copy changes alone. It then asked before moving the bookmark/pushing.

## 4. Prompts that worked

- **The goal prompt — "Proposal: fix-wizard-occluded-by-splash. Windows tested."**
  Terse but high-signal: it names the OpenSpec change (so the AI loads the right
  `tasks.md`) *and* reports which acceptance evidence already exists, letting the AI
  jump straight to the remaining tasks. Stronger still: add what's left, e.g.
  *"Proposal: <name>. Windows smoke passed; do the macOS no-regression + docs + archive."*
- **"$ open …PI-Dashboard.app"** — the operator echoing the launch command back is an
  implicit "I'm doing the manual test now"; pairs with the AI's handoff pattern.
- **"yes"** — a one-word unlock confirming the manual GUI check passed, letting the AI
  mark task 5 and proceed. High leverage because the AI had pre-listed *exactly what
  "yes" attests to* (the 3 acceptance points), so the confirmation is unambiguous.
- **"commit"** — trusts the AI to compose the message, pick the files, and place the
  commit in the stack. Works because the surrounding narrative had already established
  the branch topology.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Want to fully rebuild the Electron app to check a macOS invariant | (implicitly) accept the call-order unit test + typecheck as the proxy | State up front: *"use the call-order test as the macOS invariant proxy; only build if I ask to eyeball the GUI"* |
| Claim a GUI acceptance point it cannot observe | Do the manual launch itself and reply "yes" | Ask the AI to **hand off** GUI verification with an explicit checklist, then confirm |
| Edit `docs/` directly | Rely on the Documentation Update Protocol → subagent | Remind: *"route all docs writes through a subagent, caveman style"* (already enforced by AGENTS.md) |
| Potentially fold unrelated working-copy changes into the commit | Nothing needed — the AI isolated them and asked before pushing | Say once: *"commit only the change's files; don't touch unrelated working copy; ask before pushing/moving bookmarks"* |

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created — this session **consumed** existing repo
machinery rather than producing reusable assets:

- **`openspec-archive-change` skill** — archived the change and synced ADDED
  requirements into the main spec in one flow. Invoke it whenever an OpenSpec change's
  tasks are done and you want the delta spec folded into `openspec/specs/…`.
- **`general-purpose` subagent for docs** — isolates caveman-style `docs/` edits from
  main context per the Documentation Update Protocol. Invoke for every `docs/` write.

If anything, the repeatable pattern here — *close verification tasks → cheap-proxy the
expensive OS check → hand off GUI eyeball → delegate docs → archive+sync → stacked
commit* — is a candidate for an "OpenSpec change: last-mile ship" checklist skill.

## 7. Pitfalls & dead ends

- **Don't rebuild the whole Electron app to check a structural invariant.** The
  splash→wizard ordering is guarded by a call-order unit test; run that + a typecheck
  instead. Reserve the full build for when a human will actually launch the GUI.
- **Never assert a GUI acceptance point the AI can't see.** Wizard-visible /
  no-double-flash / dashboard-opens are eyeball checks — hand them to the operator with
  a checklist and gate on their "yes".
- **Watch the commit's branch placement in a jj stack.** The archive commit landed as
  `7ea1dbcc` above the code fix `3bc3b7d3`; the `feat/enable-standalone-npm-install`
  bookmark still pointed at the old rev. Decide explicitly whether to
  `jj bookmark set … -r @-` before pushing.
- **A pre-existing spec-structure warning surfaced during sync** (missing
  `## Purpose`/`## Requirements` headers in `first-run-wizard`). It was *not* introduced
  by this change — don't let the validator noise pull you into an unrelated cleanup;
  flag it for a separate pass.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the OpenSpec change name, which OS smoke tests already passed,
a local machine for the GUI eyeball on your platform, and a clean working tree (unrelated
changes stay out of the commit).

1. `Proposal: <change-name>. <OS> tested.` → AI opens `tasks.md`, marks the verified task.
2. AI runs the invariant proxy (call-order unit test + typecheck), not a full rebuild.
3. For your local OS: AI builds + hands off `open …app` + a 3-point acceptance checklist.
4. You launch, verify, reply **"yes"** → AI marks the no-regression task.
5. AI delegates `docs/` updates to a subagent (caveman style, Documentation Update Protocol).
6. Run `openspec-archive-change` → archive + sync ADDED requirements into the main spec.
7. `commit` → stacked archive/docs commit above the code fix; confirm bookmark/branch
   before pushing.

**Artifacts produced:** archived change at
`openspec/changes/archive/2026-05-26-fix-wizard-occluded-by-splash/`, +28 lines of ADDED
requirements in `openspec/specs/first-run-wizard/spec.md`, updated
`docs/electron-bootstrap-flow.md` + electron file-index, commit `7ea1dbcc`.

---

_Generated from session `019e6114` · `/Users/robson/Project/pi-agent-dashboard` · 2026-05-26. Source extract: deterministic facts sheet._
