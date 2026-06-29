## Why

`MarkdownContent` loads only `remark-gfm` + `remark-math` — no frontmatter plugin. So CommonMark misparses every YAML frontmatter block: the leading `---` becomes a thematic break (`<hr>`), the YAML lines become a paragraph, and the closing `---` is read as a setext H2 underline. Net effect: the entire frontmatter block renders as one giant heading. Every `.md` surface that carries frontmatter is affected — SKILL.md (always has it), OpenSpec proposals/specs, READMEs, and any `.md` a user opens via a file link.

Frontmatter carries genuinely useful reader context (a skill's `description`/`triggers`, a proposal's `status`/`capability`). The fix should not just hide it — it should present it richly, the way Obsidian's "Properties" panel does.

## What Changes

- **Parse frontmatter, stop the mangling.** Add `remark-frontmatter` to the remark plugin chain so a leading `---…---` block becomes a discrete `yaml` node instead of poisoning the markdown parse. Add a YAML parser dependency (`yaml`) to read the block into typed values.
- **New `FrontmatterProperties` component** — an Obsidian-style Properties panel rendered above the markdown body. Collapsed by default (`▸ Properties · N fields`); click to expand. Typed rows with a per-kind icon: text, paragraph, number (monospace), date (with relative suffix), list (chips), boolean (check/cross), link (clickable), and known-key promotion (`status` → colored badge). Nested objects render as an indented sub-grid.
- **New `frontmatter` prop on `MarkdownContent`** — `"hide" | "properties"`, default `"hide"`. Default preserves chat behavior (and upgrades it from mangled garbage to cleanly hidden). File/spec/skill surfaces opt in with `"properties"`.
- **Graceful failure.** Malformed YAML never crashes the render — it degrades to a warn banner with raw values, inside the existing `ErrorBoundary` discipline.
- **Surfaces that opt in:** `FilePreviewOverlay`, `MarkdownPreviewView` (OpenSpec proposals/specs, package READMEs, skill SKILL.md). Chat (`ChatView`) stays `"hide"`.

## Capabilities

### Modified Capabilities

- `markdown-rendering`: ADD a `Frontmatter rendering` requirement covering the `frontmatter` prop, `remark-frontmatter` integration, the typed Properties panel, collapsed-default behavior, and malformed-YAML fallback. The existing `Markdown text rendering` requirement is NOT rewritten — its plugin sentence lists gfm+math as *enabled* (non-exclusive), so adding `remark-frontmatter` is additive and contradicts nothing.
- `markdown-preview-view`: MODIFY `Generic markdown preview component` so it passes `frontmatter="properties"` to `MarkdownContent`.
- `file-and-url-preview`: ADD a requirement that the markdown overlay/inline renderer enables frontmatter properties.

## Impact

- **Affected packages**: `packages/client` only — `MarkdownContent.tsx` (prop + remark plugin + render branch), new `FrontmatterProperties.tsx`, `MarkdownPreviewView.tsx` + `FilePreviewOverlay.tsx` (pass the prop), `package.json` (new dep). No server, bridge, shared-protocol, or Electron changes.
- **New npm dep (client only)**: `remark-frontmatter` (+ its `mdast-util-frontmatter` peer, already transitive) and `yaml`. Bundle delta is small (`yaml` ≈ 40 KB min, `remark-frontmatter` ≈ a few KB).
- **Chat is untouched** — default `"hide"` means `ChatView` renders exactly as today, except a stray leading frontmatter block now disappears instead of mangling.
- **Icons**: reuse existing `@mdi/js` paths (already a dependency) for the per-type row icons rather than bundling new SVGs.
- **Backward compatibility**: purely additive prop with a behavior-preserving default. No protocol or persistence change.
- **Design reference**: mockups in `openspec/changes/improve-frontmatter-rendering/mockups/` (`obsidian.html`, `dialog.html`, `preview.html`, `edge-cases.html`).
