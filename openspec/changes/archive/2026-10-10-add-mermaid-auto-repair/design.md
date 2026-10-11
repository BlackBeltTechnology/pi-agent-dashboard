## Context

See proposal.md — Why. `MermaidBlock` (`packages/client/src/components/preview/MermaidBlock.tsx`) runs `sanitizeMermaidCode` (trim, decode `&gt; &lt; &amp; &quot; &#39;`, dedent) before `mermaid.render()` through a serialized render queue (`renderMermaid`), and caches success (`_svgCache`) and failure (`_errorCache`) per `(code, themeId)`; a theme re-initialization clears both maps globally. The render id is generated once per effect; mermaid is initialized with `suppressErrorRendering: true`, and a defensive `#d<id>` cleanup runs on the success path. The rule source is `~/.pi/agent/skills/mermaid-md-doctor/scripts/fix.py`; its fixture is `tests/broken.md` (covers R2–R6 + R8; no R1/R7 case).

## Goals / Non-Goals

**Goals:** repair the known failure classes client-side, instantly, offline; never alter a valid diagram; make every repair visible.

**Non-Goals:** LLM repair (`add-mermaid-ai-repair`); writing fixes back (`add-preview-apply-fix-to-file`); markdown/AsciiDoc markup repair (`add-md-adoc-markup-repair`); size-limit failures (`maxTextSize`/`maxEdges`); double-encoded HTML entities; exotic layouts beyond `flowchart-*` normalization.

## Decisions

### D1 — Repair only after a real render failure
```mermaid
flowchart TD
  A["render(id, normalize(original))"] -->|ok| S["outcome: ok"]
  A -->|throws err0| B["repairMermaid(normalized)"]
  B -->|applied = []| E["outcome: error(err0)"]
  B -->|applied ≠ []| C["render(id + '-r', repaired)"]
  C -->|ok| R["outcome: repaired {svg, code, applied, error: err0}"]
  C -->|throws| E
```
Both attempts run inside the same queued `renderMermaid` job (no interleaving with other diagrams). The retry uses a distinct id (`<id>-r`) because mermaid render ids must be unique; the existing defensive `#d<id>` cleanup runs after each attempt. Alternative — always repair before render: rejected; R4/R7 would rewrite valid diagrams.

### D2 — Port derived from `fix.py`, with deliberate fixes
`repairMermaid(code): { code: string; applied: RuleId[] }` in `packages/client/src/lib/preview/mermaid-repair.ts`; pure, no DOM, no mermaid import. Canonical `RuleId = "R1" | "R2" | "R3" | "R4" | "R5" | "R6" | "R7"`; the badge shows these codes; each has an i18n tooltip description. Order: R1, R2, R3, R6, R4, R5, R7 (fix.py order minus R8).

Deliberate deviations from `fix.py` (all found by review; backported to the skill out-of-band, task 4.2):
- **R8 dropped.** `sanitizeMermaidCode` already decodes single-encoded entities (a superset of R8's) before repair. Double-encoded input (`&amp;gt;`) is out of scope: decoding it one level per pass would break idempotence.
- **R1** strips `[\u200b-\u200d\u2060\ufeff]`, not just U+FEFF/U+200B.
- **R2** never renames a line consisting solely of `end` (the block terminator); the replacement alias is `p_<alias>`, suffixed `_2`, `_3`… until it collides with no existing identifier (deterministic).
- **R4** quotes only a `|label|` directly attached to an edge operator (`-->`, `---`, `-.->`, `==>`, `--x`, `--o` and their longer forms), never text between two edges and never pipes inside a quoted label. fix.py's any-`|…|`-pair regex re-quotes `B -->` in `A -->|x| B -->|y| C` on a second pass and splits `A["a|b|c"]`.
- **R5** accepts an edge operator, `&`, `:::`, `;`, whitespace or end-of-line after the closing bracket (fix.py misses `A[x (y)]-->B`), and, because of that wider context, skips bracket pairs inside an existing double-quoted label.
- **R7** replaces `;` with `,` and `#` with `no.` inside quoted flowchart labels, leaving mermaid entity escapes `#\w+;` / `#\d+;` untouched.
- **Kind detection** skips a leading `---`…`---` YAML frontmatter block and `%%` lines; `flowchart-elk` (any `flowchart-*`) counts as `flowchart`.
- The port follows `fix.py`'s implementation, not its module docstring (which claims R7 escapes quotes).

### D3 — Cache stores the outcome, keyed on the original
One map `(original code, themeId) → MermaidOutcome`, where `MermaidOutcome = {kind:"ok",svg} | {kind:"repaired",svg,code,applied,error} | {kind:"error",message}`. Replaces `_svgCache` + `_errorCache` (only `packages/client/src/components/__tests__/MermaidBlock.test.tsx` imports them). The global `clear()` on theme re-initialization stays and is now stated in the spec.

### D4 — Badge UI
A repaired outcome renders a badge row above the viewport: "Auto-fixed: R4 R5" — each code carries `aria-describedby` pointing at visually-hidden localized description text (plus `title` for mouse users) · "Show original" toggle (`aria-pressed`) · copy-fixed (`CopyButton`). "Show original" renders the error block — the raw `code` prop plus the stored original error — and sets the viewport's `hidden` attribute (display:none ⇒ not tabbable, no visible zoom controls) instead of unmounting it, and clears `focused`. **New guard:** today `measure()` (`MermaidBlock.tsx` fit `useLayoutEffect`) always calls `setFit(computeFitScale(...))`, and `computeFitScale` returns 1 for a non-positive viewport (`mermaid-fit.ts`); hiding fires the `ResizeObserver` with 0×0, which would re-seed an untouched `useZoomPan` to scale 1. This change adds a zero-rect early return in `measure()`. Zoom/pan state itself lives in `useZoomPan` state and survives either way. `showOriginal` resets to false whenever the outcome identity (`code`+`themeId`) changes, so a live instance whose diagram becomes valid, or re-renders under a new theme, never sits in show-original with no badge. Badge clicks are outside `viewportRef` and therefore unfocus the diagram (document `mousedown` handler) — accepted, toggling should unfocus.

### D5 — No runtime seam for follow-ups yet
Only the `MermaidOutcome` type is exported; follow-up changes add their controls to the badge row when they land (YAGNI).

### D6 — Shared mermaid config
The inline `mermaid.initialize({...})` literal becomes an exported factory `mermaidConfig(resolved)` in a new React-free module `packages/client/src/components/preview/mermaid-config.ts`, so the integration test (task 1.3) and the component use the same config.

## Risks / Trade-offs

- [A rule changes meaning, e.g. R7 `#`→`no.`] → only on failed diagrams; badge names the rule; original one click away.
- [Regex rules misfire on exotic syntax] → falls back to the original error; never worse than today.
- [Flagship cases (e.g. `participant end`) depend on the pinned mermaid version actually rejecting them] → task 1.3 asserts each fixture's original FAILS parse, so a vacuous fixture is caught.
- [Parse-level test ≠ render] → task 1.3 is a parse smoke check (jsdom lacks layout); real render covered by manual task 4.4.
- [`flow_write` card (`FlowWriteToolRenderer.tsx` → `MarkdownContent`) shows a repaired diagram differing from `flowToMermaid` output] → accepted; the badge then signals a generator bug.
- [Baseline `mermaid-diagram` text says DOMPurify; code uses a regex sanitizer] → left verbatim; `sanitize-untrusted-rendered-content` owns that wording.
- [Skill's `pi-canvas` profile uses the dashboard's mermaid build but not its dark theme/fonts] → port is validated in-repo against `mermaidConfig`, not via the skill.

## Migration Plan

Client-only. `npm run build` + restart. Rollback = revert; no persisted data.
