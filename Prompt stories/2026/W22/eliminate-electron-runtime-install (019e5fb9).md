---
session: 019e5fb9
week: 2026/W22
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
---

# How we did it: green the CI board for `eliminate-electron-runtime-install` — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator arrived with a **status report, not a task**: after the
`eliminate-electron-runtime-install` cleanup (commit `d3fe2163`, which removed pi's
lazy runtime-install phase), CI was partially red — "8 of 10 jobs now pass, up from
0 of 10," with 3 Windows `standalone-install-smoke` legs still failing and framed as
"out of scope." The first prompt read like a hand-off:

> "Proposal: eliminate-electron-runtime-install … 8 of 10 jobs now pass … The
> remaining 3 Windows-smoke failures are the actual branch feature work and
> explicitly out of scope."

The **real objective**, which only emerged through the steering turns, was: *get the
whole CI board green* — first by fixing the "out of scope" Windows smoke failures (a
stale `/api/bootstrap/status` probe), then by discovering and fixing a second, deeper
class of failure the operator suspected: the **Electron Windows build rejecting the
CI-generated version string**. The session ended with 10/10 green on `ci.yml` **and**
a green Windows Electron build via `ci-electron.yml`.

## 2. TL;DR playbook

1. **Don't accept "out of scope" at face value.** When a status report says N failures
   are unfixable, ask the AI: *"okay, how to fix?"* — it forced a real diagnosis that
   turned out to be a ~3-file fix.
2. **Diagnose the probe, not just the URL.** The `.ps1`/`.sh` smoke scripts polled a
   removed `/api/bootstrap/status`. A naive URL swap to `/api/health` still fails —
   the **response shape** changed too (no `.status` field). Repoint the probe to
   `/api/health`'s `ok=true` and drop the obsolete polling deadline (240s → 60s; there's
   no lazy install to wait for anymore).
3. **Verify locally what you can, defer what you can't.** Run `bash
   scripts/test-standalone-npm-install.sh --port 18001` on macOS to prove the Linux/`.sh`
   path; let CI catch the Windows `.ps1`.
4. **Ask "is CI actually testing the thing I changed?"** The operator's
   *"Is it testing the build of electron packages?"* exposed a coverage gap: `ci.yml`
   never builds Electron — that lives in the manual `ci-electron.yml`. Map the workflows
   before trusting green.
5. **For the version bug: read the packager source, don't trust the docs.** The Windows
   `VERSIONINFO` needs `MAJOR.MINOR.BUILD[.REVISION]` integers; the CI SemVer slug
   (`0.5.3-ci.…`) is rejected. `buildVersion` in forge config only fixes `FileVersion` —
   `ProductVersion` is **hardcoded from `appVersion`** in `@electron/packager/dist/win32.js`.
   Fix both.
6. **TDD each layer.** Write `build-version.test.ts` red → implement `build-version.ts`
   green → wire into `forge.config.ts`. Each dispatched `ci-electron.yml` run peeled back
   the next masked error.
7. **Land surgically, one commit per layer.** Three commits: `buildVersion` →
   `appVersion` (win32-only) → `author` field. Push, dispatch `ci-electron.yml` with
   `legs=win32`, poll in short bursts.

## 3. How the collaboration unfolded

**Phase 1 — Confirm the reported state (Discovery).** The AI didn't just trust the
hand-off; it polled CI run `26407177817` and confirmed 7/10 green, 3 Windows red, with
the failure signature `bootstrap.status = parse-error`. *Why it worked:* re-verifying
the premise caught that the "out of scope" label was a description, not a verdict.

**Phase 2 — Diagnose and fix the smoke probe (Design → Generate → Verify).** Prompted by
*"okay, how to fix?"*, the AI read the `.ps1`, the `/api/health` handler, and the CI job,
then produced three ranked fix options (disable / repoint / restore). It recreated the
deleted `.sh` (polling `/api/health` for `ok=true`, 60s deadline), repointed the `.ps1`,
re-enabled the Linux job, ran the smoke locally, hit a **real bash bug** (a U+2026
ellipsis in the script broke variable expansion under macOS locale), fixed it to ASCII
`...`, ran the full suite (5934 pass), committed, pushed, and polled the new run to
**10/10 green**.

**Phase 3 — Coverage audit (Decision point).** The operator asked *"Is it testing the
build of electron packages?"* The AI mapped all four workflows and confirmed **no** —
`ci.yml` never touches Electron; the build lives in the dispatch-only `ci-electron.yml`.
It flagged the real gap: 4 of the branch's commits touched the Electron path but had
never run end-to-end.

**Phase 4 — The version bug (Systematic debugging + TDD).** The operator supplied the
lead: *"There was a problem in windows build with versions."* The AI inspected recent
`ci-electron.yml` runs (8/10 failed), pulled the exact error (`Incorrectly formatted
version string`), traced it into `@electron/packager`'s `resedit` step, and fixed it in
**three TDD-driven layers**, dispatching a `win32` build after each to reveal the next
masked error (`buildVersion` fixed FileVersion → `appVersion` fixed ProductVersion →
`author` field fixed `get-package-info`). Final Windows build: green.

## 4. Prompts that worked

- **The goal prompt** (the status report). *Weak as a kickoff* — it framed the remaining
  work as unfixable and out of scope, which could have ended the session at "nothing to
  do." A stronger version: *"CI is 8/10 green after the cleanup; the 3 Windows smoke
  failures are labelled out-of-scope — challenge that label and tell me the real cost of
  fixing vs. deferring each."*
- **`"okay, how to fix?"`** — the highest-leverage prompt of the session. Four words that
  converted a "deferred" failure into a landed, verified fix. *Why effective:* it refuses
  the premise and demands options.
- **`"Is it testing the build of electron packages?"`** — a coverage-audit prompt that
  exposed a whole class of untested commits. *Reuse pattern:* after any green board, ask
  the AI to prove which workflows actually exercised your change.
- **`"There was a problem in windows build with versions…"`** — a precise steering lead.
  It handed the AI a symptom + subsystem, letting it go straight to root cause instead of
  speculating. *Why effective:* names the failing subsystem and the failure class.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Accept the "out of scope" framing and report "no action needed" | Asking **"okay, how to fix?"** | Instructing up front: "treat every red job as fixable until proven otherwise; rank fix vs. defer with real costs." |
| Trust that a green `ci.yml` board means the change is fully tested | Asking **"Is it testing the build of electron packages?"** | Adding a standing rule: after green, map which workflows ran on the sha and name any untested path. |
| Not know the second (version) failure existed | Volunteering **"problem in windows build with versions"** | Feeding the AI the failing subsystem + symptom when you already know it — skips a speculation round. |
| Trust packager **docs** over its source (`buildVersion` "sets the version") | Implicitly, via the repeated red `ci-electron` runs | Reading `@electron/packager/dist/win32.js` directly — `ProductVersion` is hardcoded from `appVersion`, not `buildVersion`. |

## 6. Skills, tools & memory created — and why they're effective

No skill or memory was created this session — but the workflow is **highly repeatable**
and two artifacts should be captured:

- **A `build-version.ts` helper + test** (`packages/electron/src/lib/`) that derives a
  Windows-safe 4-integer `VERSIONINFO` (`MAJOR.MINOR.BUILD.RUN`) from the base SemVer
  triple + `GITHUB_RUN_NUMBER`, applied to `buildVersion` always and `appVersion`
  **only on win32** (so macOS/Linux keep the user-visible SemVer). This is the reusable
  asset — any project shipping Electron via `@electron/packager` from a CI-slugged SemVer
  will hit the same `parseVersionString` rejection.
- **Recommended skill:** the repo already has `ci-troubleshoot`; this session's
  root-cause chain (SemVer slug → `resedit` FileVersion vs. ProductVersion → masked
  `author` failure) belongs in it as a documented Windows-Electron-version failure mode.
  Invoke `ci-troubleshoot` whenever `ci-electron.yml` Windows legs go red on a version or
  packaging error.

## 7. Pitfalls & dead ends

- **U+2026 ellipsis in a shell script** → bash variable-expansion misparse under a
  non-UTF-8 locale (`$INSTALL_DIR…` swallowed identifier chars). *If you hit an undefined
  var that "looks fine":* grep the script for non-ASCII (`…`, curly quotes) and replace
  with ASCII. CI Ubuntu's UTF-8 locale hides it; macOS surfaces it.
- **`buildVersion` alone doesn't fix Windows VERSIONINFO.** It only covers `FileVersion`;
  `ProductVersion` is hardcoded from `appVersion` in the packager. *If Windows resedit
  still errors after setting `buildVersion`:* also set `appVersion` (win32-only).
- **A masked error surfaces after each fix.** The `author`-field failure only appeared
  once `parseVersionString` passed. *Expect a fix to reveal the next layer* — dispatch a
  fresh build after each commit rather than assuming one fix is complete.
- **`npm test` backgrounded past the ctx_execute boundary** → 182 phantom `ENOENT`
  failures on vite SSR cache in a cleaned-up MCP tempdir. *If you see a wall of ENOENT on
  temp cache files:* they're not real; re-run with a stable `TMPDIR` and a scoped test
  set.
- **Green `ci.yml` ≠ Electron verified.** The Electron matrix is dispatch-only
  (`ci-electron.yml`); don't assume push/PR CI exercised your Electron commits.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the failing CI run id, `gh` CLI auth, ability to dispatch
`ci-electron.yml` with `legs=win32`, and a local port for the smoke test.

- [ ] Re-verify the reported failure state with `gh run view <id>`; don't trust "out of
      scope."
- [ ] For smoke failures: diff the probe against the current API — repoint to
      `/api/health` (`ok=true`), match the **response shape**, drop obsolete deadlines.
- [ ] Sweep scripts for non-ASCII chars before running.
- [ ] `bash scripts/test-standalone-npm-install.sh --port 18001` locally; let CI catch
      `.ps1`.
- [ ] Map which workflows ran on your sha; name any untested path (Electron lives in
      `ci-electron.yml`).
- [ ] For the version bug: read `@electron/packager/dist/win32.js`; fix `buildVersion`
      **and** win32-only `appVersion` via a TDD'd `build-version.ts` helper.
- [ ] Dispatch `ci-electron.yml legs=win32` after each commit; expect a masked error to
      surface next (here: `author`).
- [ ] Land one commit per layer; poll in short bursts under the RPC ceiling.

**Artifacts produced:** `packages/electron/src/lib/build-version.ts` (+ test),
`packages/electron/src/__tests__/forge-config-windows-version.test.ts`, edits to
`packages/electron/forge.config.ts`, `packages/electron/package.json` (`author` field),
`scripts/test-standalone-npm-install.sh` (recreated) + `.ps1`, `.github/workflows/ci.yml`.
Commits: `b54415e2` (buildVersion), `ee224f1e` (appVersion win32), `d6e9738c` (author).

---

_Generated from session `019e5fb9-54dd-7a28-a8fd-7079e0c2e13c` · `pi-agent-dashboard` · 2026-07-24. Source extract: `/var/folders/qb/m1_q3v6d5bnfzbpmc0dkkqx40000gn/T/facts.XXXXXX.HsqwFKOGHP.md`._
