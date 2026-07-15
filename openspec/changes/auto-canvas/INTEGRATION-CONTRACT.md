# auto-canvas — Integration Contract (shared boundary — DONE)

The main agent has built + unit-tested the pure shared boundary. Server and
client work MUST build against these exact symbols. Do NOT redefine them.

## Shared modules (exist, green)

- `packages/shared/src/renderer-by-ext.ts`
  - `type RendererKind` · `RENDERER_BY_EXT` · `NON_FALLBACK_KINDS`
  - `extOf(p)` · `rendererKindForPath(path) → RendererKind`
- `packages/shared/src/canvas-detect.ts`
  - `interface CanvasCandidate { prio: "DECLARE"|"DOC"; target: ViewTarget; kind: RendererKind }`
  - `detectCanvasIntent(toolName, args, cwd, canvasTypes?) → CanvasCandidate | null`
    — write/edit ONLY, never bash; gated by `RENDERER_BY_EXT` + `canvasTypes`.
  - `selectCanvasTarget(candidates) → ViewTarget | null` — DECLARE>DOC, last wins.
- `packages/shared/src/canvas-types.ts`
  - `type CanvasKind` · `type CanvasTypes = Record<CanvasKind, boolean>`
  - `DEFAULT_CANVAS_TYPES` (all true) · `mergeCanvasTypes(global?, project?) → CanvasTypes`
- `packages/shared/src/canvas-declare.ts`
  - `interface CanvasDeclareInput { target: {kind:"file";path} | {kind:"url";url} | {kind:"server";port}; mode?; title?; section? }`
  - `interface ServerChip { kind:"server"; port:number; title? }` (NO host field, ever)
  - `validateCanvasDeclareShape(input) → string | null` (cwd-free; for the tool ack)
  - `normalizeCanvasDeclare(input, cwd) → { ok:true; candidate; mode; title? } | { ok:true; chip } | { ok:false; error }`

## Browser protocol (exist in `packages/shared/src/browser-protocol.ts`, in the union)

```ts
interface CanvasIntentMessage {      // server → browser: drive the canvas
  type: "canvas_intent";
  sessionId: string;
  phase: "eager" | "settle";         // eager = first mid-turn candidate; settle = agent_end
  target: ViewTarget | null;         // winning file/url target, or null
  mode?: "replace" | "pin";
  title?: string;
}
interface CanvasServerChipMessage {  // server → browser: surface a server chip
  type: "canvas_server_chip";
  sessionId: string;
  port: number;                      // client probes 127.0.0.1:port on TAP only
  title?: string;
}
```

## SERVER work (nodejs-expert) — Sections 3, 4 (server half), 5 (server read), 7 (server broadcast)

Wire at the `detectOpenSpecActivity` call site in `packages/server/src/event-wiring.ts`
(line ~662, `tool_execution_start` handler) + the `agent_end` handler (~758).

1. **Per-session per-turn candidate buffer** `Map<sessionId, CanvasCandidate[]>`.
   Mirror the existing guards: only when `!replayingSessions.has(sessionId)` and
   skip `queue_state` (S9, S12).
2. On `tool_execution_start`:
   - `write`/`edit` → `detectCanvasIntent(toolName, args, sessionCwd, effectiveCanvasTypes)`;
     push candidate if non-null. `sessionCwd = sessionManager.get(id)?.cwd`.
   - `canvas` tool → `normalizeCanvasDeclare(args, sessionCwd)`; on `candidate`
     push it; on `chip` broadcast `canvas_server_chip` (NO probe/fetch — S29);
     on `{ok:false}` do nothing (the bridge already returned the error ack).
   - **Eager (S26):** on the FIRST candidate pushed this turn, broadcast
     `canvas_intent {phase:"eager", target: <that candidate's target>}` immediately
     (no debounce). Subsequent declares update eager to the last declare (S16).
3. On `agent_end` (turn boundary): broadcast
   `canvas_intent {phase:"settle", target: selectCanvasTarget(buffer)}` THEN reset
   the buffer. Independent of the guarded OpenSpec clear (S10).
4. **Reset the buffer on EVERY turn boundary incl. abort** (S11) — not only
   `agent_end`. Find the abort/termination path and clear the buffer there with
   NO settle broadcast.
5. **Fresh settings read per detect (S21):** read `~/.pi/agent/settings.json#dashboard.canvasTypes`
   (global) + `<sessionCwd>/.pi/settings.json#dashboard.canvasTypes` (project),
   `mergeCanvasTypes(global, project)` — read fresh each detect, NO cache. Reuse
   whatever settings-read helper the server already has; a tiny fs read + JSON.parse
   wrapped in try/catch is fine. Absent files → all-on default.
6. Unit tests (L1, vitest, `packages/server/src/__tests__/` or shared):
   - S9 replayed events → no candidate/open · S10 buffer resets after agent_end ·
     S11 aborted turn does not leak · S12 `queue_state` skipped · S21 read-fresh.

## EXTENSION work (nodejs-expert) — Section 4.1 (tool registration)

- New file `packages/extension/src/canvas-tool.ts`, `registerCanvasTool(pi)`, wired
  in `bridge.ts` next to `registerAskUserTool(pi)` (~line 1880). Pattern: copy the
  `pi.registerTool({...})` shape from `ask-user-tool.ts` / `role-model-tools.ts`.
- `execute` runs `validateCanvasDeclareShape(params)`; return
  `{ content:[{type:"text",text:JSON.stringify({ok:false,error})}], details:{ok:false,error} }`
  on error else `{...JSON.stringify({ok:true}), details:{ok:true}}`. Fire-and-forget.
  The server observes the forwarded `tool_execution_start` — do NOT drive canvas here.
- Tool `description`: "Open the dashboard canvas on a deliverable you're producing —
  a report, doc, mockup, image, or a running dev server. Call it when you create or
  update a user-facing artifact." `target`/`mode`/`title`/`section` params typed via
  `Type.Object` (TypeBox, as in ask-user-tool.ts). `section` accepted, no-op (v2).
- L3 (S17): `tests/e2e/*.spec.ts` — bridge registers `canvas`; an agent call drives
  the canvas / server observes it. Exemplar `tests/e2e/tool-output-links.spec.ts`.

## CLIENT work (react-expert) — Sections 6, 7 (chip UI), 8 (CSP)

- **Per-session canvas state** (Section 6.1): new state keyed by sessionId that
  COEXISTS with `App.tsx previewState` + `useFileOpenRouting` (do NOT rewrite them).
  Consume `canvas_intent` / `canvas_server_chip` from the browser WS. Restore on
  session re-select. URL deep-linking (`/session/:id/editor`) unchanged (S28).
- **Two-phase**: `eager` opens immediately + refreshes; `settle` fixes the target.
- **Responsive gate** (6.2) via existing `useMediaQuery` tiers: desktop (≥1024w ∧
  ≥600h) side-by-side; tablet + mobile replace-chat; **chip-gate on the mobile
  predicate only** (<768w OR <600h) for eager-open + restore (S23–S27).
- **Server chip** (Section 7): render the `canvas_server_chip` with NO pre-tap fetch
  (S29); on tap probe `127.0.0.1:port` through the existing `LiveServerViewer`
  allowlist-add path (`data-testid="live-confirm"`); refused → "server not running"
  immediately (S30); >3000ms → "server not responding" (S31); no iframe on failure;
  chip expires at turn boundary/server-exit (S32).
- **CSP** (Section 8): auto-opened FILE-kind documents (html/svg/md/pdf via DOC
  detect, no click) carry a restrictive CSP blocking external subresources (S34).
  `canvas()` url/youtube declares render normally, NO document CSP (S35). Exemplar
  `tests/e2e/csp.spec.ts`.
- L3 scenarios S23–S32, S34–S35 in `tests/e2e/` against the docker harness
  (`.pi-test-harness.json#dashboardPort`).

## Test isolation

Direct vitest needs an ephemeral HOME: `HOME=$(mktemp -d) npx vitest run <file>`.
`npm test` sets it automatically.
