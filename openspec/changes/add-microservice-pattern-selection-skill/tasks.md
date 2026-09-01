## 1. Preconditions — resolve blockers before authoring

- [ ] 1.1 Determine whether `kb init --source <dir>` **appends to** or **replaces** an existing project `sources[]` array (read `packages/kb/src/init.ts`; confirm with a throwaway config in a temp dir). Record the answer in `design.md` Open Question 1.
- [ ] 1.2 If it replaces, define the read-modify-write step-0 procedure instead; either way the outcome must satisfy the spec scenario *"existing project sources are preserved"*.
- [ ] 1.3 Confirm the `kb_*` tools resolve the **project** config for the session cwd (`loadConfig(cwd)` via `getKb`), validating decision D6 before step 0 is written.
- [ ] 1.4 Freeze the tier assignment: re-run the section-measurement over all 55 source pages and commit the resulting slug → `Depth` (A/B/C) manifest as the authoring input. Store the measurement script with the change so drift can be re-detected later.
- [ ] 1.5 Reconcile the frozen manifest against `design.md`'s cluster table — every slug must appear in exactly one cluster, total 55.

## 2. Skill skeleton and router

- [ ] 2.1 Create `packages/eng-disciplines/.pi/skills/microservice-pattern-selection/SKILL.md` with frontmatter `name`, `description`, `license: MIT`, `compatibility`, `metadata`.
- [ ] 2.2 Keep `description` within the repository's 400-character budget enforced by `scripts/check-skill-frontmatter.mjs`, and exclude the sibling skills' trigger verbs ("harden", "instrument", "add metrics", "threat model").
- [ ] 2.3 Write the gate-zero section: more-than-one-deployable / operation-spanning check, with the explicit stop-and-recommend-the-monolith outcome.
- [ ] 2.4 Write the symptom → cluster routing table covering all 17 clusters.
- [ ] 2.5 Write the retrieval procedure as the 4-tier ladder, with step 0 (`ask_user` consent → register → **verify** in resolved config) and explicit fallthrough when no index exists.
- [ ] 2.6 Write the two hand-off lines (`security-hardening`, `observability-instrumentation`).
- [ ] 2.7 Add one compact worked example (problem → gate zero → cluster → recommendation → drawbacks), per design Open Question 2.

## 3. Cluster authoring — highest decision value first

Each task: frontmatter (`cluster`, `kind`, `patterns`), shared context/problem/forces once, one `##` per pattern with `Solution` / `Consequences` / `Use when` / `Avoid when` / `Alternatives` / `Source` / `Depth`, relations as relative links **and** prose.

- [ ] 3.1 `data-ownership.md` (decision, 2)
- [ ] 3.2 `commands-and-consistency.md` (decision+chain, 5) — includes the saga choreography-vs-orchestration sub-choice
- [ ] 3.3 `queries.md` (decision, 2)
- [ ] 3.4 `transactional-messaging.md` (chain, 3) — outbox as prerequisite of tailing | polling
- [ ] 3.5 Re-assess whether `commands-and-consistency.md` should split into commands + event-driven building blocks (design Open Question 3); record the decision either way
- [ ] 3.6 `service-boundaries.md` (decision, 4)
- [ ] 3.7 `architectural-style.md` (decision, 2) — carries the same forces block as gate zero; keep them consistent
- [ ] 3.8 `communication-style.md` (decision + checklist, 4)
- [ ] 3.9 `service-discovery.md` (decision ×2 + prerequisite, 5)
- [ ] 3.10 `deployment.md` (decision, 6)
- [ ] 3.11 `refactoring-to-services.md` (chain, 2)
- [ ] 3.12 `cross-cutting.md` (checklist, 5)
- [ ] 3.13 `observability.md` (checklist, 7) — opens with the `observability-instrumentation` hand-off
- [ ] 3.14 `testing.md` (checklist, 3)
- [ ] 3.15 `ui-composition.md` (decision, 2)
- [ ] 3.16 `external-api.md` (single, 1)
- [ ] 3.17 `reliability.md` (single, 1)
- [ ] 3.18 `security.md` (single, 1) — opens with the `security-hardening` hand-off

## 4. Coverage and format guard

- [ ] 4.1 Add `scripts/check-pattern-cluster-coverage.mjs`: parse every cluster file's `patterns` frontmatter; fail when the union is not 55 distinct slugs or when any slug appears twice.
- [ ] 4.2 Extend the same script to assert card format: every pattern `##` section carries `Solution`, `Consequences`, `Source` (absolute microservices.io URL) and `Depth` ∈ {A,B,C}.
- [ ] 4.3 Assert every `Depth: C` card is a short pointer card, and every externally-sourced trade-off carries the `(not on source page)` annotation.
- [ ] 4.4 Wire the script into `.github/workflows/ci.yml` next to `check-skill-frontmatter.mjs`.
- [ ] 4.5 Add the script's row to `scripts/AGENTS.md` (and its `.AGENTS.md` sidecar if the directory convention requires one).

## 5. Package registration and docs

- [ ] 5.1 Register the skill in `packages/eng-disciplines/package.json` `pi.skills[]`.
- [ ] 5.2 Add one row per shipped file to `packages/eng-disciplines/AGENTS.md` (inline DOX; **no** per-file `*.AGENTS.md` sidecars in the skill directory).
- [ ] 5.3 Add the skills-table row to `packages/eng-disciplines/README.md`.
- [ ] 5.4 Add the microservices.io attribution block to `packages/eng-disciplines/NOTICE`, worded as derivation-of-concepts and distinct from the MIT reproduction entries.
- [ ] 5.5 Verify `npm pack --dry-run` lists `SKILL.md` + all 17 `references/*.md` and no `*.AGENTS.md`.

## 6. Verification against the spec

- [ ] 6.1 Gate zero: give the skill a single-service/single-database problem; confirm it recommends the non-distributed answer and names no cluster.
- [ ] 6.2 Routing: give it a distributed problem per cluster kind; confirm `decision` yields exactly one pattern with rejected alternatives explained, `checklist` presents complements without forcing a choice, `chain` names the prerequisite first.
- [ ] 6.3 Drawbacks: confirm no recommendation is produced without `Consequences` and at least one avoid-when condition.
- [ ] 6.4 Degradation: run the skill with no kb index and no content-indexing tool; confirm it still routes, reads, and recommends.
- [ ] 6.5 Registration: confirm consent-before-write, that declining leaves config untouched and the skill usable, that existing sources survive, and that a re-run does not prompt or rewrite.
- [ ] 6.6 Relations: retrieve a single pattern section in isolation; confirm its alternatives/prerequisites/successors are readable from that text alone.
- [ ] 6.7 Run `node scripts/check-skill-frontmatter.mjs` and the new coverage script; both pass.
- [ ] 6.8 Run `openspec validate add-microservice-pattern-selection-skill`; passes.
