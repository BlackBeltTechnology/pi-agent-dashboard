---
session: 019f2751
week: 2026/W27
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [migrate-file-index-to-agents-tree]
proposal_excerpt: "The repo adapted agent0ai/dox (a recursive per-directory `AGENTS.md` tree) but **kept only its philosophy, not its data structure**. `2026-06-23-add-markdown-knowledge-base` §6d shipped the DOX *tooling* (`kb dox init…"
---

# How we did it: Migrate the file-index splits into the AGENTS.md tree — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened with a deceptively small question: **"Is there anything left in file-index?"** The real objective surfaced across two "yes" confirmations. The repo had already migrated `packages/**` + `src/**` file records into a per-directory `AGENTS.md` tree, but **7 non-source areas** (`docker/`, `scripts/`, `.pi/skills/`, `public/`, `qa/`, `tests/e2e/`, `.github/workflows/`) still lived only in the hand-authored `docs/file-index-*.md` splits — because the migration tooling (`treeRows`, `dox init`) was hardwired to source-code file types only. The true goal became two-phase: **(1)** relocate the existing curated rows into area `AGENTS.md` files byte-for-byte, then **(2)** run a **Tier-1 sync** — fan `@fast` subagents across the *current* source to author rows for every file that had no record yet, closing the coverage gap to zero.

## 2. TL;DR playbook

1. **Ask the scoping question first.** Run `kb dox export`-style row counts per split to prove which areas are tree-sourced vs still hand-authored (`grep -cE '^\| \`' docs/file-index-*.md`).
2. **Read the tooling before promising a "run the script" fix.** `treeRows()` walks `packages/` only; `dox init` matches `.ts/.tsx/.js/.jsx` only; `DEFAULT_EXCLUDE` drops `.pi`/`openspec`. Confirm the target areas are ~99% ignored file types — this is *authoring*, not automation.
3. **Phase 1 — verbatim relocate.** Generate the 7 area `AGENTS.md` deterministically from the split rows (a `/tmp/*.mjs` generator), preserving purposes byte-identical, paths made relative to each file.
4. **Extend the tooling minimally.** Add the new roots to `TREE_ROOTS` in `migrate-runner.ts` (`existsSync`-guarded), add the missing area to `SPLIT_AREAS` (the "docker unassigned" bug), regenerate the rollup, verify row counts preserved.
5. **Commit the verbatim migration as a clean checkpoint** *before* touching content.
6. **Phase 2 — Tier-1 sync.** Compute the coverage gap (files with no row), build a deterministic batch harness, spawn `@fast` subagents in waves to read current source and write reply files.
7. **Merge add-only + verify.** Parse replies, append (never overwrite curated rows), assert exactly one row per file, run a grounding pass for hallucinated identifiers.
8. **Respect the byte cap.** If an area `AGENTS.md` exceeds the 30 KB auto-inject cap, run the *sanctioned* `split-large-agents.mjs` (pull-only sidecars) — never hand-trim.
9. **Green gate:** `tsc --noEmit` + `npm test -w packages/kb` + `openspec validate --strict` + coverage=0-miss, then commit and capture pitfalls into the authoring skill.

## 3. How the collaboration unfolded

**Discovery — what actually remains.** The AI answered "is anything left?" not with a guess but with per-split row arithmetic, cleanly separating *now-generated rollups* (`packages/**`, `src/**`, 100 % tree-sourced) from *genuine leftovers* (`docker/` 20 rows, `.pi/skills`-misc 61 rows, plus strays). Effective because it grounded the scope in counts, not memory.

**Reality check — this reverses a shipped decision.** Before writing anything, the AI opened `migrate-runner.ts:243`, `dox.ts:11/14`, and the `exportRollup` banner, and reported that the machinery is *hardwired to source code*: `treeRows` walks `packages/` only, the walker matches source extensions only, `.pi`/`openspec` are excluded. It surfaced two real paths (A: hand-author area `AGENTS.md`; B: teach the tooling non-source types) and **paused for confirmation**. This is the decision point where the human chose Option A within the change.

**Generate (Phase 1).** A deterministic `/tmp/gen-area-agents.mjs` produced all 7 files with **78 byte-identical rows**. The AI then found and fixed the routing bug: `SPLIT_AREAS` omitted `"docker"`, so the docker split was never loaded (the "19 unassigned" symptom). Row count preserved 20→20; diff was banner + case-sort only.

**Verify + checkpoint.** `tsc` clean, 60 tests, a regression test for the extended roots, and `agentsChain` retrieval confirmed for deep paths. Committed as `c5a4b73b7` — a clean checkpoint before the risky content phase.

**Gather + Generate (Phase 2, Tier-1 sync).** The second "yes … synchronized with current source (Tier 1)" triggered the big move: **~159 files had no row**. The AI checked whether `.pi/skills` entries were real dirs or vendored symlinks (they were real), built a batch harness, and drove **11 `@fast` subagents in 2 waves** to read current source and emit reply files. Curated rows (with `See change:` history) stayed byte-preserved; only the misses were authored.

**Merge + Verify.** Add-only merge, one-row-per-file assertion, a grounding pass (21 flags, all false positives from `key=val` vs `key = val` config formatting — **zero fabrication**), rollup regenerated with a new area→split map, and the 30 KB cap handled via the sanctioned `split-large-agents.mjs` (53 pull-only sidecars). Final gate all green; committed as `cab2bf23b`.

## 4. Prompts that worked

- **The goal prompt** — *"Is there anything left in file-index?"* Weak as written (yes/no framing), but it worked because the AI reflexively answered with counts. **Stronger version:** *"List every area still hand-authored in docs/file-index-*.md (with row counts), and tell me what migrating each into the AGENTS.md tree would actually require — tooling change vs hand-authoring."*
- **High-leverage follow-up** — *"yes. And update agents.md with subagents to be synchronized with current source (Tier 1)."* One sentence unlocked the entire Tier-1 fan-out. The explicit *"with subagents"* + *"current source"* + *"Tier 1"* named the mechanism, the ground truth, and the tier — exactly enough for the AI to build the harness without more back-and-forth.
- **The disambiguating pause** — the AI's own *"Two different scopes here — let me confirm which 'yes' means before touching anything"* was the highest-value move in the session. Bake this in: when a bare "yes" could mean two things, restate both and pick after confirmation.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Treat "migrate to the tree" as a run-the-script job | The AI self-corrected after reading the tooling: it's authoring, not automation | State up front: "the tooling ignores non-source types — expect hand/subagent authoring" |
| Collapse a bare "yes" into one interpretation | "yes. And … synchronized with current source (Tier 1)" | Name the mechanism + ground truth + tier in the confirming prompt |
| Risk overwriting curated rows during sync | Curated 78 rows explicitly byte-preserved; only misses authored | Make the merge **add-only** and assert one-row-per-file before writing |
| Over-author long index rows (600–760 chars) past the 30 KB cap | Ran the sanctioned `split-large-agents.mjs`, not a hand-trim | Cap row length in the subagent prompt; treat sidecar-split as the only lossless fix |

The implicit quality bars the human imposed: **byte-identical relocation** (no drift in curated purposes), **zero fabrication** (grounding pass mandatory), and **checkpoint before content** (commit the safe verbatim move first).

## 6. Skills, tools & memory created — and why they're effective

- **`parallel-fast-subagent-authoring` skill (project-memory, patched at session end).** Captures the Tier-1 authoring mechanism: a deterministic batch harness + `@fast` fan-out reading current source + add-only merge + grounding pass. Effective because it makes a 159-file authoring job reproducible and cheap (@fast, parallel), while keeping curated history intact. **Invoke next time** any large per-file `AGENTS.md`/doc gap needs filling from source. The session fed back three concrete pitfalls into it (below).
- **Deterministic `/tmp` harness (`gen-area-agents.mjs`, `plan-sync.mjs`, `merge-sync.mjs`).** Ephemeral but the pattern is the reusable asset: generate/plan/merge as scripts, never by hand, so verbatim-preservation and one-row-per-file are *provable*, not hoped-for.
- **`migrate-runner.ts` tooling extension.** `TREE_ROOTS` (existsSync-guarded) + `SPLIT_AREAS` docker fix + non-source area→split map — the durable code change that lets the rollup include non-source areas without unassigned rows.

## 7. Pitfalls & dead ends

- **Escaped-backtick leak** — the subagent prompt's `` \` `` schema escaping leaked into batch-1 (scripts) replies, so the merge matched +0 rows. **Fix:** unescape backticks in the reply parser and re-run the idempotent merge.
- **Wrong path anchor** — the `.pi/skills` batch-4 subagent keyed rows relative to `pi-dashboard/commands/` instead of `.pi/skills/`, dropping the prefix on 18 rows. **Fix:** filesystem-remap by testing each key against `existsSync` under the correct root.
- **"docker unassigned" bug** — `SPLIT_AREAS` omitted `"docker"`, so `exportRollup` never loaded the docker split (19 rows unassigned). **Fix:** add `"docker"`; unassigned→0.
- **New-dir routing failure** — brand-new `.pi/skills/*` dirs had no existing split rows for `ownerOf`'s majority-vote walk, leaving 65 unassigned. **Fix:** add a structural area→split map for non-source areas.
- **Grounding false positives** — 21 rows flagged as "unverified identifiers" were all config formatting mismatches (`cpus=var.cpus` in the row vs `cpus = var.cpus` in HCL). Spot-verify before assuming fabrication; here it was zero.
- **30 KB cap breach** — `.pi/skills/AGENTS.md` hit 30958 B (958 over). **Do not** hand-trim 69 rows; run `node scripts/split-large-agents.mjs <path> --write` (53 pull-only sidecars, dir→18.7 KB, lossless, and `treeRows` reconstructs full detail).

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the worktree/repo, `packages/kb/src/migrate-runner.ts` + `dox.ts`, the `docs/file-index-*.md` splits, `scripts/split-large-agents.mjs`, and an `@fast` role for the fan-out.

- [ ] Count rows per split; separate tree-sourced from hand-authored areas.
- [ ] Read `migrate-runner.ts`/`dox.ts` — confirm target areas are ignored file types (authoring, not automation).
- [ ] Generate area `AGENTS.md` deterministically, verbatim purposes, relative paths.
- [ ] Extend `TREE_ROOTS` (existsSync-guarded) + fix `SPLIT_AREAS`; regenerate rollup; confirm row counts preserved + unassigned=0.
- [ ] `tsc --noEmit -p packages/kb` + `npm test -w packages/kb`; add regression test for new roots. **Commit the verbatim checkpoint.**
- [ ] Compute coverage gap; verify entries are real dirs (not symlinks); build batch harness.
- [ ] Spawn `@fast` subagents in waves → reply files; **add-only** merge; assert one row per file; unescape backticks; remap wrong anchors.
- [ ] Grounding pass (spot-verify flags); regenerate rollup with area→split map.
- [ ] Enforce 30 KB cap via `split-large-agents.mjs`; re-run tests + coverage + `openspec validate --strict`.
- [ ] Commit the Tier-1 sync; patch the authoring skill with new pitfalls.

**Final artifacts produced:** 7 new area `AGENTS.md` (docker, scripts, .pi/skills, public, qa, tests/e2e, .github/workflows) with full one-row-per-file coverage; `migrate-runner.ts` + tests extended; root `AGENTS.md` protocol prose updated; OpenSpec change `migrate-file-index-to-agents-tree` artifacts updated. Commits `c5a4b73b7` (verbatim) + `cab2bf23b` (Tier-1 sync).

---

_Generated from session `019f2751-0cdd-7765-9b7f-a94957c48329` · `/Users/robson/Project/pi-agent-dashboard` · 2026-07-03. Source extract: `/tmp/facts-1784846534N.md`._
