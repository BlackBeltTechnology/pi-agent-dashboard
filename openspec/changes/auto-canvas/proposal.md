# Auto-canvas — model-driven preview surface

## Why

Today the dashboard's preview surface (the "canvas") is **reactive**: a human clicks a
linkified path in tool output, or types `/view`, and a read-only overlay opens. The
rendering half is mature — `dispatchPreview()` (pure, shape-based) already routes files/URLs
to `markdown | asciidoc | html | pdf | video | audio | image | youtube` renderers (`.svg`→`image`;
8 non-`fallback` kinds), and
`live-server-preview` already reverse-proxies a running loopback server into a sandboxed
iframe. **What is missing is the trigger.** Nothing drives the canvas from the *agent* side.

The big three converged on a model-driven side surface: ChatGPT Canvas (model **declares**
via a tool call), Claude Artifacts (UI **detects** a typed block and auto-renders while the
model streams), Gemini Canvas (immersive live preview). pi has a signal the web UIs lack —
**the tool calls themselves**. When pi runs `Write report.md`, `serve_mockup`, or a
PDF-producing command, that *is* the "model created a deliverable" event, already forwarded
over the bridge and already classified by shape in `event-wiring.ts` (via
`detectOpenSpecActivity`). We can drive the canvas off that stream with no new event
plumbing, working with every model today.

This change makes the canvas **automatic**: as the agent produces content — HTML (served
mockup), PDF, markdown, images, etc. — the canvas opens and refreshes on its own, with an
explicit `canvas()` tool for models that want to name *the* deliverable precisely, and a
global/project settings registry to keep the automatism from being noisy.

Verified against current code (corrected after doubt-review — earlier drafts misplaced two symbols):
- `dispatchPreview()` + `RendererKind` live in **`packages/client/src/lib/preview-dispatch.ts`**
  (NOT `shared`). `packages/shared/src/types.ts` exports only `ViewTarget`. Consequence: the
  detector cannot import client code. This change **extracts the pure extension→`RendererKind`
  table (`RENDERER_BY_EXT`) into `packages/shared`**; both client `dispatchPreview` and the new
  shared detector consume it — genuine reuse, not a parallel table. The renderer universe is
  fixed (8 non-`fallback` kinds); this change adds a *policy filter* over it, not new renderers.
- `detectOpenSpecActivity(toolName, args)` — `packages/shared/src/openspec-activity-detector.ts`,
  a pure classifier **called server-side** on the **bridge-forwarded** tool-event stream
  (`packages/extension/src/bridge.ts` forwards `tool_execution_start/end`), gated by a
  `replayingSessions` skip + a `queue_state` skip. The auto-canvas classifier is its sibling and
  **mirrors those guards**; it takes `(toolName, args, cwd)` — `cwd` comes from server session
  state, so it is not purely `(toolName,args)` (earlier over-claim corrected). It classifies
  **`write`/`edit` only** (path in `args`); bash/skill-driven outputs are not auto-detected.
- Tool registration: a dashboard-driven `canvas()` tool MUST register in the **bridge extension**
  (`packages/extension`, the `pi.registerTool` surface, like `serve_mockup`/`ask_user`) so pi can
  call it and its call surfaces on the forwarded stream; the server then *observes* the call.
- `HtmlPreview` renders agent HTML in a **sandboxed iframe with scripts disabled**
  (`viewer-registry.tsx`; test asserts no `allow-scripts`); `LiveServerViewer` uses the
  opposite posture (`allow-scripts`, no `allow-same-origin`). Auto-open of a *document* is inert
  by construction, **and this change adds a restrictive CSP in v1** so auto-open egress ≤ the
  existing manual-click egress (no deferral).
- `live-server-preview` SSRF requirement: loopback-only + **explicit-confirm allowlist**;
  "Targets SHALL never be fetched automatically from … agent-supplied input." The server path
  **preserves** it — servers are declare-only (no auto-detection); a declared server surfaces a
  confirm chip with **no pre-confirm fetch**, and the loopback probe runs only on chip tap
  (reusing the existing `LiveServerViewer` allowlist endpoint). No auto-open path exists.
- Two-scope settings (`~/.pi/agent/settings.json` + `<cwd>/.pi/settings.json`, both already
  walked by `pi-package-resolver`) back the type-registry; the merge is a plain sparse shallow
  override — same *shape* as `mergeDisplayPrefs`'s `toolCalls`, but a **new config path**, not
  that function.
- Import direction: the `RENDERER_BY_EXT` extraction is client→shared (safe by construction);
  note the existing `no-*-import` tests do not *generally* enforce shared↛client, so the new
  shared module's isolation rests on the extraction direction, not on a catch-all test.

Adjacent, non-colliding: active change `fix-session-diff-open-nongit-and-preview` fixes the
diff-tab path-format mismatch (orthogonal); its non-git handling informs the versioning
decision in `design.md` (Decision 6).

Adjacent, synergistic: active change `detect-tool-created-files` **builds the very signal this
proposal calls "no reliable signal to harvest" and drops** (Part 3) — git-status detection +
Bash output-token attribution + mtime-in-Bash-window ownership for bash/skill/converter
outputs, in `packages/server/src/session-diff.ts` (disjoint from this change's files). It does
NOT change auto-canvas v1 (detect stays `write`/`edit`-only; bash/skill deliverables remain
declare-driven). It only means a future follow-up could feed `origin:"tool"` +
`sessionOwned` deliverables into `detectCanvasIntent`. **Load-bearing caveat:** that signal is
validated for a *passive changed-file list* (no fetch, no auto-open); promoting it into canvas
auto-open must re-clear this change's security/disruption bar (mobile chip gate, preview CSP,
no pre-confirm fetch) — safe-for-list ≠ safe-for-auto-open.

## What Changes

Six coherent parts (single change, per scope decision):

1. **Canvas lifecycle (Model 3: singleton + pins).** The change introduces a **new per-session
   canvas state** that **coexists with** the existing URL-driven preview overlay
   (`App.tsx previewState`, deep-linkable) and `useFileOpenRouting` — it does NOT rewrite or
   unify them (that would drop URL deep-linking). One active canvas slot swaps to the newest
   deliverable; an optional **pin** promotes an artifact to a kept tab. Session switch shows the
   target session's canvas or nothing; existing deep-linkable previews are unchanged. On
   **desktop-wide** the canvas renders side-by-side (new); on **mobile** it uses the existing
   full-screen replace-chat presentation. **Two-phase open**: eager-open on the first qualifying
   write, settle the winning target at turn end. The **viewport gate is wired into the eager-open
   transition itself** (and into restore-on-reselect) — on mobile, auto-open and auto-restore
   default to a chip/badge, never an involuntary yank out of chat.

2. **Detect classifier.** New pure module `detectCanvasIntent(toolName, args) → candidate | null`
   (sibling of `detectOpenSpecActivity`), gated by `dispatchPreview` (renderable ⇒ candidate),
   plus `selectCanvasTarget(candidates) → ViewTarget | null` — a turn-scoped priority resolver
   (`DECLARE > DOC by recency`; servers are declare-only). Wired at the existing `event-wiring.ts` call site as a
   per-turn accumulator flushed on turn-end.

3. **Detect scope = `write`/`edit` outputs only.** Auto-detection reads `args.path` from
   `write`/`edit` tool calls (this covers a directly-written `dist/report.pdf` too — `.gitignore`
   is not consulted). Command parsing, mtime-scans, and "extension-tool output harvesting" are
   **all dropped**: `imagegen`/converters/`serve_mockup` are **bash- or skill-driven, not
   registered tools with machine-readable output paths** (verified), so there is no reliable
   signal to harvest. Bash/skill-produced deliverables (a scripted PDF, a generated image) are
   surfaced via the `canvas()` declare-tool, not detection. Detect is thus honest about its reach:
   `write`/`edit` deliverables auto-canvas; everything else is declare-driven.

4. **Servers are declare-only (no auto-detection).** Auto-detecting agent-started servers is
   **dropped**: `serve_mockup` binds `0.0.0.0` but announces `localhost`, so the announced host
   cannot be trusted for a loopback gate, and `npm run dev` emits no structured signal. Instead a
   server reaches the canvas ONLY via `canvas({ target: { kind:"server", port } })` or the
   existing manual `LiveServerViewer`. A declared `{kind:"server"}` target does NOT flow through
   `selectCanvasTarget` (which returns a `ViewTarget`, no server kind) — it routes to the chip
   path. The chip surfaces from the declare **without any pre-confirm fetch**; the **dashboard
   probes `127.0.0.1:port` only on chip tap** (the explicit-confirm gate), never trusting an
   agent-announced host. No auto-open path exists; SSRF is preserved (no agent target fetched
   before explicit confirmation).

5. **`canvas()` declare-tool** (registered in the `packages/extension` bridge, the `pi.registerTool`
   surface). A thin, non-blocking, first-class tool the agent may call —
   `canvas({ target, mode: "replace"|"pin"|"section", title?, section? })` — returning a trivial
   `{ok:true}` ack. The dashboard drives the canvas by **observing the tool call** in the event
   stream (same path as detect); the ack that returns to pi is trivial and harmless — there is
   **no stream-filtering mechanism** (the earlier "like view rows" claim was wrong: view rows are
   browser-injected into a separate store and never touch pi's stream). The tool's `target` is a
   **convenience shape normalized server-side into a real `ViewTarget`** (session `cwd` supplied
   by the server, never by the model → anti-traversal preserved; a `server` target routes through
   the Decision-4 chip). When present it wins (`prio: DECLARE`), overriding detect **and** the
   registry; last declare in a turn wins (no two-moment thrash). Firing it *before* writing
   restores the "opens live, streams in" feel. `mode:"section"` reserved but **deferred** (v2).
   Taught via tool description, not system-prompt bloat.

6. **Canvas-type registry (global + project settings).** `canvasTypes: Record<RendererKind,
   boolean>` over the **8 non-`fallback` kinds**, every one defaulting true ("all handled";
   the registry is net-new — the default is the new opt-out baseline, not pre-existing). Sparse
   project-scope override shallow-merged over global (the `mergeDisplayPrefs` idiom). Gates
   **DETECT only** — `canvas()` and manual clicks bypass it. Surfaced in dashboard settings with a
   global/project scope switch. (No separate server toggle: servers are declare-only and declares
   bypass the registry.)

### Non-goals

- `mode:"section"` region-update / highlight-to-edit (reserved field, v2).
- Per-extension registry granularity (RendererKind-level only; extension-level deferred).
- Token-level streaming into an in-memory buffer (our granularity is file/tool-call settled).
- New renderers — this rides `dispatchPreview`'s existing set.
- Harvesting bash-script outputs that don't announce a path (declare-tool covers those in v1;
  `detect-tool-created-files` is building a git-status/mtime signal that a later follow-up could
  wire in — out of scope here, see the Adjacent-synergistic note above).
- Versioning untracked/gitignored deliverables (v1 = unversioned for those; see design Deferred).

## Coordinates With

This change centralizes `RENDERER_BY_EXT` + `dispatchPreview` in `packages/shared` and defines
`canvasTypes: Record<RendererKind, boolean>` over the non-`fallback` `RendererKind`s. Three
sibling changes ADD new kinds to that union, so the enumerated set is not fixed at 8:

- **`add-eml-preview`** adds `"email"`; **`render-office-previews`** adds `"docx" | "spreadsheet"`;
  **`render-pptx-preview`** adds `"pptx"`.
- **Recommended: those additive preview changes land BEFORE this one.** This change is the
  structural refactor, so it should EXTRACT whatever map exists at that point and enumerate
  `canvasTypes` over the then-current kinds (up to 11, not 8) rather than the previews chasing a
  relocated file. Treat the spec's "8 non-`fallback`" count as illustrative of the current main
  spec, not a hard cap — size `canvasTypes` to the live `RendererKind` union at implementation.
- If this change lands first, each preview change must retarget its dispatch edits to
  `packages/shared/src/renderer-by-ext.ts` and add its kind(s) to `canvasTypes`.

## Discipline Skills

`security-hardening` (auto-opening agent-authored content; server-chip SSRF gate; preview
CSP; agent-supplied paths) · `performance-optimization` (the turn-scoped changed-files probe
— bounded/scoped scan, not a whole-cwd walk) · `doubt-driven-review` (the `canvas()` tool is a
public-ish agent API + per-session state migration — reviewed in planning and before build).
