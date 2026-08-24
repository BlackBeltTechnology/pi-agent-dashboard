---
session: 019f24a4
week: 2026/W27
type: development
model: "@fast"
premium: true
premium_reason: "created 0 skill(s) / 1 memory(ies); heavy steering (6 user prompts); large facts sheet (~14837 tok)"
upgrade_status: pending
openspec_changes: [filter-oauth-incompatible-models, add-playwright-e2e]
proposal_excerpt: "Dashboard model proxy's `/v1/models` advertises every model pi-ai knows for any provider that has *some* credential, but only filters at provider granularity (`hasAuth(provider)`). When the linked credential is OAuth…"
---

# How we did it: Filter OAuth-incompatible models from the proxy — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened not with a task but with a challenge to the spec: **"Is there anything to clarify?"** The operator had an OpenSpec change already drafted (`filter-oauth-incompatible-models`) and wanted the AI to *pressure-test the proposal against the real code before implementing*. The real objective, which sharpened across the steering turns, was end-to-end: **make the dashboard model proxy's `/v1/models` (and `find()`) filter models by credential-kind × model-id — not just provider presence — so OAuth-only Anthropic credentials stop advertising legacy snapshot models pi-ai can't route, then implement it, prove it against a real Docker container, and ship the PR to `develop`.**

## 2. TL;DR playbook

1. **Before writing any code, ask the AI to verify the proposal/design/tasks against the actual source.** It found 3 wrong assumptions (an impossible "both oauth + api_key" credential state, a "diagnostics endpoint already exists" claim that was false, and two minor factual errors). Fix the spec artifacts first.
2. **Run `/skill:openspec-apply-change <name>`** — from the *main repo* skill root (worktree convention), not the checkout.
3. **Let the AI gather wiring context in parallel** (route registration, auth shape, pi-ai model ids) before touching code; approve its justified file-placement deviation (sibling admin-route file instead of the task's literal filename).
4. **Implement core + tests**, run scoped `vitest` with an ephemeral `HOME=$(mktemp -d)`, then the full `npm test` gate.
5. **Ask: "Can the manual smoke tasks be automated as Playwright/Docker E2E?"** — this unlocked converting 6.2/6.3 into a real spec.
6. **Steer with "Use system browser against docker"** — add an opt-in `PW_SYSTEM_CHROME` path so no bundled chromium download is needed; verify against a *rebuilt* container.
7. **Ship with `ship-change` skill**: verify gate → archive+sync specs → PR → watch CI → triage CodeRabbit → merge → clean up worktree.

## 3. How the collaboration unfolded

**Phase 1 — Adversarial spec review (Discovery).** The AI read proposal + design + tasks, then grep-checked each claim against `internal-auth-storage`, the routes file, and a live `auth.json`. It surfaced a contradiction: the proposal said "if both oauth and api_key present, include it," but `auth.json` keys **one** credential per provider (single `type` field), so that state is unrepresentable — and the design's `canRouteModel(model, cred)` correctly had no "both" branch. **Decision point:** the operator chose to keep the diagnostic surface but fix its framing. The AI applied fixes across all four artifacts and re-validated.

**Phase 2 — Implementation (Generate).** New `oauth-compat.ts` (an `OAUTH_INCOMPATIBLE` override table of 11 legacy Anthropic snapshots + `isOauthIncompatible()`); `internal-registry.ts` gained an `oauthCompatible?` flag (shallow-copied so pi-ai's shared model objects aren't mutated), a private `canRouteModel()`, and a `getAllAnnotated()` diagnostic accessor. **Decision point:** the AI noticed `registerModelProxyRoutes` is registered on *both* the main app and the optional second proxy port, so it put the new diagnostics route in a **sibling admin-route file** (mirroring `model-proxy-refresh-routes.ts`) rather than the task's literal target — a justified deviation it flagged explicitly.

**Phase 3 — Verify + docs.** Scoped vitest (14 pass) → full suite (8474 passed) → Biome on changed files (0 errors). Docs under `docs/` were delegated to a general-purpose subagent in caveman style; the AI caught and corrected an alphabetical mis-placement of a file-index row itself.

**Phase 4 — E2E automation (the "not checked tasks" arc).** Prompted to automate the two manual smokes, the AI investigated the Docker harness rather than guessing, discovered it *already seeds* the exact Anthropic-OAuth-only precondition, and found the one gap (no proxy API key). It seeded a `modelProxy.apiKeys[]` entry (`hash = sha256(fixed key)`) and wrote an HTTP-only Playwright spec (`request` fixture, no page).

**Phase 5 — Real proof against Docker.** First run against the warm container **failed** — because the image bundles server source at build time and was stale. The AI diagnosed it precisely (harness `test-entrypoint.sh` change took effect via bind-mount, but compiled server code was old), rebuilt with `--build`, and got 23→15 models, legacy id → 404, diagnostics `oauth-incompatible`. Then ran the committed Playwright spec via **system Chrome** (`PW_SYSTEM_CHROME=1`), 3 passed.

**Phase 6 — Ship (`ship-change`).** Verify gate → `openspec archive` (sync + archive in one) → commit (excluding an unrelated pre-existing `manage-flows.md` change) → PR #215 → CI. The PR was **CONFLICTING/DIRTY**, which blocks CI from starting. Merging develop revealed it had **independently shipped the same capability as `PW_CHANNEL`** — the DRY resolution was to drop the duplicate `PW_SYSTEM_CHROME` and adopt develop's. 3 post-merge local test failures were all diagnosed as env/stale/flake outside the diff; clean CI arbitrated green. CodeRabbit posted 4 findings → 3 fixed, 1 skipped as an empirically-verified false positive. Squash-merged, branches + worktree cleaned up.

## 4. Prompts that worked

- **Goal prompt — "Is there anything to clarify?"** Effective because it invited the AI to *challenge the spec before implementing* rather than blindly execute. This is the highest-leverage move in the whole session: it caught an unrepresentable requirement and a false "endpoint exists" claim before a line of code was written. **Reusable stronger version:** *"Before implementing, verify every claim in proposal.md/design.md/tasks.md against the actual code and list any that don't match."*
- **"/skill:openspec-apply-change filter-oauth-incompatible-models"** — hands the AI the disciplined apply loop.
- **"Is it possible to make playwright and docker tests for tasks not checked?"** — a short, open question that unlocked converting deferred manual smokes into real automated coverage. High leverage.
- **"Use system browser against docker"** — one line that set a concrete constraint (no chromium download) and forced real end-to-end proof instead of static verification.
- **"USe ship-change skill"** — delegates the entire land-it pipeline to a known-good procedure.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Treat drafted spec claims as ground truth | Opening with "Is there anything to clarify?" | Always ask the AI to verify proposal/design/tasks vs. code first |
| Stop at "statically verified" for manual smoke tasks | "Is it possible to make playwright and docker tests…?" | State up front that manual/QA tasks should be automated as E2E where feasible |
| Consider a container run proof without checking image freshness | "Use system browser against docker" (forcing a real run) | Remember: the Docker harness bundles server source at **build** time — rebuild with `--build` after local server changes |
| Leave shipping ad hoc | "USe ship-change skill" | Invoke the `ship-change` skill so archive/CI/CodeRabbit/cleanup follow one procedure |

Also worth noting: the AI **correctly refused to auto-fix** the CodeRabbit auth finding (ship-change forbids auto-applying auth changes) and instead reasoned it out as a false positive — good default to preserve.

## 6. Skills, tools & memory created — and why they're effective

- **Memory saved (project · tool-quirk):** *"E2E-against-Docker for local SERVER-CODE changes: the harness reuses the warm `pi-dashboard:local` image, which bundles server source at build time (Dockerfile `COPY packages` + `npm run build`)."* This is the single most valuable takeaway — it captures the exact gotcha that produced a false "it doesn't work" during Phase 5. **Invoke/recall it** whenever verifying local server changes against the Docker harness: you MUST rebuild the image (`--build`), or you're testing stale compiled code even though bind-mounted files (like `test-entrypoint.sh`) update live.
- **Subagents used** (general-purpose, ×3): delegated all `docs/` file-index writes in caveman style per the Documentation Update Protocol, keeping the main context lean.
- **Skill worth creating:** an "E2E via system Chrome against the running Docker harness" recipe — the `PW_SYSTEM_CHROME` / `PW_E2E_USE_RUNNING=1` / rebuild-first sequence recurs and is easy to get wrong. (Develop later generalized this as `PW_CHANNEL`.)

## 7. Pitfalls & dead ends

- **Stale warm Docker image →** first E2E run showed the filter absent, chat 500 not 404, diagnostics falling through to the SPA. Fix: `docker compose up --build` to rebuild from worktree source. The bind-mounted `test-entrypoint.sh` *did* update (proxy key worked, 200 not 401) — only compiled server code was old.
- **Duplicate capability collision on merge →** develop independently shipped `PW_CHANNEL` while this branch built `PW_SYSTEM_CHROME`. Don't fight it — adopt the upstream general version and drop your duplicate (DRY). Union the CHANGELOG.
- **DIRTY PR blocks CI →** a conflicting PR never starts CI. Merge develop and resolve first, then CI runs.
- **Post-merge local test failures were false alarms →** `monaco-chunk-size` (stale pre-merge `dist/`, fixed by fresh build), `node-electron-resolution` (host `PI-Dashboard.app` leaking into the resolver; passes on clean CI), `event-wiring-worktree-rekey` (flaky under parallel load; passes 2/2 isolated). Treat the clean CI runner as authoritative.
- **Scoped vitest needs an isolated HOME →** run with `HOME=$(mktemp -d)` to avoid reading real user state.
- **Worktree removal from inside itself →** the dashboard endpoint returned generic `git_failed`; the git CLI from the parent cwd succeeded. Run cleanup from the parent, not the worktree being removed.
- **CodeRabbit "pass" can be a rate-limited ACK →** verify it actually reviewed ("Actionable comments posted: N") before trusting green; and it caches an already-reviewed diff, so re-runs may report "no findings."

## 8. Reproduce it faster — checklist

Inputs to have ready:
- The OpenSpec change drafted at `openspec/changes/<name>/` (proposal, design, tasks, spec delta).
- A live `auth.json` with an OAuth-only provider credential (to confirm the schema shape).
- Docker available; system Chrome installed (for the `PW_SYSTEM_CHROME` lane).

Steps:
1. [ ] Ask the AI to verify proposal/design/tasks against the actual code; fix mismatched claims in all artifacts; `openspec validate --strict`.
2. [ ] `/skill:openspec-apply-change <name>` from the main-repo skill root.
3. [ ] Implement override table + registry filter + sibling diagnostics route; shallow-copy shared pi-ai model objects before flagging.
4. [ ] Tests: scoped `vitest` with `HOME=$(mktemp -d)` → full `npm test` → Biome on changed files.
5. [ ] Automate the manual smokes as an HTTP-only Playwright spec (`request` fixture); seed a `modelProxy.apiKeys[]` entry (`hash = sha256(fixed key)`) in `docker/test-entrypoint.sh`.
6. [ ] Verify against a **rebuilt** container (`docker compose up --build`); run the spec via `PW_SYSTEM_CHROME=1 PW_E2E_USE_RUNNING=1`.
7. [ ] `ship-change` skill: verify → `openspec archive` → PR → merge develop if DIRTY → watch CI → triage CodeRabbit → squash-merge → clean up branch + worktree from the parent cwd.

Final artifacts produced:
- `packages/server/src/model-proxy/oauth-compat.ts` (+ test)
- `packages/server/src/model-proxy/internal-registry.ts` (filter + `getAllAnnotated()`)
- `packages/server/src/routes/model-proxy-diagnostics-routes.ts` (+ test) + `server.ts` wiring
- `tests/e2e/model-proxy-oauth-filter.spec.ts`; `docker/test-entrypoint.sh` seed
- New capability spec `openspec/specs/model-proxy-credential-routing/spec.md`
- PR [#215](https://github.com/BlackBeltTechnology/pi-agent-dashboard/pull/215) — merged (squash `bd6128a04`) into `develop`

---

_Generated from session `019f24a4` · `pi-agent-dashboard/.worktrees/os-filter-oauth-incompatible-models` · 2026-07-02. Source extract: deterministic facts sheet._
