---
session: 019ec79c
week: 2026/W24
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (20 user prompts); large facts sheet (~18524 tok)"
upgrade_status: pending
openspec_changes: [restore-windows-nsis-installer, fix-windows-portable-exe]
proposal_excerpt: "Today the Windows distribution surface is two artifacts per arch — `PI-Dashboard-win32-<arch>.zip` and `PI-Dashboard-<arch>-portable.exe` — and **neither serves the \"I installed an app and want a Start Menu entry plus…"
---

# How we did it: Restore the Windows NSIS Setup.exe (per-user) and drop portable.exe — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened almost accidentally: *"Is there anything which drifted?"* followed
by *"Current proposal: restore-windows-nsis-installer. Is there any drift?"* The real
objective surfaced two prompts later: **replace the Windows `portable.exe` with a proper
assisted NSIS `Setup.exe` installer** — a wizard that installs the dashboard to a chosen
directory, adds a Start Menu entry, and an uninstaller — then implement the whole
OpenSpec change, prove it builds on CI, download a real installer, and land it on
`develop`. What started as a drift check became a full feature build plus a multi-day
CI-hardening marathon (the session spanned 2026-06-14 → 2026-06-22).

## 2. TL;DR playbook

1. **Drift-check the spec first.** Ask "is there any drift in proposal X?" and have the AI read the spec/design decision points verbatim before touching code. Here the proposal *already* mandated `oneClick:false` + no-portable — the AI confirmed with `SHALL`/`SHALL NOT` quotes rather than editing blindly.
2. **Nail the install topology up front.** One steering turn ("drop per-machine, per-user only") rippled across proposal → design → spec → tasks. Decide `perMachine:false` + HKCU-only *before* implementing so the four artifacts stay consistent.
3. **Run `/skill:openspec-apply-change`** and let the AI bucket the 57 tasks by *where they can be verified* (implement-now on the macOS/node_modules-less worktree vs CI-only vs out-of-scope). Confirm the plan before it writes code.
4. **Author the NSIS pipeline:** `electron-builder-nsis.json` (per-user config), `build/installer.nsh` (HKCU registry + selective uninstall), a deterministic asset generator (`master.png` → ICO/BMP, derived assets gitignored), and swap the portable invocation for `electron-builder --win nsis` in `_electron-build.yml`.
5. **Ask "can we test NSIS on CI?"** — the answer unlocked inline smoke steps on the `windows-latest` build runner (per-user `/S` needs no admin), plus a native `smoke-win-arm64` job.
6. **Open the PR + dispatch the on-demand Electron build** to produce a downloadable `Setup.exe`. Then chase CI green through each real error (see §7).
7. **Rebase onto `develop` repeatedly** as it moves; each rebase reconcile the lockfile (`npm install --package-lock-only`) because develop keeps adding deps.
8. **When "green" hides a failure**, add diagnostics to the launch script and read the *why*. Here it exposed that a GUI Electron binary cannot launch headlessly on a hosted runner — so make CI **honest**: install/registry/branding/uninstall as hard gates, launch deferred to VM/manual.

## 3. How the collaboration unfolded

**Phase 1 — Drift audit (prompts 1–2).** The AI read `specs/electron-build-pipeline/spec.md`
and `design.md` and found the proposal already encoded installer-only/no-portable as hard
requirements. It answered with verbatim `SHALL`/`SHALL NOT` evidence instead of "fixing"
a non-problem. *Why it worked:* quoting the spec back proved there was no drift and built
trust before any edit.

**Phase 2 — Topology correction (prompts 3–4).** The human said drop the portable idea and
make it a real setup wizard, then "2" — pick per-user only, no per-machine mode. The AI
rewrote all four OpenSpec artifacts (proposal/design/spec/tasks) to `perMachine:false`,
HKCU-only, Welcome→Location→Install→Finish, adding explicit `SHALL NOT present an
install-mode page` negations. *Decision point:* per-user vs multi-user — chosen once,
propagated everywhere.

**Phase 3 — Apply the change (prompt 5).** `/skill:openspec-apply-change` on a 58-task
change. The AI bucketed tasks by verifiability and got 40/58 done on the worktree:
NSIS config, `installer.nsh`, asset generator, dropped portable across every build script,
a site classifier Vitest test, QA PowerShell scripts, and docs (delegated to a `docs-writer`
subagent per the caveman-style rule).

**Phase 4 — CI smoke design (prompts 6–8).** "Is it possible to test NSIS on CI?" was the
pivotal question. The AI realized the win32 legs already run on real `windows-latest`, and
per-user `/S` install needs no UAC — so it wired an inline smoke step plus a native
`smoke-win-arm64` job on `windows-11-arm`, updating the proposal to match.

**Phase 5 — Ship + CI firefight (prompts 9–13).** PR #126 opened, Electron build dispatched,
then a run of genuine one-bug-per-iteration fixes (§7). Each failure was read from the
`gh run` log tail, root-caused, fixed, pushed, re-dispatched.

**Phase 6 — Cross-referenced bug + rebases (prompts 14–17).** The human pointed at issue #136;
the AI traced it to `_electron-build.yml` hardcoding the Fastify-crashing `v22.18.0` instead
of the `_node-version.sh` single-source `v24.15.0` — the same root cause behind the launch
failures. Fixed all three download steps. Repeated rebases onto a fast-moving `develop`
each needed a lockfile reconcile (develop added `wouter`).

**Phase 7 — The honest-green reckoning (prompts 18–20).** "It's not OK" / "no downloadable
artifacts." The AI added diagnostics and discovered the launch smoke was *always* failing
(non-fatal, so it masked a scary FAIL): `pi-dashboard.exe` is a GUI-subsystem binary that
can't reach its server-spawn step on a headless hosted runner. It removed the impossible
launch test, kept install/registry/branding/uninstall as **hard gates**, dropped the flaky
arm64 job, and synced every doc — producing a genuinely honest green.

## 4. Prompts that worked

- **The goal prompt (as-run):** *"Do not create portable NSIS, instead of setup wizard which install dashboard to given directory."* — one sentence that reframed the whole distribution surface. **Stronger version:** *"Replace the Windows portable.exe with a per-user assisted NSIS Setup.exe (wizard: choose dir + Start Menu + uninstaller, HKCU only, no oneClick, no per-machine). Update the OpenSpec change to match, then implement."*
- **High-leverage follow-up:** *"Is it possible to test NSIS installer on CI?"* — unlocked the entire smoke-test strategy. A good "can we verify this cheaper?" question is worth more than any code.
- **The reality-check that saved the deliverable:** *"its not OK <run URL>"* / *"no downloadable artifacts."* Short, blunt, evidence-linked — forced the AI past a misleading green to the actual root cause.
- **Efficient one-word steering:** "2", "yes", "yes", "rebase develop" — the human trusted a well-laid plan and just confirmed direction, keeping momentum.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Treat a "no drift" answer as the end state | "drop portable, make it a setup wizard" | State the *desired* topology in the goal prompt, not just "check for drift" |
| Carry a per-machine install mode that contradicted the Non-goals | "2" → per-user only | Decide install scope (per-user vs per-machine) once, up front, and propagate to all four artifacts |
| Trust a green CI run | "its not OK <link>", "no downloadable artifacts" | Make the *user-facing outcome* (a working, downloadable installer) the acceptance test, not a green checkmark |
| Leave launch smoke non-fatal so it hid a real failure | pointing at the actual run | Add diagnostics before declaring a flaky test "expected"; a non-fatal test that always fails is noise that masks defects |
| Assume the bundled Node version was fine | "check issue #136" | Wire version-critical values to their single source of truth (`_node-version.sh`), never hardcode |

## 6. Skills, tools & memory created — and why they're effective

No new pi skill or memory was created in this session, but the workflow is highly
repeatable and *should* be captured. Two candidates:

- **`switch-install-topology` (project skill):** the ripple of "per-user only" across
  proposal/design/spec/tasks is mechanical and error-prone — a skill that lists the four
  artifacts + the negation phrases (`SHALL NOT present an install-mode page`, `SHALL NOT
  write to HKLM`) would make it one command.
- **`ci-honest-green` guardrail (memory):** "A non-fatal CI step that always fails is a
  masking hazard — either make it a hard gate or remove it; never leave a permanent scary
  FAIL." This session lost multiple iterations to a `continue-on-error` launch test.

The session *did* use a `docs-writer` subagent (per AGENTS.md's caveman-style `docs/` rule)
and `/skill:openspec-apply-change` — both worked well and should be the default for this
kind of change.

## 7. Pitfalls & dead ends

Each CI iteration was a real bug — read the log **tail**, fix one thing, re-dispatch:

- **`configuration.win has an unknown property 'publisherName'`** — invalid in
  electron-builder 26.x. Fix: drop `win.publisherName`; write Publisher via `installer.nsh`
  into HKCU instead.
- **`GH_TOKEN is not set` / implicit CI publish** — electron-builder auto-publishes when it
  detects CI. Fix: `--publish never` on both the CI step and the local `--with-nsis` script.
- **Silent `/S` install left `$INSTDIR` empty** — assisted (`oneClick:false`) installers only
  compute the default dir in the directory page, which `/S` skips. Fix: pass explicit `/D=`
  via raw `ProcessStartInfo` args (PowerShell arg-quoting mangles paths with spaces) and poll
  for the dir.
- **`$entry.InstallLocation.TrimEnd()` threw on a null value** on the slower arm64 install.
  Fix: null-safe the registry read.
- **Bundled Node `v22.18.0`** (the Fastify-crash version `node-guard.ts` rejects) hardcoded in
  `_electron-build.yml` in 3 places while `_node-version.sh` said `v24.15.0`. Root cause of
  issue #136 *and* the launch failures. Fix: read `BUNDLED_NODE_VERSION` in all 3 steps.
- **The masking green:** launch smoke was `continue-on-error`, so a GUI-binary-can't-launch-
  headlessly failure hid behind a green run. Fix: remove the impossible test, keep
  install/registry/branding/uninstall as hard gates.
- **Lockfile drift on every rebase** — adding `sharp`+`png-to-ico` (and develop adding
  `wouter`) means `npm ci` fails unless `package-lock.json` is regenerated. Always
  `npm install --package-lock-only` after a dep change or rebase, and verify the diff is
  scoped.

## 8. Reproduce it faster — checklist

**Inputs to have ready:**
- The OpenSpec change dir (`openspec/changes/restore-windows-nsis-installer/`).
- A worktree; note it has **no `node_modules`** (deps resolve from the main repo) — full
  verification needs CI.
- `gh` CLI authed; ability to dispatch "CI Electron (on-demand)".

**Steps:**
1. `npx openspec validate <change> --strict` — confirm the four artifacts agree on per-user/no-portable.
2. Author `packages/electron/electron-builder-nsis.json` (`oneClick:false`, `perMachine:false`, HKCU, `executableName: pi-dashboard`), `build/installer.nsh`, and the asset generator (gitignore derived ICO/BMP).
3. Swap portable → `electron-builder --win nsis` in `_electron-build.yml`; drop portable from every build script; add `--publish never`; **no `win.publisherName`**.
4. Wire the bundled Node version to `_node-version.sh` (no hardcodes).
5. Add inline smoke as **hard gates** (install → no-per-machine → branding → uninstall via `/S` + `/D=`); leave GUI *launch* to a VM, not the headless runner.
6. `npm install --package-lock-only` → verify scoped diff → commit.
7. Open PR against `develop`; dispatch `legs=win32-x64`; watch `npm ci` (lockfile) then the NSIS build + smoke.
8. On red, read the log **tail**, fix one bug, re-dispatch. Rebase + reconcile lockfile whenever develop moves.

**Final artifacts produced:** per-user `PI-Dashboard-Setup-<slug>-<arch>.exe` + `.zip`
(downloadable from the green run), the full OpenSpec change, 6 QA `.ps1` scripts, a site
classifier Vitest test, and the issue #136 Node-version fix. PR **#126** on branch
`os/restore-windows-nsis-installer`.

---

_Generated from session `019ec79c-b4b4-7980-ab0d-179b0f819e5e` · `pi-agent-dashboard` · 2026-06-22. Source extract: `/tmp/facts-12545.md`._
