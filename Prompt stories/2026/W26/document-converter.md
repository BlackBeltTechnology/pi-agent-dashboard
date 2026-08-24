---
session: 019ef713
week: 2026/W26
type: development
model: "@fast"
premium: true
premium_reason: "created 0 skill(s) / 1 memory(ies); large facts sheet (~11536 tok)"
upgrade_status: pending
openspec_changes: [document-converter]
proposal_excerpt: "The user's mature document-processing skills (`document-conversion`, `docling`) live as Python packages outside this TypeScript monorepo, so they cannot feed the `kb` knowledge base or produce branded deliverables fro…"
---

# How we did it: shipping the `document-converter` package — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was a single command: **`/skill:openspec-apply-change document-converter`** — "implement this OpenSpec change." The real objective, once the change's proposal made it concrete: **vendor two mature out-of-tree Python document-processing skills (`document-conversion`/docling + `frontmatter-filler` + `markdown-table-profiler`) into the TypeScript monorepo as a self-contained package**, so they can feed the `kb` knowledge base and produce branded DOCX/PDF deliverables. That means: a vendored Python engine behind a Docker image, a thin JSON-over-stdin/stdout boundary, a typed TS facade, a `.pi/skills/document-converter` skill, unit + integration tests, docs — and finally **build the real (multi-GB) image, verify both conversion directions, and ship the change through PR to merge.**

## 2. TL;DR playbook

1. **Kick off with the apply skill:** `/skill:openspec-apply-change document-converter`. Let the AI read the proposal/tasks and *flag scope honestly before grinding* — here it correctly split "author everything now" from "the multi-GB Docker build runs out-of-band."
2. **Ground the facade in the real CLI surface first.** Before writing any wrapper, read the upstream engine's console-script args, frontmatter shapes, OCR API, and styled-diagram recipe. The contract is only correct if it's grounded in the code it wraps.
3. **Author the whole vertical, mock the expensive boundary.** Vendor the Python (with a `VENDOR.md` recording upstream path/version/sha256), define the unified schema, write the `engine_cli.py` JSON boundary + Dockerfile, build the TS facade, and write unit tests with an **injected fake runner** so nothing needs the real image.
4. **Verify the seams you *can* verify for free.** The kb seam is just markdown → run real `kb index`/`kb search` over a provenance-stamped staged file end-to-end without the engine.
5. **When the human says "build it for real" — build the image and let genuine bugs surface as typed errors.** Fix them in the *Dockerfile*, never in vendored code (use a PATH shim for `mmdc --no-sandbox`).
6. **Run the code-review gate scoped to authored code**, not the 40 vendored Python files (they bloat the diff and time out the cloud reviewer). Triage: findings in vendored code are *won't-fix* per the vendoring contract.
7. **Ship via `/skill:ship-change`.** Expect the gate to catch real invariants (here: the `node:child_process` ban). Fix, re-gate green, archive + sync specs, PR against `develop`, wait for CI + CodeRabbit, merge squash, remove worktree.

## 3. How the collaboration unfolded

**Phase A — Scope & sequence (Discovery).** The AI read the change (26 tasks, spec-driven) and *stopped to flag the honest split*: phases 1 + 3–8 are tractable in-session; **phase 2 (the multi-GB Docker image) and the integration test that needs it are not** — and asked to confirm sequencing. The human said **"yes."** This up-front honesty is the single most repeatable move: it prevented a doomed in-session image build and set a clean "author now, build later" plan.

**Phase B — Ground the contract (Gather).** Rather than guess the facade API, the AI read the upstream `document_converter` subcommands, `fill.py`/`profile.py` args, the nano-banana styled-diagram recipe (md5 cache + `mmdc` fallback), and docling's OCR options. *Why it worked:* the JSON boundary and TS types were correct on the first pass because they mirrored real code.

**Phase C — Author the vertical (Design + Generate).** Vendored 45 files with a `VENDOR.md` provenance record; wrote `schema.ts`/`schema.json` (the unified frontmatter contract), `engine_cli.py` (7-command JSON boundary), a self-contained `Dockerfile` + `build-image.sh` (with a guard that fails if any vendored `*.py` references a home-dir path), and the TS facade (`engine.ts` docker runner, `routing.ts`, `provenance.ts`, `index.ts`). Unit tests used an **injected fake runner** — 26 TS tests + Python cache/fallback tests green, integration test *scaffolded but skipped* until the image exists. The kb seam was verified live against the real kb.

**Phase D — Build for real (Verify, on human trigger).** The human: **"Use docker test to test the converter."** The AI built `pi-doc-engine:0.1.0` and let real bugs surface through the typed-error boundary, fixing four Dockerfile bugs (`libgl1` for opencv/cv2, `unzip` for puppeteer, `libreoffice-writer` typo, and an **`mmdc` PATH shim injecting `--no-sandbox`** so Chrome runs as root) plus two semantic fixes (OCR `auto`+no-lang ⇒ skip OCR; templates runtime-mounted, not baked). Both directions + the full **PDF→md→kb** chain verified live.

**Phase E — Ship (on human trigger).** The human: **"Use ship-change skill."** The gate went red — the AI correctly separated *its* failure (a `node:child_process` ban violation in `engine.ts`, fixed by routing through `platform/exec.js`) from *pre-existing stale-worktree* jimp failures in another package. It **refused to push a red gate**, surfaced the situation, and on direction synced `origin/develop` + reinstalled → green. Archived, PR #166, CI pass, CodeRabbit's ~40 findings all in vendored code (won't-fix, rationale posted), squash-merged, worktree removed.

## 4. Prompts that worked

- **The goal prompt — `/skill:openspec-apply-change document-converter`.** Effective because the change already carried a proposal + 26-task list, so a one-line skill invocation loaded the full spec. *Lesson:* front-load the spec into an OpenSpec change; then the kickoff is trivial.
- **`yes`** — the highest-leverage token in the session. It approved the AI's *self-proposed* "author now / build out-of-band" split. This only works because the AI **presented the decision explicitly** first. Reproduce by rewarding the AI when it flags scope, so it keeps doing it.
- **`Use docker test to test the converter`** — flipped the deferred, expensive phase into an active goal at the right moment (once the cheap authoring was done and verified). A stronger version: *"Build pi-doc-engine:0.1.0 and run the gated integration test (8.3); fix build bugs in the Dockerfile, never in vendored code."*
- **`Use ship-change skill`** — handed off the land-it pipeline as a named skill. Effective because ship-change encodes the gate/archive/PR/merge discipline so the human didn't re-specify it.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| defer the expensive Docker build indefinitely | "Use docker test to test the converter" | schedule the real-image build as an explicit later task in tasks.md, not an open-ended "out-of-band" |
| stall at a green-but-incomplete state (25/26, one "blocked") | direct it to actually build & verify 8.3 | treat "blocked by design" as a TODO with a trigger, not a finish line |
| hit a **red gate** with mixed causes (its bug + stale-worktree jimp) | it self-halted per "never push a red gate" and asked how to proceed; human said sync develop | on entering a worktree, **merge `origin/develop` + `npm install` first** to kill stale-node_modules failures before they muddy the gate |
| (avoided the trap correctly) edit vendored Python to satisfy CodeRabbit | the vendoring contract in `VENDOR.md` held it back | keep `VENDOR.md`'s "do not edit; refresh from upstream" rule adjacent to the vendored tree |

The quality bars the human imposed implicitly: **honest scope up front**, **never push a red gate**, and **respect the vendoring contract** — all three were enforced by the AI itself once armed with the right skills/records.

## 6. Skills, tools & memory created — and why they're effective

- **Memory saved (project):** *"packages/document-converter pi-doc-engine Docker image build gotchas (python:3.12-slim base)"* — records that opencv/cv2 needs `libgl1 libglib2.0-0`, puppeteer needs `unzip`, Chrome-as-root needs an `mmdc --no-sandbox` shim, and `libreoffice-writer` is the real package. **Why effective:** these four bugs cost a rebuild each (~7-20 min); the memory makes the next docling-in-slim image build first-try. Invoke it before any future ML-Python Docker image in this repo.
- **Subagent spawned (`general-purpose`):** wrote the `docs/file-index-document-converter.md` split **in caveman style, per the Documentation Update Protocol**, keeping `docs/` writes off the main agent. Invoke whenever a new package needs a docs-tree row.
- **Skill that *should* exist (none was created):** a **"vendor-python-into-ts-monorepo"** skill capturing the whole spine — `VENDOR.md` + sha256, JSON-over-stdin/stdout `engine_cli.py`, injected-fake-runner tests, home-dir-path guard, and the four Docker gotchas. This session repeated a reusable pattern; codifying it would remove the grounding-and-scaffolding legwork next time.

## 7. Pitfalls & dead ends

- **CodeRabbit gate timed out at 10 min**, then again — the uncommitted diff included 40 vendored Python files. *Fix:* raise the timeout and/or commit the vendored engine as a baseline first, then scope the review to authored code. The gate is warn-and-continue; it never blocks.
- **The review wrapper collapsed findings to a generic instruction** and dropped file/line. *Fix:* run `coderabbit review --agent -t uncommitted` directly, capture raw NDJSON, and triage locations yourself.
- **`libreoffice-impl` is not a real apt package** — DOCX→PDF only needs `libreoffice-writer`.
- **Chrome/mmdc dies "Running as root without --no-sandbox."** Don't edit the vendored `mermaid_renderer.py`; drop an `mmdc` shim at `/usr/local/bin` (precedes `/usr/bin`) that injects a `--no-sandbox` puppeteer config.
- **Stale worktree = phantom jimp `Jimp is not a constructor` failures** in an unrelated package. Not your change — `git merge origin/develop && npm install` clears it.
- **`node:child_process` is banned repo-wide** — subprocess execution must route through `@blackbelt-technology/pi-dashboard-shared/platform/exec.js`. The wrapped `spawn` returns nullable stdio (stricter types) — guard it.
- **Squash-merge + worktree collision:** the GitHub merge succeeds but the local post-merge checkout fails because the shell cwd is the deleted worktree. Run cleanup from a valid directory / the sandbox shell with an explicit cwd.

## 8. Reproduce it faster — checklist

**Inputs to have ready:**
- The OpenSpec change (`document-converter`) with proposal + tasks.md.
- Upstream Python skills on disk (`~/Documents/.gemini/skills/document-conversion`, `.agents/skills/frontmatter-filler`, `markdown-table-profiler`) + `templates/default/nano-banana-styles.yaml`.
- Docker (~50 GB free), `GEMINI_API_KEY` for styled diagrams, `gh` authed.

**Checklist:**
1. `/skill:openspec-apply-change document-converter` → let it flag scope, approve the "author now / build later" split.
2. Read the upstream CLI/schema/OCR/diagram surfaces before writing the facade.
3. Vendor Python + `VENDOR.md` (path/version/sha256); write `schema.ts`/`.json`, `engine_cli.py`, `Dockerfile` + `build-image.sh` (home-dir guard).
4. TS facade (`engine.ts` via `platform/exec.js`, `routing.ts`, `provenance.ts`, `index.ts`) + unit tests with an injected fake runner; verify the kb seam live.
5. Delegate the `docs/` split row to a subagent (caveman style).
6. Build `pi-doc-engine:0.1.0`; fix Docker bugs (`libgl1 libglib2.0-0`, `unzip`, `libreoffice-writer`, `mmdc --no-sandbox` shim); OCR `auto`+no-lang ⇒ skip; templates runtime-mounted. Run the gated integration test + full PDF→md→kb chain.
7. Code-review gate scoped to authored code; vendored findings = won't-fix.
8. `/skill:ship-change` → fix any invariant breaks, **sync `origin/develop` + `npm install` if the gate is red from stale state**, archive + sync specs, PR against `develop`, wait CI + CodeRabbit, squash-merge, remove worktree.

**Final artifacts:** `packages/document-converter/` (engine + `src/` facade + tests + README), `.pi/skills/document-converter/SKILL.md`, `docs/file-index-document-converter.md`, image `pi-doc-engine:0.1.0`, archived change `openspec/changes/archive/2026-06-24-document-converter/` + 11 synced specs, merged PR **#166** (`676817fc` on `develop`).

---

_Generated from session `019ef713-7d0b-7c4e-86c5-a3f51a0f3377` · `pi-agent-dashboard` · 2026-06-24. Source extract: `/tmp/facts-55138-12360.md`._
