# Tasks

## 1. ship-it — primary integration (step 2.5)

- [x] 1.1 Insert step **2.5 "Integrate develop"** in `.pi/skills/ship-it/SKILL.md` between step 2 (apply) and step 3 (harness): `git fetch origin develop` + `git merge --no-edit origin/develop` (remote ref). State the load-bearing rationale — harness must validate the merged tree `T1`. → verify: step numbering coherent; harness step reads the post-merge tree.
- [x] 1.2 Add conflict-abort + STOP guard (unresolved merge → abort, report, do not enter the harness). Cross-reference the existing `AGENTS.md` / `package-lock.json` recipes rather than duplicating them. → verify: guard names the abort path.
- [x] 1.3 Update the ship-it mermaid/flow + Guardrails to name "merge before harness; merge not rebase". → verify: diagram shows 2.5 before 3.

## 2. ship-change — backstop integration (step 1.5)

- [x] 2.1 Insert step **1.5 "Integrate develop"** in `.pi/skills/ship-change/SKILL.md` between step 1 (defer) and step 2 (gate): same `origin/develop` merge, idempotent. Note it is a no-op under ship-it and the true integration point standalone. → verify: gate (step 2) runs on the merged tree.
- [x] 2.2 Add a "merge not rebase" rationale line + reuse the existing conflict recipes (union-keep, lock `--theirs`). → verify: no force-push introduced anywhere.
- [x] 2.3 Confirm the CodeRabbit loop (steps 6–8) is left unchanged; add one line: "re-merge in the loop ONLY on `mergeStateStatus=DIRTY`, never per-push." → verify: no per-push merge added.

## 3. Coherence

- [x] 3.1 doubt-driven-review pass on the ordering claim (merge upstream of the strongest gate; ship-it=harness, standalone=vitest). → verify: review notes captured, no unaddressed hole.
- [x] 3.2 `openspec validate integrate-develop-before-ship-gate` passes. → verify: CLI green.

## 4. Manual verification (post-merge)

- [x] 4.1 QA: run `ship-it` on a change whose worktree is behind `develop`; confirm the harness runs against the merged tree and the PR opens `MERGEABLE` (not `DIRTY`). → verify by hand.
