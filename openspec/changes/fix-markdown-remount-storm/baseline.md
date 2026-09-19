# Baseline measurements

Captured during the investigation that produced this change, **before** any code
change. Recorded here so the post-fix comparison is against fact rather than
memory. Task group 0 extends this file; it does not start it.

## Conditions

- URL: `/session/<id>/editor?file=docs/architecture.md`
- Surface: file viewer → `MarkdownViewer` → `MarkdownContent` → `MermaidBlock`
- Static file, no user interaction during the window
- Dashboard: `activeBridgeCount: 9`
- Server config: `openspec.pollIntervalSeconds: 300`, `changeDetection: "mtime"`, `maxConcurrentSpawns: 1`
- Instrumentation: `MutationObserver` on `document.body` (`childList`, `subtree`,
  `attributes`, `characterData`); `Node.prototype.insertBefore` call-site
  sampler; DOM-node identity stamping via an element expando; WebSocket message
  probe installed with `agent-browser open --init-script`

## Results

| Measurement | Value |
|---|---|
| Total DOM mutations, 36s window | 1,386,898 (~38,500/sec) |
| `.mermaid-diagram` removals, 36s | ~96 waves; removal events every ~340–900ms |
| `.mermaid-diagram` nodes present | 21 |
| Removals per wave | 21 |
| DOM-node identity: stamped 21 nodes, waited 20s | **0 of 21 survived** |
| `insertBefore` call-site samples on `P`/`LI` | 400 of 400 from the React commit phase |
| WebSocket messages, 25s | 66 total |
| — top 8 types (53 of 66) | `openspec_update` 15, `git_head_update` 15, `event_replay` 10, `session_updated` 5, `models_list` 3, `roles_list` 2, `quota_update` 2, `collapsed_folders_updated` 1 |
| — remaining 13 | not captured; the probe recorded only the 8 highest-count types |

Top mutation targets by count (36s): `P` 731,520 · `LI` 618,432 · `STRONG` 11,520
· `DIV.markdown-content` 8,830 · `PRE` 7,872 · `H3` 4,032 · `H4` 3,264 · `H2` 384.
Attribute mutations on unrelated inputs (`session-search-input`,
`workspace-filter-input`, `attach-file-input`) at 288 each imply ~8 full
application renders/sec.

## Run-to-run variance (unexplained — task 0.5)

| Run | Window | Waves observed |
|---|---|---|
| A — busy fleet, tool calls in flight | 36s | continuous, every ~340ms |
| B — isolated browser session, quieter | 28s | 30 waves (~1/sec) |
| C — isolated, immediately after load | 25s | 2 waves, then quiet |

The rate is not constant. Until this is explained, **a quiet run cannot be read
as a pass**.

## Known gaps in this baseline

1. **Diagram count.** `docs/architecture.md` has 26 ` ```mermaid ` fences; only
   21 `.mermaid-diagram` nodes existed. The other 5 are unaccounted for — the
   error branch emits no `.mermaid-diagram` element, which would explain it, but
   this is unverified. (Task 0.8)
2. **Trigger unidentified.** The WebSocket frames were observed; their source and
   any causal link to the remount waves were **not** established. An earlier
   revision of this change attributed them to a server-side `openspec_update`
   storm — that attribution was falsified (the broadcast is already change-gated,
   and at a 300s poll interval 15 frames in 25s is impossible). (Task 0.3)
3. **Mutation-target attribution.** `P`/`LI`/`H3` appear as `m.target`, which is
   the *parent* of the changed children. The working hypothesis is that inline
   `<code>` spans — handled by the same `code` override — remount inside prose.
   Unverified. (Task 0.4)
4. Figures 1.39M / 0-of-21 / "100% React commit phase" come from a live session
   and are not reproducible from the repo alone. Task 0.1–0.2 re-derives them.
