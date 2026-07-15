# Design — auto-canvas

Context: the canvas rendering half is done (`dispatchPreview`, `live-server-preview`,
`viewer-registry`). This change adds the **driver**. The design leans on two shipped
patterns — `detectOpenSpecActivity` (pure `(toolName,args)` classifier at the bridge
event-wiring call site) and `mergeDisplayPrefs` (sparse global+override merge) — so the new
surface area is small and precedented.

Six decisions below. Each carries the stress-test finding that shaped it, so the rationale is
not re-litigated at implementation time.

---

## Decision 1 — Lifecycle: Model 3 (singleton + pins), per-session, two-phase open

**Choice.** One active canvas slot. Newest qualifying artifact becomes the *transient*
spotlight; an explicit **pin** (via `canvas({mode:"pin"})` or a UI affordance) promotes it to
a kept tab that survives later writes. State is **per-session**, restored on session
re-select.

**State machine.**
```
   CLOSED ──(first qualifying write | canvas() | /view | link)──▶ TRANSIENT
   TRANSIENT ──(same target re-write)──▶ refresh in place (version++)
   TRANSIENT ──(different target, nothing pinned)──▶ replace content
   TRANSIENT ──(pin)──▶ PINNED (survives new writes; closes only on explicit close)
   any ──(session switch)──▶ persist per-session; show target session's canvas
```

**Two-phase open (stress-test #2 — "as creating", not "after").** Turn-end-only flush made
the canvas a delayed big-reveal, contradicting the ask ("drive the canvas *as* the LLM
creates content"). Resolution: **eager-open on the first qualifying write**, then
**refresh-in-place** on subsequent writes; run `selectCanvasTarget` (the priority resolver) at
**turn end** only to *settle which* target owns the slot. Phase 1 = liveness, phase 2 =
no-thrash.

**Slot identity (doubt-review cycle-2 #4 — narrowed: coexist, do NOT unify).** Cycle-1 claimed to
collapse three preview state machines into one. Cycle-2 showed that is infeasible without
regression: `App.tsx previewState` is **URL-router-driven and deep-linkable** (`/session/:id/...`),
`useFileOpenRouting` is deliberately leaf-local (survives streaming-token churn). Unifying would
drop URL deep-linking. **Revised:** this change introduces a **new per-session canvas state that
coexists** with those; it does NOT rewrite them. Existing deep-linkable previews are unchanged.
`markdown-preview-view` is modified only for the canvas surface: (a) the canvas has per-session
state restored on re-select; (b) **side-by-side only on desktop (≥ 1024px wide AND ≥ 600px tall);
tablet (768–1023px) and mobile replace-chat** (scenario-design gate decision, reusing the repo's
existing 3-tier `useMediaQuery` breakpoints). CONTRACT 5 is scoped to "the canvas surface behaves
consistently on session switch," not "all preview state is one machine."

**Mobile gate is IN the transition (doubt-review K/#6,#7 — not an appended sentence).** The
viewport gate is a guard **on the phase-1 eager-open transition AND on restore-on-reselect**,
not a footnote. On narrow viewports, a qualifying write (or a `canvas()` call, or a pinned
session re-select) does NOT auto-replace chat; it surfaces a **chip/badge** the user taps.
`canvas()` is agent-initiated, so the "manual clicks bypass" carve-out does not cover it — the
gate applies to `canvas()` on mobile too. The gate fires **only on the mobile predicate**
(< 768px wide OR < 600px tall); tablet replaces chat directly, desktop uses side-by-side
(non-disruptive). Filled slots (gate-confirmed from precedent): `canvasTypes` is read **fresh per
detect** (no cache, like `pi-package-resolver` read-on-call); DOC "newest" = the **last
`write`/`edit` event in the turn**; eager-open fires **immediately on the first qualifying write**
(no debounce).

**Open item (design-time, resolved here):** pin permanence — pins are **per-session ephemeral**
in v1 (not persisted across server restart), matching session-scoped canvas state. Persisting
pins like the live-server allowlist is a future enhancement.

---

## Decision 2 — Detect: shared classifier + server-side accumulator/flush

**Package reality (doubt-review A/B, #1–#4).** `dispatchPreview` + `RendererKind` live in
**`packages/client/src/lib/preview-dispatch.ts`**, and `shared` MUST NOT import client (enforced
by `packages/shared/src/__tests__/no-*-import.test.ts`). So "detector in shared reuses
`dispatchPreview`" is unbuildable as originally drawn. Resolution: **extract the pure
extension→`RendererKind` map (`RENDERER_BY_EXT`) into `packages/shared`**; client
`dispatchPreview` imports it (keeps its URL-host logic), and the shared detector imports it for
the renderability gate. Genuine reuse, satisfies CONTRACT 2.

**Choice.**
- `detectCanvasIntent(toolName, args, cwd) → CanvasCandidate | null` — per tool call, **`write`/
  `edit` only**. NOT purely `(toolName,args)`: `cwd` builds `{kind:"file";cwd;path}` and comes from
  **server session state**, never the model. Does **not** parse `bash` command strings; does not
  harvest extension-tool results (cycle-2 #3: those tools are bash/skill-driven, no machine-readable
  output path). Renderability gate = shared `RENDERER_BY_EXT`; support files + `fallback` → `null`.
- `selectCanvasTarget(candidates) → ViewTarget | null` — per turn, priority **`DECLARE > DOC`**
  (SERVER folds into DECLARE now that servers are declare-only — Decision 4), ties by recency
  (newest file).

**Wiring (doubt-review #12/J + cycle-2 #5 — ordering rationale corrected).** Server-side, at the
same event-wiring call site as `detectOpenSpecActivity`, which runs under
`!replayingSessions.has(sessionId)` and skips `queue_state` — the canvas accumulator **mirrors
both guards** (else replayed forked-session events auto-open on the live session). Add a
per-session per-turn candidate buffer. **Correction:** the `agent_end` OpenSpec-state clear is
*guarded* and touches only OpenSpec fields, not canvas state, so the earlier "flush before clear
or lose state" rationale was false. The real load-bearing rule: **the candidate buffer resets on every turn
boundary** — `agent_end` AND abort/termination (cycle-3 #7: if only `agent_end` triggers reset,
an aborted turn's candidates leak into the next turn and a later write-less turn would settle the
stale DOC as its own canvas). Independent of the guarded OpenSpec clear (tying to it would leak
across non-OpenSpec turns). Flush (`selectCanvasTarget`) on `agent_end`, then reset; on abort,
reset without settle. The classifier is a pure shared module; accumulator + turn-boundary reset
is server wiring.

**Two resolution moments agree (doubt-review L/#13).** Phase-1 eager-open fires on the first
qualifying candidate; if `canvas()` is called (possibly twice) in the same turn, **last DECLARE
wins** for both the eager-open update and the turn-end settle — they cannot crown different
targets.

**Stress-test #3 + reach (doubt-review #6/H + cycle-2 #3).** Recency crowns the wrong file when
the deliverable is written first; and detection is blind to bash/skill-produced renderables
(`imagegen`, scripted PDFs) because those are not registered tools with output paths. Both are
covered by **DECLARE** (co-primary, Decision 5). Detect's reach is therefore **honestly scoped to
`write`/`edit` deliverables**; recency is its best-effort tie-break; precision and
bash/skill outputs need DECLARE. "Detect works with every model" means: any model that uses
`write`/`edit` gets auto-canvas for those; richer coverage is declare-driven.

**Turn contract (stress-test #5).** "Turn end" binds to `agent_end`. Sub-decisions:
- **Subagents (`Agent` tool):** a subagent's writes may not surface on the parent stream; a
  subagent that wants a canvas calls `canvas()`. Parent-turn detect does not reach into subagent
  tool calls in v1.
- **Abort / mid-turn-prompt-queue:** an aborted turn keeps whatever phase-1 already opened; no
  settle if `agent_end` never fires. Documented, tested.

---

## Decision 3 — Detect reach = `write`/`edit` outputs only; bash/skill → declare

**Choice (revised twice).** Cycle-1 dropped command-parsing + mtime-scan (fragile /
cross-session-unsafe) in favor of "harvest result-announced paths from any tool." Cycle-2 showed
that harvest is **fictional**: `imagegen` (`nano-banana`) and the document converters are
**bash-/skill-driven, not registered tools**, and `serve_mockup` announces a directory + URL,
not a renderable file path — there is no machine-readable output path to harvest.

**Final:** auto-detection reads `args.path` from **`write`/`edit`** calls only. This still
covers a directly-written `dist/report.pdf` (`.gitignore` is not consulted — generated
deliverables are valid). Per-session by construction (reads only this session's own tool args)
→ **CONTRACT 8 met**, no cross-session misattribution, no build-artifact noise. Everything
else — a scripted PDF, a `nano-banana` image, a `pandoc` render — reaches the canvas via the
`canvas()` declare-tool (Decision 5). Honest trade-off: no CLI parsing, no filesystem walk, no
fictional harvest; the cost is that non-`write`/`edit` deliverables need one `canvas()` call.

---

## Decision 4 — Server: L1 confirm-chip floor, L2 auto-open when allowlisted

**Hard constraint (non-negotiable).** `live-server-preview`: "Targets SHALL never be fetched
automatically from … agent-supplied input." An agent that starts a server and gets it
auto-iframed is a drive-by SSRF / auto-exfil vector.

**Degrade ladder.**
```
   ✗ L0 auto-open iframe                     — violates SSRF req. NO.
   ✓ L1 auto-SURFACE a confirm chip           — detect proposes, human taps
   ~ L2 auto-open IF port already allowlisted  — human confirmed it earlier
   ✗ L3 agent adds its own port to allowlist   — agent-driven trust. NO.
```

**Choice (revised after cycle-2 #1/#2: servers are DECLARE-ONLY — no auto-detection).** Cycle-2
verified that `serve_mockup` binds `0.0.0.0` but announces `localhost` (`packages/mockup-loop/src/
extension.ts`), so the server-side detector — which sees the *announced* host, not the socket —
cannot trust it for a loopback gate; and `npm run dev` (real 127.0.0.1) emits no structured
signal. Auto-detecting agent-started servers is therefore **dropped**.

**A server reaches the canvas only via `canvas({ target: { kind:"server", port } })`** (Decision 5)
or the existing manual `LiveServerViewer`.

**Probe on tap, not before (cycle-3 #1 — CONTRACT 1).** A pre-confirm probe of
`127.0.0.1:<agent-port>` would itself be an auto-fetch of agent-supplied input. So the chip
surfaces from the DECLARE **with no pre-confirm fetch**; the **loopback probe happens only on
chip tap** — the explicit-confirm gesture the SSRF requirement already mandates — routed through
the **existing `LiveServerViewer` allowlist-add endpoint** (`data-testid="live-confirm"`). The
tap probes `127.0.0.1:port` (never the agent-announced host), so the loopback guarantee is
*dashboard-verified at confirm time*, sidestepping the `serve_mockup` 0.0.0.0-announce problem.
There is **no auto-open path** (the earlier L2 "auto-open if allowlisted" rung is removed —
cycle-3 #4): every declared server surfaces a one-tap chip. The tap probe resolves as
**connection-refused → "server not running" immediately; no response within 3000ms → "server not
responding"** (scenario-design gate) — no iframe in either case. The **automatism is the
surfacing, not the fetch.**

---

## Decision 5 — `canvas()` declare-tool (co-primary), real tool not marker

**Choice: a real registered tool (D1), not a bridge-parsed prose marker (D2).** Claude uses a
prose marker because it only has a text stream; pi owns the tool registry + the bridge
classifier, so a real tool rides the exact tool-event path detect already taps.

**Registration location (cycle-2 #8).** `canvas()` MUST register in the **bridge extension**
(`packages/extension`, the `pi.registerTool` surface used by `serve_mockup`/`ask_user`) — NOT
server-side. Only the extension can expose a tool to pi; the extension already forwards
`tool_execution_start/end` to the server, where the canvas logic **observes** the `canvas` call
(same forwarded stream `detectOpenSpecActivity` reads). Registering it server-side would mean pi
never sees the tool. The tool is **fire-and-forget UI intent** — returns a trivial `{ok:true}`
ack, never blocks the model.

**Signature (doubt-review #3/#4/C — target is a convenience shape, NOT `ViewTarget`).** The
shipped `ViewTarget` is `{kind:"file";cwd;path} | {kind:"url";url}` — no `server` variant, and
`file` requires `cwd`. The tool input is a model-facing convenience shape **normalized
server-side into a real `ViewTarget`**:
```ts
canvas({
  target: { kind:"file"; path } | { kind:"url"; url } | { kind:"server"; port },
  mode?:  "replace" | "pin" | "section",   // default "replace"; maps to lifecycle states
  title?: string,
  section?: string,                         // mode:"section" only — DEFERRED (v2)
}) → { ok: true }                           // trivial ack; see filtering note below
```
Normalization (server-side): `file.path` + **session `cwd` (from server state, never the model)**
→ `{kind:"file";cwd;path}` (anti-traversal preserved); `url` passes through as a `ViewTarget`.
**`server.port` does NOT become a `ViewTarget`** (cycle-3 #2: the union has no server kind) — it
is routed directly to the Decision-4 chip path, bypassing `selectCanvasTarget`. A model-supplied
`cwd`/absolute-traversal path, or a rejected server, returns an **error result, not `{ok:true}`**
(cycle-3 #8: the ack must not claim success when nothing opened). `{ok:true}` is only for a
declare the dashboard accepted.

**Filtering — corrected (doubt-review #2/#5/D).** The earlier "filtered from the pi-bound stream
like `view` rows" was **false**: `view` rows are browser-injected into a separate store
(`inject_view_message` → `ViewMessageStore`) and never touch pi's event stream, so there is no
"tool-result stripping" precedent. `canvas()` is a real tool; pi writes its result into its own
history. Resolution: the result is a **trivial `{ok:true}` ack** — cheap and harmless to leave
in history; the dashboard drives the canvas by **observing the tool call in the forwarded event
stream** (same path as detect), not by any stream edit. No stream-filtering is claimed or needed.

**Compose rule (the hybrid contract).** Accumulate candidates from BOTH sources per turn;
`selectCanvasTarget`: if a DECLARE candidate exists, use it and **ignore all detected candidates
and the type registry**; else fall back to detect (DOC by recency; servers are declare-only). Declare-aware model
gets precision; every other model still gets best-effort detect. No flag day, graceful degrade.

**Restores liveness.** A model that calls `canvas({target:"report.md"})` *before* writing gives
eager-open-then-stream for free (Decision-1 phase 1 fires on the declared target).

**Teaching (declare's only real cost).** Tool description does the work ("Call when producing a
user-facing deliverable — report, doc, mockup"); optional mockup-loop skill nudge for the
server case. **No system-prompt bloat.** A model that never learns still gets detect.

---

## Decision 6 — Canvas-type registry: policy filter over `dispatchPreview`, default ALL

**Choice.** `canvasTypes: Record<RendererKind, boolean>` over the **8 non-`fallback` kinds**
(`markdown, asciidoc, html, pdf, image, video, audio, youtube` — no `svg` kind; `.svg`→`image`).
**Default every kind `true`** — this default is
**net-new** (the registry does not exist today), so it establishes the opt-out baseline rather
than describing pre-existing behavior. Two scopes, sparse override shallow-merged:
```
   effective = { ...DEFAULT_CANVAS_TYPES, ...global.canvasTypes, ...project.canvasTypes }
   global  → ~/.pi/agent/settings.json#dashboard.canvasTypes
   project → <cwd>/.pi/settings.json#dashboard.canvasTypes
```
The merge is the same *shape* as `mergeDisplayPrefs`'s nested `toolCalls` shallow-merge, but a
**new config path** (`settings.json#dashboard.canvasTypes`, a file `pi-package-resolver` already
walks for both scopes) — NOT a reuse of the `mergeDisplayPrefs` function itself (which reads
`preferences.json` + `.meta.json`). Doubt-review #7 correctly flagged the earlier over-claim.

**Separation of concerns.** `dispatchPreview` answers *can we render?* (renderer capability,
fixed in code); the registry answers *should it auto-canvas?* (policy, configurable). Keeping
them separate is the trick — this is also what "add all type content preview handling" means:
the DOC-candidate set widens to the **full non-`fallback` renderer universe** (image, video,
audio, youtube included), and the registry is what tames the resulting noise.

**Single gate.** The registry sits in exactly one place — the `detectCanvasIntent`
renderability gate: `if (kind === "fallback" || !effectiveCanvasTypes[kind]) return null`.
It **gates DETECT only**; `canvas()` (Decision 5) and manual `/view`/click bypass it — you
asked, so the noise concern is gone.

**No server toggle (cycle-3 #3).** After the declare-only narrowing there is no server
auto-suggestion to gate — a `{kind:"server"}` declare is explicit and (like all declares) bypasses
the registry. The earlier `autoSuggestServers` boolean is dropped; it would only have silently
suppressed an explicit agent declare.

**Granularity (Non-goal).** RendererKind-level only — the **8 real non-`fallback` kinds are
`markdown, asciidoc, html, pdf, video, audio, image, youtube`** (cycle-2 #6: there is NO `svg`
kind — `.svg` maps to `image`; earlier drafts wrongly listed `svg`). Per-extension granularity is
a sprawl for marginal value, deferred.

---

## Security posture (security-hardening discipline)

The through-line: **react to filesystem/loopback reality, never to agent-asserted intent** —
what keeps "the LLM drives the canvas" from becoming "the LLM drives the user's browser."

- **DOC auto-open is inert AND non-egressing in v1 (doubt-review #9/I — CSP is NOT deferred).**
  `HtmlPreview` renders with scripts disabled (`sandbox` without `allow-scripts`); mermaid/SVG
  script-stripped. But a no-JS doc can still `<img src=beacon>` — auto-open (no user click) is a
  NEW egress the manual flow lacks, so CONTRACT 7 requires the mitigation to ship WITH auto-open,
  not later. **v1 requirement:** an auto-opened **file-kind document** (`html`/`svg`/`md`/`pdf`
  the DOC-detect path opens without a click) carries a restrictive CSP blocking external
  subresources, so auto-open egress ≤ manual-click egress. **Scope (cycle-3 #9):** the CSP
  applies to file-document auto-open only. `canvas()` **URL/youtube** declares render the live URL
  (a CSP blocking subresources would break them) and are **egress-equal-to-manual** (the model, or
  the user, explicitly named that URL) — excluded, same as clicking a URL today. Server declares
  gate behind the chip tap. This is a spec requirement + task, not "Deferred."
- **SERVER path preserves the SSRF gate** (Decision 4) — automation surfaces, never fetches.
- **`canvas()` cannot escalate trust** — a `{kind:"server"}` declare still routes through the
  Decision-4 chip/allowlist; the tool cannot add its own port.

## Deferred (future extensions)

- `mode:"section"` region-update / highlight-to-edit (field reserved in the tool signature).
- Per-extension registry granularity (RendererKind-level only in v1).
- Persisted pins (survive server restart, like the live-server allowlist) — v1 pins are
  per-session ephemeral.
- Harvesting **path-silent bash outputs** (`curl -o`, wrapper scripts) — declare-tool covers
  these in v1 (Decision 3 known gap).
- Non-git versioning backing (stress-test #6): `git log` versioning collapses for
  gitignored/generated files (PDFs, built HTML) — exactly the canvas files — and disagrees with
  the working tree. v1 degrades to **"unversioned" for untracked files** (no version scrubber);
  a per-session in-memory write-log backing is future. Informed by the non-git handling in the
  adjacent `fix-session-diff-open-nongit-and-preview` change.
