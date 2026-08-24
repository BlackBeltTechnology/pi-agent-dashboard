---
session: 019f8070
week: 2026/W30
type: development
model: "@fast"
premium: true
premium_reason: "large facts sheet (~15696 tok)"
upgrade_status: pending
openspec_changes: [add-nightly-verdaccio-build]
proposal_excerpt: "Every artifact this project ships — 31 npm packages + a 6-leg Electron installer matrix — is only ever exercised end-to-end at release time, against the public npm registry. There is no scheduled build that an…"
---

# How we did it: Cutting the pi-dashboard 0.6.0 release — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal:
> ship a monorepo release when the CHANGELOG is stale and the release pipeline has
> latent bugs.

---

## 1. Goal (the ask)

The operator wanted to **prepare and cut a pi-dashboard release**. The opening prompt:

> *"I would like to prepare the release of pi-dashboard. From start is a best practice
> to make the version updates everywhere in code base?"*

The *real* objective, once it unfolded, was much bigger than a version bump: promote
`0.5.4 → 0.6.0` across a **~33-package npm workspace monorepo**, curate a CHANGELOG
that had drifted **~200 changes behind over an 8-week / 906-commit cycle**, and then
**drive a broken release pipeline to green** through four distinct CI blockers
(stale gate floor, orphaned Windows import, npm-version tightrope, provenance +
trusted-publisher metadata gaps). It ended as a partial success — 21 of 32 packages
published — with the tail blocked on an npmjs.com web-UI action only the human can do.

The embedded lesson answering the literal question: **no, you never hand-edit versions
everywhere.** The repo has a canonical, scripted procedure (the `release-cut` skill).

## 2. TL;DR playbook

1. **Load the canon first.** Read `.pi/skills/release-cut/SKILL.md` + `docs/release-process.md`
   before touching anything. Never hand-bump versions across the monorepo.
2. **Run the pre-flight gates** (clean tree · on `develop` · not behind · `npm test` ·
   `npm run build` · `node scripts/verify-release-deps.mjs`). Stop on the first red.
3. **Reconcile the working tree honestly.** `git fetch` for ground truth (the local
   `[ahead N]` ref is stale) — commit legit pending work as its own commits *before*
   the release commit.
4. **Audit CHANGELOG drift by the numbers.** `git log v<last>..HEAD --oneline`; count
   `feat:`/`fix:`/`perf:` scopes vs documented bullets. If hundreds behind, **stop and
   flag it** — pragmatic curation, delegate grouped drafting to a subagent.
5. **Bump with the script, not by hand:**
   `npm version <v> --workspaces --include-workspace-root --no-git-tag-version` →
   `node scripts/sync-versions.js` → `npm install --package-lock-only --no-audit --no-fund`.
6. **Validate `develop` via the smoke matrix BEFORE the tag exists** (push branch first,
   dispatch smoke, wait for 7/7 green). A pre-tag failure = no dangling tag to revoke.
7. **Tag HEAD, not the release commit,** if any gate-fix landed after it — the
   release-gate re-runs against the *tagged tree*.
8. **Watch the Release workflow through publish.** Treat each failure as a diagnosis:
   read the failing job log, isolate root cause, prove it's infra-vs-content, fix
   minimally, force-move the tag, re-run.

## 3. How the collaboration unfolded

Six phases across a ~15.5-hour elapsed session (132 bash calls, 13 edits, 11 `ask_user`
checkpoints, 1 subagent). The model ran as **opus-4** at `high` thinking — this is a
**judgment-heavy, high-stakes** workflow, not a mechanical one.

- **Phase 1 — Canon + pre-flight.** Read `release-cut` skill, answered the "bump
  everywhere?" question with the scripted procedure, ran the six pre-flight gates.
  *Why it worked:* refusing to hand-edit and grounding in the skill prevented drift bugs.
  *Decision point:* pre-flight gate 1 (clean tree) failed → the AI **stopped and surfaced
  pending state** instead of stashing silently.
- **Phase 2 — Tree reconciliation.** `git fetch` revealed **4 unpushed commits** (not the
  stale `[ahead 1]`). Each triaged as legit; committed pending docs as their own commit.
  *Why it worked:* ground-truth-before-action avoided sweeping unrelated work into the
  release commit.
- **Phase 3 — Blocker #1 + CHANGELOG.** `verify-release-deps` false-positived (stale
  `0.74.0` substring floor vs `^0.80.10` pin) → fixed the floor as its own commit. Then
  discovered the **906-commit / ~200-change** CHANGELOG gap → **stopped and flagged**,
  chose pragmatic curation, **delegated grouped drafting to a subagent**, merged
  programmatically (79 bullets), promoted `[Unreleased] → [0.6.0]`.
- **Phase 4 — Version bump.** Scripted bump of root + 35 package.json to 0.6.0, synced 44
  inter-package specifiers, regenerated lockfile. A transient rollup hiccup during the
  bump was proven **non-reproducible** (client build passes standalone) rather than
  chased.
- **Phase 5 — Pre-tag smoke.** Pushed `develop` (branch only), dispatched the 7-leg smoke
  matrix. Windows leg failed on an **orphaned `defaultGetCmdline` import** (deleted by
  PR #342) → surgical probe fix. Second run flaked (5s Windows web-UI timeout) → re-ran
  → **7/7 green**. Tagged **HEAD** (carries the smoke fix), pushed `v0.6.0`.
- **Phase 6 — Release-workflow whack-a-mole.** The Release run surfaced blockers in
  sequence: `ci-checks` flake (leaked TanStack timer in `ChatView.test.tsx`) → re-run;
  publish `EALLOWGIT` (git dep + hardened npm) → the **npm-version tightrope**
  (`@latest` blocks git deps; `11.5.1` has the lightningcss optional-dep bug; **`11.12.1`**
  is the known-good version that shipped v0.5.4); provenance `422` empty `repository.url`
  on `bus-client` + `kb` → added the field; then `document-converter` **E404** =
  trusted-publisher/repo-URL mismatch on npmjs.com — a **human-only web-UI fix**. Final:
  21/32 published, tail handed to the operator.

## 4. Prompts that worked

- **The goal prompt** — *"prepare the release… is it best practice to make version updates
  everywhere?"* Effective because it **asked the meta-question first** instead of demanding
  a hand-bump, which let the AI ground the whole run in the canonical `release-cut` skill.
  Stronger version: *"Cut the pi-dashboard release following the release-cut skill; confirm
  each pre-flight gate with me before proceeding."*
- **High-leverage follow-up — `"yes"`** — a single token that unlocked the entire cut once
  the AI had laid out the scripted plan. Works only because the plan was explicit first.
- **Steering — `"patch the skill and watch release"`** — folded the session's hard-won
  lessons (package count, substring-gate false-positive, tag-HEAD guardrail) back into the
  `release-cut` skill *while* the release ran. Effective: it made the pain reusable.
- **Steering — the E404 domain correction** — the operator supplied the missing insight
  (*"Maybe URL is not okay? …trusted"*) that redirected the AI from "TP not configured" to
  the actual repo-URL/workflow-filename mismatch diagnosis. Effective: human domain
  knowledge closed a gap automation couldn't.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|---|---|---|
| Ask whether to hand-bump versions | (AI self-corrected) — refused, used the script | State up front: "use `release-cut`, never hand-edit versions" |
| Proceed with a dirty tree / stale `[ahead 1]` | Nothing — AI stopped & `git fetch`ed for ground truth | Always `git fetch` before reading ahead/behind counts |
| Trust the 24-entry CHANGELOG for a 2-month release | "yes" (to pragmatic curation) after the AI flagged the ~200 gap | Curate CHANGELOG per-change during the cycle, not at release |
| Tag the release commit | (AI self-corrected) — tagged HEAD b/c smoke fix landed after | Rule: tag HEAD when any gate-fix lands after the release commit |
| Guess npm versions one CI cycle at a time (~20 min each) | (AI self-corrected) — found the exact version that shipped v0.5.4 | Pin the last known-good npm; don't `@latest` in publish |
| Conclude "TP not configured" on E404 | Operator: "maybe the URL is wrong? …trusted" | E404 on publish ⇒ TP repo-URL / workflow-filename mismatch, not absence |

Scope quality bars the operator imposed implicitly: **honesty** (no dishonest 24-entry
changelog, no dumping 200 raw subjects), **clean release commit** (only CHANGELOG +
version/lock files), and **no dangling tags** (validate before tagging).

## 6. Skills, tools & memory created — and why they're effective

- **`release-cut` skill patched** (the main reusable asset). Captured three concrete
  lessons this run exposed: (1) the real publishable **package count (~33, not "10")**;
  (2) the **`verify-release-deps` substring false-positive** on every pi bump; (3) the
  **tag-HEAD guardrail** when a gate-fix lands after the release commit. *Effective:* the
  next operator inherits the traps instead of re-discovering them across 20-min CI cycles.
  *Invoke:* every release cut.
- **CHANGELOG drafting via `general-purpose` subagent.** Delegating the grouped-bullet
  drafting kept the main context focused and quality high on ~394 undocumented commits.
  *Effective:* isolates a bounded, mechanical-but-voluminous task. *Invoke:* whenever the
  CHANGELOG is dozens+ of changes behind.
- **Recommended follow-ups the session surfaced (not yet created):** a `ci-troubleshoot`
  entry for the **`EALLOWGIT` / npm-version tightrope** (`@latest` blocks git deps;
  `11.5.1` breaks lightningcss; `11.12.1` is known-good), and a **provenance metadata
  pre-check** (every publishable package needs a matching `repository.url`).

## 7. Pitfalls & dead ends

- **Stale `[ahead 1]` ref** → it was actually 4 unpushed commits. *Always `git fetch`
  before trusting ahead/behind.*
- **`verify-release-deps` substring gate** → false-positives whenever the pi pin moves
  past the hardcoded floor string. *Bump the floor; the gate does no real semver.*
- **Orphaned import after a deletion PR** → `defaultGetCmdline` / `editor-pid-registry.js`
  was deleted by #342 but the Windows smoke probe still imported it; only the Windows leg
  runs it, so PR CI never caught it. *When a smoke matrix only runs at release time,
  latent import breakage surfaces at the worst moment — drop the dead assertion surgically.*
- **npm version tightrope in the publish job** → `@latest` now blocks git deps
  (`EALLOWGIT`), `11.5.1` has the lightningcss optional-native-dep bug, **`11.12.1`** is
  the version that shipped v0.5.4 and works end-to-end. *Pin the known-good, don't chase.*
- **Empty `repository.url`** → provenance-backed publish returns `422`. *Every publishable
  package needs `repository.url` matching the repo.*
- **E404 on publish** ≠ "package missing" → it's the OIDC/trusted-publisher **repo-URL or
  workflow-filename mismatch** on npmjs.com (npm returns 404, not 403, to an unauthorized
  publisher). *Human web-UI action; automation can't fix it.*
- **`set -euo pipefail` in the publish loop** aborts on the first failing package, so the
  gap-report never enumerates all TP gaps — you discover them one 20-min cycle at a time.
- **CI flake:** a TanStack react-virtual `setTimeout` in `ChatView.test.tsx` fires after
  jsdom teardown (`window is not defined`) → uncaught exception fails the run despite
  10926 passing tests. *Re-run the job; it's timing, not a regression.*

## 8. Reproduce it faster — checklist

**Inputs to have ready:** clean `develop` checkout, `gh` authed, npm publish rights /
trusted-publisher configured on npmjs.com, ~1–2 hrs for CI cycles.

- [ ] Read `release-cut` skill + `docs/release-process.md`. Never hand-bump versions.
- [ ] Pre-flight: clean tree · on `develop` · `git fetch` (not behind) · `npm test` ·
      `npm run build` · `node scripts/verify-release-deps.mjs`. Fix the gate floor if it
      false-positives on the pi pin.
- [ ] Commit any legit pending work as its own commits first.
- [ ] Audit CHANGELOG: `git log v<last>..HEAD --oneline`. If dozens+ behind, delegate
      grouped drafting to a subagent; merge programmatically; promote `[Unreleased] → [X.Y.Z]`.
- [ ] Bump: `npm version <v> --workspaces --include-workspace-root --no-git-tag-version`
      → `node scripts/sync-versions.js` → `npm install --package-lock-only`.
- [ ] Pre-check every publishable package has `repository.url`.
- [ ] Commit `chore(release): vX.Y.Z` (CHANGELOG + version/lock only).
- [ ] Push `develop` (branch only) → dispatch 7-leg smoke → wait for 7/7 green.
- [ ] Tag **HEAD** (`v<v>`), push. Watch the Release workflow through publish.
- [ ] On publish failure: read the job log, prove infra-vs-content, fix minimally,
      force-move the tag, re-run. Pin npm to the known-good version (`11.12.1`), not `@latest`.

**Artifacts produced:** `chore(release): v0.6.0` commit + `v0.6.0` tag; CHANGELOG with
`[0.6.0]`; 35 package.json at 0.6.0; fixes to `scripts/verify-release-deps.mjs`,
`scripts/windows-introspection-smoke.ts`, `scripts/_windows-introspection-probe.ts`,
`.github/workflows/publish.yml`, `packages/{bus-client,kb}/package.json`; patched
`release-cut` skill. **21/32 packages live on npm; tail blocked on npmjs.com TP config.**

---

_Generated from session `019f8070-3a92-7bb3-8199-0edabd0347b1` · `pi-agent-dashboard` · 2026-07-20. Source extract: `/tmp/facts-release060.md`._
