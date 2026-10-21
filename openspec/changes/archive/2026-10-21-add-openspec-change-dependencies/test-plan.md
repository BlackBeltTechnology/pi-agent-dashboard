# Test Plan — add-openspec-change-dependencies

Stage: design   Generated: 2026-10-18

Hard gate passed: every Triple is filled from spec-defined values (64 KiB, 500 chars, label grammar, gate order + codes, 5 s / 3×2 s / 60 s / 10 s, < 20 ms). No clarification markers.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Per-change dependencies file | EP | L1 | automated | `blocked_by: [add-x]` vs `[{change: add-x, reason: api}]` | parse | both yield one open `declared` edge to `add-x`; the second carries `reason: api` |
| E2 | Per-change dependencies file (failsafe shape) | decision table | L1 | automated | rows: `blocked_by: [100-add-feature, 123]`; `Bad_Name`; empty file; `# only comment`; `blocked_by:` blank; top-level `blocks: [x]`; reason of 501 chars | parse | valid names kept as strings; `invalid-file`; none; none; none; `invalid-file`; `invalid-file` |
| E3 | Per-change dependencies file (read rules) | BVA | L1 | automated | temp dir: file of 64 KiB, 64 KiB + 1, a YAML alias, a symlink to `/dev/zero`, a FIFO | read via the shared reader | 64 KiB parses; the rest `invalid-file`; the symlink and FIFO are never opened (fs spy) and the call returns within 1 s |
| E4 | Dependency inference (L1 labels) | decision table | L1 | automated | proposals with: paragraph `Depends on: \`a\``; `**Depends on** \`a\` (must ship first)`; `1. Builds on \`a\``; `- **Depends on (land first):** \`a\``; `**Blocks:** \`a\``; `Blocks on: \`a\``; a label inside a fenced block; own name; `Blocks` naming an archived change; unknown token | infer | first four → blocked by `a`; fifth → `a` blocked by it; `Blocks on` → `related`; fenced, self, archived-under-Blocks and unknown → nothing |
| E5 | Dependency inference (prose → related) | EP | L1 | automated | `add-acme-dns01-certs` with `**Depends on**: \`add-tailscale-cert-tls\``; the other mentions it in a Follow-up sentence; a third says ``\`x\` depends on this change`` | infer | exactly one edge acme←tailscale; tailscale lists acme as `related`; the third yields `related` only; no cycle |
| E6 | Dependency inference (L2 birth) | decision table | L1 | automated | unborn `push-notifications`: `add-push` ADDED only; rows for the other change: MODIFIED only; ADDED+MODIFIED; lowercase `## modified requirements`; header only inside a fence; no header; nested id `area/feature` with main spec absent/present | infer | blocked by `add-push` for rows 1–3; none for 4–5; nested: edge when absent, none when present |
| E7 | Dependency inference (two birthers) | EP | L1 | automated | `add-dedicated-agent-browser` and `add-gmail-auto-setup` both ADDED-only on unborn `dedicated-agent-browser` | infer | no L2 edge; both carry `duplicate-capability` naming the other |
| E8 | Dependency inference (L3 overlap) | EP | L1 | automated | two changes with MODIFIED deltas for an existing capability | infer + waves | both list each other in `overlaps`; waves unaffected |
| E9 | Dependency inference (merge) | decision table | L1 | automated | rows: declared and inferred `foo←bar`; inferred `foo←bar` from `bar`'s `Blocks` + `foo` `not_blocked_by: [bar]`; `bar` in both `blocked_by` and `not_blocked_by` | merge | source `declared` with its reason; no edge; no edge + `conflicting-entry` warning |
| E10 | Names resolve against active and archived changes | decision table | L1 | automated | dirs: `changes/bar`, `changes/.hidden`, `archive/2026-10-01-baz`, `archive/2026-05-28-SHELVED-qux`; `foo` declares `bar, baz, qux, .hidden, nope` and `related: [nope2]`, `not_blocked_by: [nope3]` | resolve | bar open; baz satisfied; qux, nope → `unknown-change` warnings; `.hidden` invalid name → `invalid-file`; nope2/nope3 silent |
| E11 | Dependency graph is validated (cycles) | decision table | L1 | automated | rows: declared a↔b; declared a→b + L2 b→a; declared 3-cycle c→a→b→c; `d` blocked by `b` of the first row; `a` declares itself | validate | error `cycle` on a,b with path `a → b → a`; warning `cycle`; path starts at `a`, shortest, lexicographic; `d` warning `blocked-by-cycle`, wave null; `self-reference` error, entry ignored |
| E12 | Execution waves | state-transition | L1 | automated | `c←b←a` all active; then `a` moved to archive | waves; re-run | a1 b2 c3 and `a.blocks == [b]`; then b1 c2 and `b` lists `a` as satisfied |
| E13 | Dependency inference (determinism) | EP | L1 | automated | same fixture twice: LF vs CRLF, readdir order shuffled, reasons with tabs/double spaces | compute + serialize | byte-identical JSON |
| E14 | server-openspec-polling TOCTOU (dependencies recompute) | fault-injection (race) | L1 | automated | `a` blocked by `b`; `b/proposal.md` drops its label and `b/tasks.md` is written during the CLI call | gated poll | `b` entry kept, but `a.blockedBy` and `b.blocks` both lack the edge (inverse holds) |
| E15 | server-openspec-polling gate tracked paths | decision table | L1 | automated | rows: `dependencies.yaml` of a spec-driven change created; `openspec/specs/push-notifications/spec.md` created; then deleted; a change archived; capability ids absent from the stamp | gated poll | effective mtime advances → CLI spawned for each; absent ids → gate does not skip |
| E16 | server-openspec-polling watcher | EP | L1 | automated | event for `changes/foo/dependencies.yaml` (spec-driven change) | watcher | one debounced `pollOne(cwd,false)` |
| E17 | server-openspec-polling TOCTOU cwd-level stamp | fault-injection (race) | L1 | automated | a change dir moved into `archive/` during the CLI call | gated poll | cwd-level stamp not advanced; next tick re-polls |
| E18 | Dependency inference (fallback path) | EP | L1 | automated | CLI without `status --all` | poll | no change carries `dependencies` |
| E19 | Dependency inference (worker parity) | parity | L1 | automated | same fixture with `useWorker` true and false | poll | identical serialized `dependencies` payloads |
| E20 | openspec-workflow-schema patch v2 | EP | L1 | automated | temp repo, real CLI, generate | generate; `openspec new change foo` with proposal+specs+design | `dependencies` precedes `tasks`; `tasks.requires == [specs, design, dependencies]`; stamp `patch: 2`; `templates/dependencies.yaml` exists; validate valid; status `dependencies: ready`, `tasks: blocked` |
| E21 | openspec-workflow-schema patch v2 (anchor) | EP | L1 | automated | stub base whose `tasks.requires` is `[specs, design, extra]` | generate | abort; repository byte-identical |
| E22 | openspec-workflow-schema patch 1 outdated | state-transition | L1 | automated | stamp `patch: 1` | poll; enable | status `outdated`; schema dir byte-identical after enable |
| E23 | Workflow schema status (undeclaredChanges) | EP | L1 | automated | `affectedChanges [a,b,c]`, only `b` has a regular `dependencies.yaml`, `c`'s is a symlink | poll | `undeclaredChanges == [a, c]` |

### Performance

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| P1 | Per-poll dependency cost is bounded | measurement | L1 | automated | fixture of 100 active changes with proposals and deltas, cache warm | edit one `proposal.md`, recompute 20× in the worker and in-process | median < 20 ms in both |
| P2 | Per-poll dependency cost is bounded (cold) | measurement | L4 | manual-only | this repo (87 active changes) on macOS and on the Windows 11 QA VM | first computation | times recorded in `docs/architecture.md` |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| F1 | Dependency chips on proposal cards | decision table | L1 | automated | rows: `configured: pi-spec-driven`; `spec-driven` + one change `hasFile`; `spec-driven` + none | render | chips + wave badge in rows 1–2; none in row 3; focusing "blocked by 1" lists the blocker with source and reason; inferred edges styled differently |
| F2 | Execution-order view | decision table | L1 | automated | column `c`(3) `a`(1) `x`(null) `b`(2) `y`(no field); a board where no change has a `dependencies` field | toggle Execution order | renders a b c x y; `changeOrder` unchanged; toggle absent on the second board |
| F3 | Cards drag between and within columns (execution order) | state-transition | L1 | automated | Execution order active | drag within column; drop on own column; drop on another column | no persisted change twice; third appends to target `changeOrder` and reassigns group |
| F4 | Dependency editor dialog (round trip) | state-convergence | L1 | automated | GET returns `declared` with `blocked_by [{x, reason r}]`, `not_blocked_by [y]`, computed `related` incl. a prose-only `z`; inferred edge `foo←bar` | open; Not a dependency on bar; save | PUT body keeps `{x, r}`, `not_blocked_by [y, bar]`, no `z`; `expected` equals GET `file`; blocks list read-only with links |
| F5 | Dependency editor dialog (errors) | decision table | L1 | automated | rows: GET `declaredError` set; PUT 409 `modified`; PUT 409 `locked` | save | save disabled until explicit replace confirm; reload offered; retry offered |
| F6 | Undeclared dependencies explain a planning state | decision table | L1 | automated | rows: `dependencies: ready` with UI hidden; `dependencies: blocked`; fallback-path change | render card | hint shown (opens dialog); no hint; no hint |
| F7 | Undeclared dependencies… (letters) | EP | L1 | automated | artifacts `proposal, design, specs, tasks, dependencies`, plus unknown `zeta` | render letters | `P D S T L` with tooltip Dependencies; `Z` |
| F8 | Proposal cards (with dependencies) | EP | L1 | automated | visible UI, `add-auth` blocked by 1 active in wave 2, `IMPLEMENTING 3/8` | render | existing card content plus "blocked by 1" and wave 2 |
| F9 | settings-panel OpenSpec Workflow Schema section (patch 2 update) | EP | L1 | automated | `generated: outdated` (patch 1), `affectedChanges` 4, `undeclaredChanges` 3 | open Update | dialog states 4 affected, 3 needing a declaration and returning to planning |
| F10 | Dependency editor dialog end to end | state-convergence | L3 | automated | docker harness repo with `pi-spec-driven` and changes `a`, `b` | board → b → Dependencies… → add `a` → save | `b/dependencies.yaml` lists `a`; after the poll `b` shows "blocked by 1" and wave 2 |

### Error-handling

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Dependencies REST endpoints (gate order) | decision table | L1 | automated | rows for gates 1–8 (bad change id, untracked, disabled, opted-out, no `openspec/`, fallback-classified, no cached result, unknown change) | GET and PUT | 400 / 403 / 403 / 403 / 404 / 409 `status-all-unsupported` / 503 `pending` / 404 with the listed reasons; fs spy records no access for rows 1–2 |
| X2 | Dependencies REST endpoints (traversal) | EP | L1 | automated | `change: "../../etc"` | PUT | 400 `invalid-request`, zero fs calls |
| X3 | Dependencies REST endpoints (write guard) | decision table | L1 | automated | rows: change dir symlink outside repo; `dependencies.yaml` symlink; realpath outside canonical changes dir; stale root | PUT | refused each; nothing written |
| X4 | Dependencies REST endpoints (lock) | fault-injection (race) | L1 | automated | workflow-schema enable holding the cwd lock; also via a symlinked cwd spelling | PUT | 409 `locked` |
| X5 | Dependencies REST endpoints (precondition) | decision table | L1 | automated | rows: `expected` mtime differs; size differs; `expected: null` but file created after GET; matching | PUT | 409 `modified` ×3 with the file unchanged; matching row written atomically (no temp file left) |
| X6 | Dependencies REST endpoints (injection) | EP | L1 | automated | `reason: "x\nnot_blocked_by: [a]"` | PUT; parse file | one `blocked_by` entry with that literal reason; `not_blocked_by` empty |
| X7 | Dependencies REST endpoints (registration) | EP | L1 | automated | route table | route-tier gate + MCP manifest completeness | GET `observe`, PUT `control`, both with `networkGuard`, both in the manifest and road classification (asserted with `mcp-manifest-completeness.test.ts`) |
| X8 | Dependencies REST endpoints (GET body) | EP | L1 | automated | valid file with reasons; invalid file; no file | GET | `declared` with reasons + `file {mtimeMs,size}`; `declared: null` + `declaredError`; `declared: null`, `file: null` |
| X9 | Dependency gate at ship-it entry (online) | decision table | L1 | automated | fake server: 200 with an open blocker; 503×2 then 200; hangs; 403 `cwd-not-tracked` | run `openspec-deps-gate.ts` | verdict `warn` with the blocker; 2 retries then online verdict; offline within 5 s per request and < 60 s total; offline |
| X10 | Dependency gate at ship-it entry (offline) | decision table | L1 | automated | no server; file with `blocked_by [a, b, c, self]`, `not_blocked_by [c]`; `archive/2026-10-01-a`, `archive/2026-05-28-SHELVED-b` | run script | a satisfied; b unknown; c dropped; `self-reference` → `blocked`; note that cycles were not checked |
| X11 | Dependency gate at ship-it entry (develop) | EP | L1 | automated | temp git repo: worktree has `changes/x` active; `origin/develop` has `archive/2026-10-20-x`; fetch fails in a second row | run script | x satisfied with a pending-merge note in both rows (second uses the existing ref) |
| X12 | Dependency gate at ship-it entry (skill text) | EP | L1 | automated | .pi/skills/ship-it/SKILL.md | assert text | runs the script after the idempotency check, 60 s timeout; crash → "not checked"; interactive decline writes `SHIP_IT_BLOCKED.md`; headless continues and reports |
| X13 | plan-proposal Stop at the worktree boundary | EP | L1 | automated | .pi/skills/plan-proposal/SKILL.md | assert text | commit list includes `dependencies.yaml` when present |
| X14 | Per-poll cost / REST (observability) | EP | L1 | automated | rebuild with 3 edges by mixed sources; a successful PUT | rebuild; PUT | one debug line with counts by source/severity and ms; one structured PUT log line with cwd, change, counts |

---

## Coverage summary

- Requirements covered: all `openspec-change-dependencies` requirements; `openspec-board` (chips, execution order, dialog, hint, letters, proposal cards, drag); `server-openspec-polling` (gate, watcher, TOCTOU); `openspec-workflow-schema` (patch v2, status); `settings-panel`; `ship-it-orchestrator`; `plan-proposal-orchestrator`.
- Scenarios by class: edge 23 · perf 2 · frontend 10 · error 14
- Scenarios by level: L1 47 · L3 1 · L4 1
- Scenarios by disposition: automated 48 · manual-only 1

## New infra needed

- A 100-change fixture generator for P1 (pure, in-test). The gate script tests need a throwaway HTTP server and a temp git repo; both follow the exemplar's temp-dir pattern.
