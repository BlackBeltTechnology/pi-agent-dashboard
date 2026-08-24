---
session: 019f2eae
week: 2026/W27
type: planning
model: "@fast"
premium: true
premium_reason: "heavy steering (9 user prompts)"
upgrade_status: pending
openspec_changes: [fix-openspec-config-read-bundled-node]
proposal_excerpt: "The global OpenSpec profile section in the dashboard Settings panel shows \"not found\" / fails to load the current profile when the dashboard runs as a **bundled Electron app on macOS (and Windows)** — even though the…"
---

# How we did it: Turning two "needs a real macOS bundle" deferred tasks into CI gates — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator opened with a terse, ambiguous question against an attached OpenSpec change
(`fix-openspec-config-read-bundled-node`):

> "Is it possible to make CI tests for thats?"

The *real* objective — which only became clear through the steering turns — was: **take
the two tasks that the change had deferred as "needs an affected macOS bundle to verify"
and get them under automated CI coverage instead of relying on a manual check.** The fix
itself (node-wrapping the `openspec` shebang so a stripped-PATH bundled-Electron process
can still resolve `node`) was already landed and unit-tested; the gap was that its
*end-to-end* proof and its *bundle-launch* proof both lived only in a human's hands. The
finished artifact is (a) a new integration test that drives the real runner with an empty
`PATH`, and (b) an updated proposal + `tasks.md` documenting a three-layer CI strategy.

## 2. TL;DR playbook

1. **Ground before answering.** Open the attached change's `tasks.md`/`design.md` and the
   existing test files; find out what's *already* CI-covered before claiming a gap.
2. **Split "deferred" into logic vs. environment.** Ask: is the deferred item the *logic*
   (testable on any host) or the *bundle topology* (needs a GUI runner)? They route to
   different test layers.
3. **Reproduce the failing environment, not the failing app.** The bundled-Electron bug is
   really "spawn with `PATH=""`". Write an integration test that spawns the real recipe with
   `env: { PATH: "" }` — no bundle needed.
4. **Add a CONTROL case.** Spawn the raw shebang with the stripped PATH and assert it exits
   127. This proves the failure is real in-env, not host luck, so the fixed path's pass is
   meaningful.
5. **Run tests with the isolation guard:** `HOME=$(mktemp -d) npx vitest run <file>`, then
   confirm green under the full `npm test` harness for the package.
6. **Find the existing GUI-runner harness** for the bundle-launch item — don't invent
   infra. Here `qa/tests/08/09-electron-*-launch.sh` already direct-exec the inner Mach-O
   (the exact stripped-PATH topology) and already run in CI via `_electron-build.yml`.
7. **Extend, don't rebuild:** the bundle smoke just needs a `curl /api/openspec/config`
   assertion added to a step that already runs on real macOS/Linux runners.
8. **Commit surgically.** Stage only your files by name; leave unrelated working-tree changes
   untouched. Update the proposal + `tasks.md`, `openspec validate --strict`, commit.

## 3. How the collaboration unfolded

**Phase 1 — Discovery / grounding (Prompt 1).** Instead of writing tests immediately, the AI
read the change's tasks and the existing test suite (`node-script-argv-matrix.test.ts`,
`openspec-unix-node-wrap.test.ts`, route-level 502/no-cache tests). It reported the honest
finding: the two *defects* were already CI-gated; only two items were deferred (1.2 capture
`pickNodeForServer` on a real bundle; 5.5 rebuild bundle + open Settings). This reframed the
vague question into a precise one. *Why it worked:* answering "what's already covered" first
prevents building a redundant test.

**Phase 2 — Integration test against real code paths (Prompts 2–3, "yes" / "first rebase").**
The AI traced the real spawn machinery — how the runner discovers the registry via a
`globalThis` symbol, the exact `OPENSPEC_CONFIG_LIST` recipe argv, `run`/`runAsync`/
`configListAsync`. It built a test that mirrors the managed-install topology (a fake managed
`openspec` package with a `#!/usr/bin/env node` shebang reached through a `.bin/openspec`
**symlink**, published on the `globalThis` registry symbol) and drives the **real production
recipe** with `env: { PATH: "" }`. *Decision point:* it noticed `configListAsync` doesn't
accept an `env` override, so that path would pass trivially even pre-fix — it **removed** that
assertion to keep the suite honest, keeping only `run`/`runAsync` which actually inject the
empty PATH. A CONTROL spawn of the raw symlink asserts exit 127.

**Phase 3 — Git hygiene (Prompts 3–5, "rebase" / "commit").** Repeatedly the human asked to
rebase/commit; each time the AI checked state first and found `develop` already in sync (0
behind / 0 ahead) — so it reported "nothing to rebase" rather than performing a no-op, and
staged **only its two files** by name, explicitly leaving unrelated tree changes
(`manage-flows/SKILL.md`, `groups.json`, `b05_*.txt`) untouched.

**Phase 4 — Bundle-smoke feasibility (Prompts 6–7).** For the *bundle-launch* deferred item,
the AI investigated `qa/` and discovered `08`/`09-electron-*-launch.sh` already direct-exec
the inner Mach-O (so `process.execPath` **is** the Electron binary with a stripped GUI PATH)
and already run in CI on `macos-14`, `macos-15-intel`, `ubuntu-latest`, `ubuntu-24.04-arm`
via the reusable `_electron-build.yml`, called from `ci-e2e-electron.yml` (PRs),
`ci-electron.yml` (dispatch), `publish.yml`. Conclusion: the exact failing topology *already
runs in CI* — a new `/api/openspec/config` assertion just rides the existing step.

**Phase 5 — Proposal update + commit (Prompts 8–9).** The AI added a "CI coverage"
subsection to `proposal.md` (three-layer strategy: unit+runner integration every PR; bundled
Electron launch smoke on GUI runners; Playwright Docker harness explicitly *not a fit*), added
task **5.6**, ran `openspec validate --strict`, and committed only the two proposal artifacts.

## 4. Prompts that worked

- **Goal prompt — "Is it possible to make CI tests for thats?"** Weak on its own (typo,
  ambiguous "that"), but it worked *because an OpenSpec change was attached* — the AI had a
  concrete artifact to ground in. **Stronger rewrite:** *"For change
  `fix-openspec-config-read-bundled-node`, the two deferred tasks say they need a real macOS
  bundle. Which can be turned into CI tests without a bundle, and how?"*
- **"yes"** — a high-leverage unlock: after the AI laid out the plan, one word authorized the
  whole integration-test build. Effective *because the AI had already presented a concrete
  plan to say yes to.*
- **"There are deferred tests. Is it possible to create ones as Smoke / QA / E2E tests?"** —
  the best steering prompt: it named the exact test *layers* to consider, which pushed the AI
  to find the existing QA harness rather than propose new infra.
- **"Update proposal" / "commit"** — short, effective because the work was already done and
  the AI knew exactly which files were in scope.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Answer the vague "CI tests for that?" broadly | Attaching the OpenSpec change so the AI grounds in real tasks | Always name the change + the specific deferred tasks in the goal prompt |
| Treat "rebase"/"commit" as commands to execute blindly | (AI self-corrected) check git state first, report "already in sync, nothing to rebase" | State up front: "verify state before any rebase/commit; no-op if clean" |
| Risk sweeping unrelated tree changes into the commit | Implicitly expecting surgical commits | Say "commit ONLY my files, leave unrelated working-tree changes untouched" |
| Consider only unit tests | "as Smoke / QA / E2E tests?" — naming the layers | Ask for the test *layer* explicitly when logic vs. environment matters |
| (Nearly) keep a trivially-passing assertion (`configListAsync` w/o env override) | AI caught it — but reviewer must watch for it | Demand a CONTROL case that FAILS pre-fix so a green result is meaningful |

## 6. Skills, tools & memory created — and why they're effective

No skill or memory was created this session. But the workflow is clearly repeatable and a
skill **should** be captured:

- **Proposed skill: "prove-a-bundled-electron-bug-in-CI-without-a-bundle."** It would encode
  the core move — *reduce a bundle-only failure to its environmental essence (`PATH=""` /
  `ELECTRON_RUN_AS_NODE` topology), reproduce that in a plain vitest integration test with a
  CONTROL case, then find the existing GUI-runner QA harness (`qa/tests/08/09`,
  `_electron-build.yml`) to gate the remaining launch-only proof.* **Why effective:** it turns
  "deferred, needs a Mac" into a deterministic per-PR gate and removes a recurring manual step.
  **Invoke it** whenever a change defers a task as "needs a real bundle/GUI runner."

## 7. Pitfalls & dead ends

- **`configListAsync` can't take an `env` override** → a test routed through it passes even
  *before* the fix (false green). If you want to exercise stripped-PATH, drive `run`/`runAsync`
  which accept an `env`, and drop the path that can't inject PATH.
- **Missing HOME isolation** → the first `npx vitest run` failed the test-isolation guard. Fix:
  `HOME=$(mktemp -d) npx vitest run <file>`. Then re-run under full `npm test` for the package
  (which sets HOME correctly) to confirm no regression.
- **"rebase"/"commit" no-ops** → after committing, `git rev-list --left-right --count` may show
  `0 0` because the commit already landed on `origin/develop` via a fetch. Inspect refs before
  assuming work is lost; don't perform an empty rebase.
- **Don't invent CI infra for the bundle proof** → the GUI-runner harness already exists and
  already runs on the failing topology; extend it with one assertion instead.
- **The Playwright `tests/e2e/` Docker harness is the wrong topology** for this bug — it does
  not direct-exec the Mach-O, so it won't reproduce the stripped-PATH failure.

## 8. Reproduce it faster — checklist

- [ ] Open the attached change's `tasks.md`/`design.md`; list what's already CI-covered.
- [ ] For each deferred task, classify: **logic** (host-testable) vs. **bundle topology**
      (GUI runner).
- [ ] Logic item → write a vitest integration test that spawns the real recipe with
      `env: { PATH: "" }`, mirroring the managed-install topology (shebang bin via `.bin`
      symlink, registry on the `globalThis` symbol).
- [ ] Add a CONTROL case (raw shebang + stripped PATH → exit 127).
- [ ] `HOME=$(mktemp -d) npx vitest run <file>`, then confirm green under `npm test` for the package.
- [ ] Bundle item → locate the existing GUI-runner smoke (`qa/tests/08/09-electron-*-launch.sh`,
      wired via `_electron-build.yml`) and add a `curl /api/openspec/config` assertion.
- [ ] Update `proposal.md` (CI-coverage subsection) + add the smoke task to `tasks.md`;
      `openspec validate <change> --strict`.
- [ ] Commit ONLY your files by name; leave unrelated tree changes untouched.

**Key inputs:** the OpenSpec change name + its deferred task IDs; repo at `develop`.
**Artifacts produced:**
`packages/shared/src/platform/__tests__/openspec-runner-stripped-path.integration.test.ts` (new),
`openspec/changes/fix-openspec-config-read-bundled-node/tasks.md` (tasks 5.4a + 5.6),
`openspec/changes/fix-openspec-config-read-bundled-node/proposal.md` (CI coverage).

---

_Generated from session `019f2eae-d65a-7e2e-97dd-61b12a3fb249` · `pi-agent-dashboard` · 2026-07-05. Source extract: deterministic facts sheet from `extract_session.ts`._
