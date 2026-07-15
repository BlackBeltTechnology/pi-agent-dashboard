# Test Plan — auto-canvas

Standalone scenario catalog (separate from tasks.md). Each row: id · class · technique · level ·
disposition · Triple (input · trigger · observable). Levels per this repo: **L1** unit
(`packages/*/**/__tests__/*.test.ts`, vitest) · **L2** smoke (`qa/tests/*.sh|*.ps1`, no UI asserts)
· **L3** e2e (`tests/e2e/*.spec.ts`, Playwright vs docker harness port from `.pi-test-harness.json`).

Gate decisions folded in (no open `[NEEDS CLARIFICATION]`): side-by-side ≥1024w∧≥600h, tablet+mobile
replace-chat, chip-gate on mobile predicate only; on-tap probe refused→"not running" / >3000ms→"not
responding"; canvasTypes read-fresh; DOC newest = last write/edit event; eager-open immediate.

## Scenarios

### Detect classifier + shared table (L1)

| id | class | technique | level | disposition | input · trigger · observable |
|----|-------|-----------|-------|-------------|------------------------------|
| S1 | edge-case | EP | L1 | automated | `Write path="report.md"`, cwd `/p` · classify · candidate `{file, cwd:"/p", path:"report.md"}`, kind `markdown` |
| S2 | edge-case | EP | L1 | automated | `Write path="a.css"` · classify · `null` (support file) |
| S3 | edge-case | decision-table | L1 | automated | `Write path="x.svg"` · classify · candidate kind `image` (no `svg` kind) |
| S4 | edge-case | EP (invalid) | L1 | automated | `bash command="pandoc in.md -o out.pdf"` · classify · `null` (bash never path-parsed) |
| S5 | edge-case | BVA | L1 | automated | `Write path="dist/report.pdf"`, `dist/` gitignored · classify · candidate present (gitignore not consulted) |
| S6 | error-handling | consistency | L1 | automated | ext maps to non-fallback kind · client `dispatchPreview` + shared detector both classify via one `RENDERER_BY_EXT` · identical kind, no cross-package import |

### Selection + accumulation (L1)

| id | class | technique | level | disposition | input · trigger · observable |
|----|-------|-----------|-------|-------------|------------------------------|
| S7 | edge-case | decision-table | L1 | automated | turn writes `intro.md` then `report.md`, no declare · `selectCanvasTarget` · winner `report.md` (last write) |
| S8 | edge-case | priority | L1 | automated | turn writes `a.md`,`b.svg` + `canvas({file,report.md})` · select · `report.md`, others+registry ignored |
| S9 | state-transition | illegal-edge | L1 | automated | `replayingSessions.has(id)` true, replayed `write` · accumulate · no candidate, no open |
| S10 | state-transition | state-pure | L1 | automated | turn writes `report.md`, ends `agent_end` (no OpenSpec activity) · flush+reset · buffer empty next turn |
| S11 | state-transition | illegal-edge | L1 | automated | turn writes `draft.md`, aborted (no `agent_end`) · abort reset · next write-less turn does NOT adopt `draft.md` |
| S12 | edge-case | decision-table | L1 | automated | `queue_state` event · accumulate · skipped (guard mirrored) |

### canvas() declare-tool (L1 + L3)

| id | class | technique | level | disposition | input · trigger · observable |
|----|-------|-----------|-------|-------------|------------------------------|
| S13 | edge-case | EP | L1 | automated | `canvas({file, path:"report.md"})`, cwd `/p` · normalize · `{file, cwd:"/p", path:"report.md"}` (cwd server-supplied) |
| S14 | error-handling | boundary | L1 | automated | `canvas({file, path:"../../etc/passwd"})` · normalize · rejected, **error result not `{ok:true}`**, no open outside cwd |
| S15 | edge-case | carve-out | L1 | automated | `canvas({server, port:5173})` · normalize · routed to chip path, NOT a `ViewTarget`, bypasses `selectCanvasTarget` |
| S16 | state-transition | last-wins | L1 | automated | two `canvas()` calls, different targets, one turn · eager-open + settle · both resolve to last declared |
| S17 | frontend-quirk | registration | L3 | automated | bridge extension loads · `pi.registerTool` · agent can call `canvas`; server observes forwarded call, drives canvas |

### Type registry (L1)

| id | class | technique | level | disposition | input · trigger · observable |
|----|-------|-----------|-------|-------------|------------------------------|
| S18 | edge-case | EP (default) | L1 | automated | no `canvasTypes` in either settings file · write renderable · auto-canvas (all-on default) |
| S19 | edge-case | decision-table | L1 | automated | project `{canvasTypes:{image:false}}` · `Write chart.png` · no auto-canvas |
| S20 | edge-case | bypass | L1 | automated | project `{canvasTypes:{image:false}}` · `canvas({file,chart.png})` · opens (declare bypasses registry) |
| S21 | state-transition | freshness | L1 | automated | flip project `image:false`→`true` mid-session · next `Write chart.png` · reflects new value (read-fresh, no cache) |
| S22 | error-handling | merge | L1 | automated | global `{html:false}` + project `{}` · `Write x.html` · no auto-canvas (sparse shallow merge) |

### Lifecycle + responsive (L3)

| id | class | technique | level | disposition | input · trigger · observable |
|----|-------|-----------|-------|-------------|------------------------------|
| S23 | frontend-quirk | BVA | L3 | automated | viewport 1024×700 · canvas opens · side-by-side, chat visible+usable |
| S24 | frontend-quirk | BVA | L3 | automated | viewport 1023×700 · canvas opens · replaces chat, no side-by-side, no chip |
| S25 | frontend-quirk | BVA | L3 | automated | viewport 767×800, turn writes deliverable · eager-open · chip/badge surfaced, chat stays active |
| S26 | frontend-quirk | state-convergence | L3 | automated | first qualifying write mid-turn · eager-open · canvas opens immediately (no debounce), refreshes on later writes |
| S27 | state-transition | per-session | L3 | automated | session A has open canvas, switch B→A · re-select · A's canvas restored (mobile: subject to gate) |
| S28 | frontend-quirk | coexist | L3 | automated | deep-link `/session/:id/editor` open · canvas ships · URL preview still works, not folded into canvas state |

### Server chip / SSRF (L3 + L1)

| id | class | technique | level | disposition | input · trigger · observable |
|----|-------|-----------|-------|-------------|------------------------------|
| S29 | error-handling | SSRF | L3 | automated | `canvas({server, port:5173})` · declare · chip surfaces with NO fetch/probe of 5173 pre-tap |
| S30 | error-handling | fault-injection | L3 | automated | chip for exited server, user taps · probe · connection-refused → "server not running" immediately, no iframe |
| S31 | error-handling | fault-injection (delay) | L3 | automated | chip for accept-but-hang port, user taps · probe · >3000ms → "server not responding", no iframe |
| S32 | state-transition | expiry | L3 | automated | chip surfaced, turn ends · turn-boundary/exit signal · chip no longer actionable |
| S33 | error-handling | SSRF | L1 | automated | server bound `0.0.0.0` announced `localhost` · any path · dashboard relies on own `127.0.0.1` probe, no trust of announced host |

### Security — CSP (L3)

| id | class | technique | level | disposition | input · trigger · observable |
|----|-------|-----------|-------|-------------|------------------------------|
| S34 | error-handling | egress | L3 | automated | agent `.html` with `<img src="http://attacker/beacon">` auto-opens · render · external subresource blocked by preview CSP |
| S35 | error-handling | scope | L3 | automated | `canvas({url,"https://youtu.be/abc"})` · render · URL renders normally (document CSP not applied) |

### Manual-only

| id | class | technique | level | disposition | input · trigger · observable |
|----|-------|-----------|-------|-------------|------------------------------|
| S36 | subjective | — | — | manual-only | side-by-side canvas at 1440px · open a real report · layout "feels balanced", no jarring reflow (human judgment) |
| S37 | subjective | — | — | manual-only | eager-open + stream on desktop · agent writes a doc live · "opens as creating" feel is smooth, not a jarring late reveal |

## New infra needed

None. L1 reuses vitest siblings; L3 reuses the docker harness (`tests/e2e/`, port from
`.pi-test-harness.json`). No new test level or harness.

## Summary

- **Automated:** S1–S35 (35 rows) — L1: 20, L3: 15.
- **Manual-only:** S36–S37 (2 rows) — deferred to post-merge by ship-change.
- No open clarifications (both HARD-gate gaps resolved and folded into specs).
