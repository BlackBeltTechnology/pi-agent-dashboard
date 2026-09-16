# Test Plan — fix-terminals-action-opens-terminal

Stage: design   Generated: 2025-06-11

No clarifications outstanding — every Triple slot resolved against `design.md`
(`terminalsReady = snapshotGeneration > 0`; newest = `max createdAt`, fallback
last element; active-tab observable = `[data-testid="editor-tab"][aria-selected="true"]`
→ `data-tab-path`).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Plain editor entry is unchanged | decision-table | L1 | automated | hook with `focusOnMount: false`, `terminalsReady: true`, terminals `[t1, t2]` | pane mounts + reconcile runs | `onCreateTerminal` not called; `activeIndex` is exactly what auto-surface alone leaves (last id in set order) — the one-shot dispatches nothing |
| E2 | Unapplied snapshot does not count as "no terminal" | decision-table | L1 | automated | `focusOnMount: true`, `terminalsReady: false`, terminals `[]` | pane mounts | `onCreateTerminal` called **0** times |
| E3 | Unapplied snapshot does not count as "no terminal" | state-transition | L1 | automated | continue E2 | rerender with `terminalsReady: true`, terminals `[t1, t2]` | active tab is `term:t2`; `onCreateTerminal` still called 0 times |
| E4 | Existing terminal is focused | decision-table | L1 | automated | `focusOnMount: true`, `terminalsReady: true`, terminals `t1(createdAt 1000)`, `t2(createdAt 2000)` | pane mounts | tabs `term:t1` + `term:t2` open; active tab is `term:t2`; `onCreateTerminal` called 0 times |
| E5 | No terminal exists, one is created | decision-table | L1 | automated | `focusOnMount: true`, `terminalsReady: true`, terminals `[]` | pane mounts | `onCreateTerminal` called exactly **once** with the pane cwd |
| E6 | Terminal-focused entry (ephemeral filter) | EP | L1 | automated | `focusOnMount: true`, `terminalsReady: true`, terminals `[{id:"e1", ephemeral:true}]` | pane mounts | treated as "none": `onCreateTerminal` called once; no `term:e1` tab opened |
| E7 | Terminal-focused entry (newest tie-break) | BVA | L1 | automated | `focusOnMount: true`, `terminalsReady: true`, terminals `t1(createdAt 5000)`, `t2(createdAt 5000)` — equal | pane mounts | active tab is `term:t2` (last element fallback); `onCreateTerminal` called 0 times |
| E8 | Testable tabs (D4) | — | L1 | automated | `EditorTabs` rendered with `openFiles [term:t1, src/a.ts]`, `activeIndex 0` | render | each tab carries `data-testid="editor-tab"` and `data-tab-path` equal to its path; only the tab at `activeIndex` has `aria-selected="true"` |
| E9 | Terminals and Editor quick actions have distinct targets | decision-table | L1 | automated | `DirectoryHomeView` for cwd `/home/u/proj` | click `directory-home-open-terminals`, then `directory-home-open-editor` | `onOpenTerminals("/home/u/proj")` and `onOpenEditor("/home/u/proj")` fire respectively; App's handlers navigate to `/folder/<enc>/editor?focus=terminal` and `/folder/<enc>/editor` (no param) |

### Performance

None. Neither spec delta states a latency, throughput, memory or soak
threshold, so no performance Triple can be filled without inventing a number.
The readiness-gate delay called out in `design.md` → Risks is covered as the
subjective row M1 below.

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Chosen tab active regardless of auto-surface order (D2b) | state-convergence | L1 | automated | `focusOnMount: true`, `terminalsReady: true`, terminals ordered so the **newest is NOT last** in the array (`t2 createdAt 2000` at index 0, `t1 createdAt 1000` at index 1) | pane mounts; reconcile + one-shot both dispatch in the same commit | converges to active tab `term:t2` — the one-shot's activation wins over auto-surface's default-activate of the last id |
| F2 | Re-render does not create a second terminal | state-transition | L1 | automated | one-shot already created `t1` (`focusOnMount: true`, `terminalsReady: true`) | terminals update to `[{id:"t1", title:"zsh"}]` (title arrives) and the hook re-renders | `onCreateTerminal` total call count stays **1**; active tab stays `term:t1` |
| F3 | Request honoured at most once per entry (consumption callback) | state-transition | L1 | automated | `focusOnMount: true`, `terminalsReady: true`, terminals `[t1]` | pane mounts, then rerenders twice with an unchanged id set | `onFocusConsumed` called exactly **once** |
| F4 | Terminal-focused entry for a different cwd is honoured | state-transition | L1 | automated | hook honoured the entry for cwd `/home/u/a` | rerender same hook instance with `cwd: "/home/u/b"`, `focusOnMount: true`, `terminalsReady: true`, terminals `[]` for b — **no unmount** | `onCreateTerminal` called once with `/home/u/b`; the one-shot ref reset on cwd change |
| F5 | Parameter removed from the URL without a history entry | state-transition | L3 | automated | dashboard at a pinned folder's directory home, no terminals at that cwd | click the Terminals quick action, wait for an active `term:` tab | URL is `/folder/<enc>/editor` with **no** `focus` param; browser Back returns to the directory home (not to the `?focus=terminal` URL) |
| F6 | Remount after consumption does not re-focus | state-transition | L3 | automated | landed via Terminals (one `term:` tab active), then a file opened from the tree so a file tab is active | open an overlay route and dismiss it, remounting the folder pane on the same URL | the **file** tab is still `aria-selected="true"`; `editor-tab` count with `data-tab-path^="term:"` is unchanged (still 1) |
| F7 | Terminals action lands on a terminal (create path) | state-convergence | L3 | automated | directory home for a pinned cwd with **no** terminals | click `directory-home-open-terminals` | converges to exactly one `[data-testid="editor-tab"]` whose `data-tab-path` starts `term:`, and it is `aria-selected="true"` |
| F8 | Terminals action lands on a terminal (activate path) | state-convergence | L3 | automated | continue F7 — one terminal now exists at the cwd | navigate back to the directory home and click Terminals again | terminal-tab count is still **1**; that `term:` tab is `aria-selected="true"` |
| F9 | Editor action lands on the file editor | state-transition | L3 | automated | directory home for the same cwd, terminal count `N` recorded before the click | click `directory-home-open-editor` | folder pane shows the file editor; URL carries no `focus` param; terminal-tab count is still `N` (no terminal created) |
| M1 | Readiness-gate perceived latency (design.md → Risks) | visual/subjective | — | manual-only | cold page load deep-linked to `/folder/<enc>/editor?focus=terminal` | human loads the page | [judgment: the terminal appears without a perceptible stall — no threshold in spec] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Terminal-focused entry (`onCreateTerminal` absent — design.md Risks) | fault-injection (missing dep) | L1 | automated | hook mounted **without** `onCreateTerminal`, `focusOnMount: true`, `terminalsReady: true`, terminals `[]` | pane mounts, then rerenders **with** `onCreateTerminal` supplied | no throw on the first pass; the one-shot flag is not burned — `onCreateTerminal` is called exactly once on the later render |
| X2 | Terminal-focused entry (create never lands) | fault-injection (abort) | L1 | automated | `focusOnMount: true`, `terminalsReady: true`, terminals `[]`; `onCreateTerminal` is a spy whose terminal never appears in the set | pane mounts, then rerenders 3× with terminals still `[]` | `onCreateTerminal` total call count stays **1** — the burned flag prevents a retry storm; no `term:` tab is opened |

---

## Coverage summary

- Requirements covered: 2/2 (`terminal-viewer-tab` terminal-focused entry — all 7 scenarios; `directory-home-page` distinct targets — both scenarios)
- Scenarios by class: edge 9 · perf 0 · frontend 10 · error 2
- Scenarios by level: L1 14 · L2 0 · L3 5 · manual-only 1
- Scenarios by disposition: automated 20 · manual-only 1

## New infra needed

None. L1 extends `packages/client/src/lib/__tests__/use-terminal-pane-tabs.test.ts`,
`packages/client/src/components/__tests__/DirectoryHomeView.test.tsx` and adds an
`EditorTabs` render assertion; L3 extends the existing `tests/e2e/directory-home.spec.ts`
against the docker harness (port read from `.pi-test-harness.json` → `dashboardPort`,
never hardcoded).
