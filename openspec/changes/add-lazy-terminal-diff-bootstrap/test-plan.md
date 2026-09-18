# Test Plan — add-lazy-terminal-diff-bootstrap

Stage: design   Generated: 2026-09-17

Gate: HARD (proposal/design stage). Two clarifications were raised and answered
before this file was written — perf threshold = **relative, ≥15 % root JS
transfer reduction vs the committed baseline**; cold-landing network observables
are routed to **L3** (Playwright vs the docker harness).

> **Threshold re-baselined 2026-09-18 (was ≥30 %).** The original ≥30 % was fixed
> before any baseline existed. Task 1.1 measured the `develop` baseline
> (2352.1 KB gz) and the D1–D4 boundaries (1929.8 KB gz) = **−18.0 %**, which is
> the structural ceiling for this change's scope (in-scope `diff` + `xterm`
> families = 425.6 KB gz = 18.1 %; `mdi` 784.7 KB gz and `markdown` 331.0 KB gz
> are Non-Goals). Threshold set to **≥15 %** — real regression protection with
> headroom below the 18.0 % ceiling. See task 1.1's measurement note.

Spec: `specs/lazy-feature-bootstrap/spec.md`. Design decisions: D1 (chunk split),
D2 (per-call-site Suspense), D3 (sticky activation latch, provider-scoped),
D3a (background auto-surface), D3b (Requirement-1 scoping), D4 (pseudo-tab lazy
entry), D5 (build-output guard), D6 (measurement).

> L3 harness port is hash-derived per worktree — read `dashboardPort` from
> `.pi-test-harness.json`; never hardcode `:18000`.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | R1 · no preload | state-partition | L1 | automated | production `dist/` build | parse `index.html`: entry `<script src>` + every `<link rel="modulepreload" href>` | no href basename matches `/^xterm-/` or `/^diff-/`; guard fails on a pre-change build |
| E2 | R1 · no stylesheet link | state-partition | L1 | automated | production `dist/` build | parse every `<link rel="stylesheet" href>` | no href basename matches `/^xterm-/` or `/^diff-/`; both are linked pre-change |
| E3 | R1 · bundles still exist | negative/backstop | L1 | automated | production `dist/assets` | enumerate emitted assets | ≥1 `xterm-*.js`, `diff-*.js`, `xterm-*.css`, `diff-*.css` each; missing any ⇒ fail, not vacuous pass |
| E4 | R1 · matcher anchoring (D1+D5) | BVA on the name boundary | L1 | automated | build after npm `diff` split to chunk key `jsdiff` | run guard E1/E2 | `jsdiff-<hash>.js` does NOT trip the `/^diff-/` matcher — guard stays green |
| E5 | R1 · chunk partition (D1) | equivalence partition | L1 | automated | built `dist/assets` chunk contents | inspect which chunk carries npm `diff` vs `@git-diff-view/*` | the two are in **different** emitted chunks |
| E6 | R1 · no circular chunks (D1) | negative | L1 | automated | `npm run build` stdout+stderr | complete build | zero "Circular dependency"/circular-chunk warnings |
| E7 | R3 · single mount per pane | decision table (tab active × layer mounted) | L1 | automated | pane with 2 terminal tabs `t1`,`t2`; `t1` active | render | exactly 1 mounted `TerminalView` per id within the pane (2 total), not 2 per id |
| E8 | R2 · chat-path jsdiff (D1) | dependency partition | L1 | automated | module graph of `lib/util/lineDelta.ts` | resolve its transitive static imports | set contains npm `diff`, contains **no** `@git-diff-view/*` specifier |
| E9 | R4 · registry partition | static-import partition | L1 | automated | source of `viewer-registry.tsx`, `CappedViewer.tsx` | scan static imports | neither statically imports `DiffViewer`/`DiffPanel` (existing test stays green under the lazy entry) |
| E10 | R4 · pseudo-tab resolves | state-partition | L1 | automated | key `"diff"` | look up `pseudoTabRegistry` | resolves to a renderable component (lazy wrapper accepted — assert renderability, not identity) |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | R1 · budget (D6) | before/after delta vs committed baseline | L3 | automated | cold landing, empty cache, chat default view, no terminal/diff surface | root JS transfer bytes **≥15 % below** the baseline committed in task 1.1 | single cold load |
| P2 | R1 · evidence (D6) | measured, not gated | — | manual-only | cold landing, Fast-3G + 4× CPU throttle, cold cache | LCP recorded before + after | [judgment: CI network timing too noisy to gate — evidence only, per clarification A] |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | R1 · latch not fired at landing | state-transition (unlatched state) | L3 | automated | session, chat view, no terminal/diff surface in transcript | cold load, wait for network idle | zero requests whose path matches `xterm-*` or `diff-*` (`.js` or `.css`) |
| F2 | R1 · restored **background** terminal tab | illegal-edge state-transition | L3 | automated | persisted `paneState` with `term:<id>` open and a **file** tab active | reload, wait for network idle | no `xterm-*` request; the terminal tab is listed and clickable |
| F3 | R1+D3a · folder auto-surface | state-transition | L3 | automated | folder view, cwd with ≥1 live terminal, non-terminal tab active | mount folder view, wait for terminal WS snapshot + network idle | terminal tab appears **unread-badged**, active tab unchanged, no `xterm-*` request |
| F4 | R2 · latch fires on activation | state-transition (legal edge) | L3 | automated | state of F3 | click the terminal tab | exactly one `xterm-*` chunk request; terminal renders and connects |
| F5 | R2 · latch is sticky | repeat-edge state-transition | L3 | automated | state after F4 | switch to a file tab and back to the terminal | **no second** `xterm-*` request |
| F6 | R3 · keep-alive across tab switch | state-transition | L1 | automated | pane with `t1` terminal + `f1` file tab, `t1` active | activate `f1`, then re-activate `t1` | `TerminalView` mount count for `t1` stays 1; no WS reconnect (connect-effect run count unchanged) |
| F7 | R3 · unmount on close | state-transition | L1 | automated | pane with a single terminal tab `t1`, latched | close the `t1` tab | `TerminalView` for `t1` unmounted |
| F8 | R3 · latch survives pane collapse (D3) | state-transition across unmount | L3 | automated | latched pane, terminal tabs open, pane mode → `closed` | reopen the pane | terminals live again (not listed-but-dead); no terminal tab closed by the collapse |
| F9 | R2 · pane-body fallback geometry | layout invariant | L3 | automated | terminal chunk response artificially delayed | activate a terminal tab | the loading affordance occupies the pane body region — measured body height stays within 5 % of the pre-activation height (no collapse to ~0) |
| F10 | R2 · diff route loads + shell survives (D2) | state-transition + boundary containment | L3 | automated | session with a diff, chunk response delayed | open the session diff route | diff renders after load; while suspended the surrounding shell chrome (tab strip / sidebar) stays mounted and interactive |
| F11 | R2 · `renderDiff` callback boundary (D2) | illegal-edge (suspension escape) | L1 | automated | `shellRenderers.renderDiff(sessionId)` rendered with the lazy child suspended | render | sibling shell content stays mounted — suspension does not propagate past the callback's own boundary |
| F12 | R2 · diff pseudo-tab | state-transition | L3 | automated | editor pane, `diff:` pseudo-tab | open the tab | "Loading viewer…" (existing `EditorPane.tsx:176` boundary) then the diff; no second boundary added |
| F13 | R2 · edit tool rich diff | state-transition | L3 | automated | transcript containing an Edit tool result, desktop viewport | transcript renders the tool result | `diff-*` chunk requested at that point; rich diff renders |
| F14 | R2 · mobile homegrown diff stays jsdiff-only | decision table (viewport × renderer) | L3 | automated | same transcript, mobile viewport | transcript renders the tool result | homegrown diff renders; **no** `diff-*` (git-diff-view) request |
| F15 | R1/D3b · terminal-history transcript (scoped carve-out) | boundary-of-requirement | L3 | automated | session whose transcript contains an inline terminal card | cold load | `xterm-*` IS requested — documents the scoped exclusion so a future "optimization" doesn't silently regress it into an untested assumption |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | R2 · chunk fetch fails | fault-injection (abort) | L3 | automated | terminal chunk request aborted (route → abort) | activate a terminal tab | failure is contained in the pane — the shell, tab strip and chat stay interactive; no blank app |
| X2 | R2 · chunk fetch stalls | fault-injection (delay 10 s) | L3 | automated | diff chunk response delayed | open the diff route | in-surface loading affordance persists; surrounding shell stays interactive throughout |
| X3 | R3 · dead persisted tab | fault-injection (stale state) | L1 | automated | persisted `term:<id>` whose id is absent from a **non-empty** live set | reconcile runs | tab closed by `reconcileTerminalTabs`; no mount attempted for the dead id |
| X4 | R3 · cold-load snapshot race | fault-injection (delayed WS snapshot) | L1 | automated | persisted `term:` tabs, live set still **empty** (snapshot not arrived) | reconcile runs | no `term:` tab dropped (existing cold-load guard preserved under the new gate) |

---

## Coverage summary

- Requirements covered: 4/4 (R1 cold-landing exclusion · R2 load-on-open ·
  R3 terminal keep-alive · R4 viewer-registry cycle boundary)
- Scenarios by class: edge 10 · perf 2 · frontend 15 · error 4 — **31 total**
- Scenarios by level: L1 15 · L2 0 · L3 15 · manual-only 1
- Scenarios by disposition: automated 30 · manual-only 1

No L2 rows: this change has no process/install/multi-OS runtime surface — it is
build-output plus rendered-UI behaviour only.

## New infra needed

- **None structurally.** Two capabilities must be *used* that existing specs do
  not yet exercise, both native to the harness:
  - Playwright network-request interception/assertion (`page.on("request")`,
    `page.route(...)` for the abort/delay faults in X1/X2/F9).
  - Seeding `localStorage` pane state before load (F2, F8) — out-of-band
    seeding is already an established harness pattern.
- Task 1.1's baseline number must be **committed into the change** for P1's
  relative threshold to be checkable.

---

Fold: `plan-proposal` Step 3 folds the 30 `automated` rows into `tasks.md`
(one task each, routed by level, carrying an exemplar pointer + the Triple) and
the 1 `manual-only` row (P2) into a tagged manual task. `ship-change` defers P2
post-merge.
