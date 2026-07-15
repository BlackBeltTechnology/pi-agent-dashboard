# Tasks — auto-canvas

Vanilla checkboxes only. Test tasks carry a harness-exemplar pointer, the scenario Triple, and a
`(test-plan #Sxx)` manifest reference. TDD: write the referenced test first (red), then implement.

## 1. Shared renderability table (foundation)

- [ ] 1.1 Extract the pure extension→`RendererKind` map (`RENDERER_BY_EXT`) from
      `packages/client/src/lib/preview-dispatch.ts` into `packages/shared` (e.g.
      `packages/shared/src/renderer-by-ext.ts`); re-point client `dispatchPreview` to import it
      (keeps its URL-host logic). → verify: client + shared both consume one table, no shared→client import.
- [ ] 1.2 Test: ext→kind agreement across client dispatch + shared table.
      Exemplar: `packages/client/src/lib/__tests__/preview-dispatch.test.ts`.
      Triple: ext maps to non-fallback kind · both classifiers run · identical kind, no cross-package import. (test-plan #S6)

## 2. Detect classifier (shared, write/edit only)

- [ ] 2.1 Add `detectCanvasIntent(toolName, args, cwd) → CanvasCandidate | null` in `packages/shared`,
      beside `openspec-activity-detector.ts`. write/edit only; gate via `RENDERER_BY_EXT`; support
      files + fallback → null; never parse bash. → verify: pure, zero I/O.
- [ ] 2.2 Add `selectCanvasTarget(candidates) → ViewTarget | null`: priority DECLARE > DOC, DOC tie =
      last write/edit event. → verify: pure.
- [ ] 2.3 Test: write of renderable yields file candidate with server cwd.
      Exemplar: `packages/shared/src/__tests__/display-prefs.test.ts` (pure-shared-fn style).
      Triple: `Write path="report.md"`, cwd `/p` · classify · `{file, cwd:"/p", path:"report.md"}`, kind markdown. (test-plan #S1)
- [ ] 2.4 Test: support file → null. Exemplar: same.
      Triple: `Write path="a.css"` · classify · null. (test-plan #S2)
- [ ] 2.5 Test: `.svg` → kind `image` (no svg kind). Exemplar: preview-dispatch.test.ts.
      Triple: `Write path="x.svg"` · classify · candidate kind image. (test-plan #S3)
- [ ] 2.6 Test: bash never path-parsed. Exemplar: display-prefs.test.ts.
      Triple: `bash command="pandoc in.md -o out.pdf"` · classify · null. (test-plan #S4)
- [ ] 2.7 Test: gitignored direct write still a candidate.
      Triple: `Write path="dist/report.pdf"`, dist gitignored · classify · candidate present. (test-plan #S5)
- [ ] 2.8 Test: selection recency (last write wins).
      Triple: writes `intro.md` then `report.md`, no declare · select · `report.md`. (test-plan #S7)
- [ ] 2.9 Test: declare overrides detection + registry.
      Triple: writes `a.md`,`b.svg` + `canvas({file,report.md})` · select · `report.md`. (test-plan #S8)

## 3. Server-side accumulator + turn-boundary reset

- [ ] 3.1 Wire the accumulator at the `detectOpenSpecActivity` call site in server event-wiring;
      mirror the `replayingSessions` skip + `queue_state` skip. Per-session per-turn buffer;
      flush `selectCanvasTarget` at `agent_end`; **reset buffer on every turn boundary incl. abort**,
      independent of the guarded OpenSpec clear. → verify: reset never tied to the guarded clear.
- [ ] 3.2 Test: replayed events do not drive the live canvas. Exemplar: display-prefs.test.ts (unit) or a server-wiring unit test.
      Triple: `replayingSessions.has(id)`, replayed write · accumulate · no candidate/open. (test-plan #S9)
- [ ] 3.3 Test: buffer resets on a non-OpenSpec turn.
      Triple: writes `report.md`, `agent_end`, no OpenSpec activity · flush+reset · empty next turn. (test-plan #S10)
- [ ] 3.4 Test: aborted turn does not leak candidates.
      Triple: writes `draft.md`, aborted, no `agent_end` · reset · next write-less turn ≠ `draft.md`. (test-plan #S11)
- [ ] 3.5 Test: `queue_state` skipped.
      Triple: `queue_state` event · accumulate · skipped. (test-plan #S12)

## 4. canvas() declare-tool (bridge extension)

- [ ] 4.1 Register `canvas({target, mode?, title?, section?})` in the `packages/extension` bridge via
      `pi.registerTool` (like `serve_mockup`); return `{ok:true}` on accept, an **error result on reject**.
      `section` accepted but no-op (v2). → verify: tool reaches pi; call forwards on the event stream.
- [ ] 4.2 Server-side normalization: `file.path`+session cwd → `{file,cwd,path}`; `url` passthrough;
      `server.port` → chip path (NOT a ViewTarget, bypasses selectCanvasTarget); reject traversal/model cwd.
- [ ] 4.3 Test: file target gets server cwd. Exemplar: display-prefs.test.ts.
      Triple: `canvas({file,report.md})`, cwd `/p` · normalize · `{file,cwd:"/p",path:"report.md"}`. (test-plan #S13)
- [ ] 4.4 Test: traversal rejected with error ack.
      Triple: `canvas({file,"../../etc/passwd"})` · normalize · rejected, error not `{ok:true}`. (test-plan #S14)
- [ ] 4.5 Test: server target routes to chip, bypasses selection.
      Triple: `canvas({server,5173})` · normalize · chip path, not a ViewTarget. (test-plan #S15)
- [ ] 4.6 Test: last declare wins within a turn.
      Triple: two `canvas()` diff targets, one turn · eager+settle · both = last. (test-plan #S16)
- [ ] 4.7 Test: tool registers in bridge; server observes forwarded call.
      Exemplar: `tests/e2e/tool-output-links.spec.ts`.
      Triple: bridge loads · `pi.registerTool` · agent can call `canvas`, server drives canvas. (test-plan #S17)

## 5. Canvas-type registry (settings)

- [ ] 5.1 Define `canvasTypes: Record<RendererKind, boolean>` (8 non-fallback kinds), DEFAULT all-true;
      effective = `{...DEFAULT, ...global.canvasTypes, ...project.canvasTypes}` from
      `~/.pi/agent/settings.json#dashboard.canvasTypes` + `<cwd>/.pi/settings.json#dashboard.canvasTypes`,
      **read fresh per detect** (no cache). Gate DETECT only; declare + manual bypass. → verify: absent config = all-on.
- [ ] 5.2 Settings UI: 8 checkboxes with a global/project scope switch; "unchecked = still openable manually".
- [ ] 5.3 Test: absent config auto-canvases all. Exemplar: display-prefs.test.ts.
      Triple: no `canvasTypes` · write renderable · auto-canvas. (test-plan #S18)
- [ ] 5.4 Test: project disables a kind for detection only.
      Triple: project `{image:false}` · `Write chart.png` · no auto-canvas. (test-plan #S19)
- [ ] 5.5 Test: declare bypasses registry.
      Triple: project `{image:false}` · `canvas({file,chart.png})` · opens. (test-plan #S20)
- [ ] 5.6 Test: read-fresh (no cache).
      Triple: flip `image:false`→`true` mid-session · next `Write chart.png` · new value applies. (test-plan #S21)
- [ ] 5.7 Test: sparse shallow merge (global+project).
      Triple: global `{html:false}` + project `{}` · `Write x.html` · no auto-canvas. (test-plan #S22)

## 6. Lifecycle + responsive presentation

- [ ] 6.1 Introduce per-session canvas state (coexists with `App.tsx previewState` + `useFileOpenRouting`;
      does NOT rewrite them). Restore on session re-select. Two-phase: eager-open immediate on first
      qualifying write, settle target at turn-end. → verify: URL deep-linking unchanged.
- [ ] 6.2 Responsive: side-by-side only desktop (≥1024w ∧ ≥600h) via existing `useMediaQuery` tiers;
      tablet + mobile replace-chat; **chip-gate on mobile predicate only** (<768w OR <600h) for
      eager-open + restore-on-reselect. → verify: tablet replaces chat, mobile shows chip.
- [ ] 6.3 Test: desktop side-by-side (1024×700). Exemplar: `tests/e2e/editor-pane.spec.ts`.
      Triple: viewport 1024×700 · canvas opens · side-by-side, chat usable. (test-plan #S23)
- [ ] 6.4 Test: tablet replaces chat (1023×700). Exemplar: `tests/e2e/file-preview-survives-churn.spec.ts`.
      Triple: viewport 1023×700 · canvas opens · replaces chat, no side-by-side, no chip. (test-plan #S24)
- [ ] 6.5 Test: mobile chip, no yank (767×800). Exemplar: file-preview-survives-churn.spec.ts.
      Triple: 767×800, turn writes deliverable · eager-open · chip surfaced, chat active. (test-plan #S25)
- [ ] 6.6 Test: eager-open immediate + refresh. Exemplar: file-preview-survives-churn.spec.ts.
      Triple: first write mid-turn · eager-open · opens at once (no debounce), refreshes on later writes. (test-plan #S26)
- [ ] 6.7 Test: per-session restore. Exemplar: file-preview-survives-churn.spec.ts.
      Triple: A open canvas, switch B→A · re-select · A's canvas restored. (test-plan #S27)
- [ ] 6.8 Test: URL deep-link coexists. Exemplar: `tests/e2e/editor-pane.spec.ts`.
      Triple: `/session/:id/editor` open · canvas ships · URL preview still works, not folded. (test-plan #S28)

## 7. Server chip (declare-only, SSRF-preserving)

- [ ] 7.1 Chip surfaces from a `{kind:server}` declare with NO pre-confirm fetch; on tap probe
      `127.0.0.1:port` via the existing `LiveServerViewer` allowlist-add path; refused→"not running",
      >3000ms→"not responding"; no iframe on failure; chip expires at turn boundary/server-exit.
      → verify: no probe before tap; announced host never trusted.
- [ ] 7.2 Test: chip surfaces without pre-tap fetch. Exemplar: `tests/e2e/tool-output-links.spec.ts`.
      Triple: `canvas({server,5173})` · declare · chip, no fetch/probe pre-tap. (test-plan #S29)
- [ ] 7.3 Test: refused → "not running" immediately. Exemplar: `tests/e2e/editor-pane.spec.ts` (LiveServer flow).
      Triple: chip for exited server, tap · probe · connection-refused → "not running", no iframe. (test-plan #S30)
- [ ] 7.4 Test: unresponsive → 3000ms timeout. Exemplar: editor-pane.spec.ts.
      Triple: chip for hang port, tap · probe · >3000ms → "not responding", no iframe. (test-plan #S31)
- [ ] 7.5 Test: chip expires at turn boundary.
      Triple: chip surfaced, turn ends · boundary/exit · chip not actionable. (test-plan #S32)
- [ ] 7.6 Test: announced-host never trusted (unit). Exemplar: existing `packages/shared/src` live-server test if present, else new.
      Triple: bound `0.0.0.0` announced `localhost` · any path · dashboard uses own `127.0.0.1` probe. (test-plan #S33)

## 8. Security — CSP on auto-opened documents

- [ ] 8.1 Apply a restrictive CSP (block external subresources) to auto-opened file-kind documents
      (html/svg/md/pdf via DOC-detect, no click); do NOT apply to `canvas()` url/youtube declares.
      → verify: ships with auto-open. (security-hardening)
- [ ] 8.2 Test: auto-opened HTML cannot beacon. Exemplar: `tests/e2e/csp.spec.ts`.
      Triple: agent `.html` `<img src=http://attacker/beacon>` auto-opens · render · subresource blocked. (test-plan #S34)
- [ ] 8.3 Test: URL declare renders normally. Exemplar: `tests/e2e/csp.spec.ts`.
      Triple: `canvas({url,youtu.be/abc})` · render · renders, no document CSP. (test-plan #S35)

## 9. Discipline checkpoints

- [ ] 9.1 security-hardening pass: server-chip SSRF (no pre-tap fetch), CSP egress, agent-supplied paths (traversal reject).
- [ ] 9.2 performance-optimization pass: detect + accumulator on the hot event-wiring path stay O(1) per event; no fs walk.
- [ ] 9.3 doubt-driven-review before commit on the `canvas()` public tool surface + per-session state.

## 10. Manual (test-plan: manual-only)

- [ ] 10.1 Manual: side-by-side canvas at 1440px with a real report — layout feels balanced, no jarring reflow. (test-plan: manual-only)
- [ ] 10.2 Manual: desktop eager-open + stream — "opens as creating" feel is smooth, not a late reveal. (test-plan: manual-only)
