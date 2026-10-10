## Why

A mermaid block with a minor syntax slip — an alias named `end`, an unclosed `alt`, parentheses in an unquoted label, `;` inside a label — renders today as a red error plus raw code, in chat, markdown files, AsciiDoc previews and `.mmd` files alike. LLM-authored diagrams hit these classes constantly. The fixes are mechanical: the global `mermaid-md-doctor` skill's `fix.py` rules (validated against the dashboard's mermaid build) already repair them in batch. The viewer should apply them on demand instead of giving up.

## What Changes

- **Rule-based repair on render failure.** When `MermaidBlock`'s render of the original source throws, it runs a pure, deterministic repair pass and renders the repaired source. Rules R1–R7 are a TS port derived from `fix.py` with deliberate fixes found in review (design D2; the skill's R8 is dropped because the existing pre-sanitizer already covers it). Only failing diagrams are touched; a valid diagram never goes through repair.
- **Honest display.** A diagram rendered from repaired source carries a visible "auto-fixed" badge listing the applied rule codes (with descriptions), a toggle to show the original source with its original error, and a "copy fixed source" action. The displayed diagram is never silently different from its source.
- **Fallback unchanged.** When no rule applies, or the repaired source still fails, the existing error + raw code display is shown (error message from the ORIGINAL render).
- **Cache covers the outcome.** The module-level cache keyed on (original code, theme) stores the final outcome — repaired SVG + repaired source + applied rules + original error, or error — so remounts and streaming re-renders never replay the repair.
- **One place, every surface.** Chat markdown, markdown file previews, AsciiDoc `[source,mermaid]` hydration and the `.mmd` viewer all mount `MermaidBlock`, so all inherit repair with no per-surface wiring. Streaming (`complete=false`) blocks are never repaired.
- Exports the `MermaidOutcome` type only; the follow-up changes (`add-mermaid-ai-repair`, `add-preview-apply-fix-to-file`) add their controls to the badge row when they land.

## Capabilities

### New Capabilities
- `mermaid-rule-repair`: the deterministic repair rule set (R1–R7), its purity/idempotence/no-op-on-valid guarantees, and the auto-fixed badge / show-original / copy-fixed display contract.

### Modified Capabilities
- `mermaid-diagram`: "Mermaid diagram rendering" — the invalid-syntax scenario applies only after repair fails; "Mermaid SVG cache prevents re-render blink" — caches repaired and error outcomes; "Mermaid hydration in AsciiDoc previews" — adoc-sourced diagrams are repaired like markdown ones.

## Impact

- `packages/client/src/components/preview/MermaidBlock.tsx`: render flow (original → repair → re-render), outcome cache, badge/toggle UI, extracted `mermaidConfig(resolved)`.
- New pure module `packages/client/src/lib/preview/mermaid-repair.ts` (+ tests; fixture ported from `~/.pi/agent/skills/mermaid-md-doctor/tests/broken.md` plus new R1/R7 cases).
- i18n keys in `i18n-en-source.json`, `i18n.tsx` (zh-CN), `i18n-hu.ts`.
- Out-of-band: backport the rule fixes to the `mermaid-md-doctor` skill (outside the repo).
- No server, API, config or dependency change. Rollback = revert the client change; no persisted state.
- Coordination: active change `sanitize-untrusted-rendered-content` replaces `MermaidBlock`'s regex SVG sanitizer — repaired SVG goes through whichever sanitizer is current (same path as unrepaired SVG).

## Discipline Skills

- `review-code`: non-trivial render-flow change in a hot, memoized component; review before commit.
- No security/perf/observability skill triggers: client-only, no untrusted-input boundary change (repair output follows the existing render + sanitize path), no new endpoint, and repair runs only on already-failed renders.
