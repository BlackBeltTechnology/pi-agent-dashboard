# Tasks — Improve frontmatter rendering

## 1. Dependencies
- [x] 1.1 Add `remark-frontmatter` and `yaml` to `packages/client/package.json` → verify: `npm install` succeeds, lockfile updated
- [x] 1.2 Confirm `@mdi/js` already provides the needed type icons → verify: import resolves in a scratch file

## 2. FrontmatterProperties component
- [x] 2.1 Add `extractFrontmatter(content)` helper: match a single leading `---\n…\n---` block, return `{ raw, body }` or null → verify: unit test for present / absent / mid-document `---`
- [x] 2.2 Create `packages/client/src/components/FrontmatterProperties.tsx`: parse raw with `yaml.parse` in try/catch; render collapsed panel (`▸ Properties · N fields`), expand on click → verify: renders rows for a sample skill frontmatter
- [x] 2.3 Implement value typing (text/para/number/date/list/bool/link/object/empty) + `status` known-key badge + relative-date formatting → verify: unit tests per type
- [x] 2.4 Malformed-YAML path: warn banner + raw lines; wrap render so a throw degrades to nothing → verify: malformed input test renders banner, body unaffected

## 3. Wire into MarkdownContent
- [x] 3.1 Add `frontmatter?: "hide" | "properties"` prop (default `"hide"`) to `MarkdownContent` → verify: type-checks
- [x] 3.2 Add `remark-frontmatter` to the remark plugin chain; ensure body no longer mangles → verify: scenario "Leading frontmatter does not mangle the body"
- [x] 3.3 When `"properties"` and a block is present, render `FrontmatterProperties` above the body → verify: scenario "Properties mode renders a collapsed panel"

## 4. Opt-in surfaces
- [x] 4.1 `MarkdownPreviewView` passes `frontmatter="properties"` → verify: spec scenario "Frontmatter renders as Properties panel"
- [x] 4.2 `FilePreviewOverlay` markdown branch passes `frontmatter="properties"` → verify: spec scenario "Markdown file with frontmatter opened in overlay" (also opted in the inline `preview/MarkdownPreview.tsx` surface per the spec's "any inline markdown preview surface")
- [x] 4.3 Confirm `ChatView` and other non-opt-in callers keep the default (no panel) → verify: chat render test unchanged

## 5. Tests & verification
- [x] 5.1 Add/extend `MarkdownContent.test.tsx` with the new spec scenarios (hide default, properties, typed values, status badge, nested object, malformed, no-frontmatter)
- [x] 5.2 `npm test` green → verify: full vitest run passes (1 unrelated flaky failure: `recovery-server.test.ts` port-exhaustion under parallel load; passes in isolation)
- [x] 5.3 `npm run quality:changed` clean → verify: new code biome-clean + tsc passes; pre-existing warnings in touched files untouched per surgical-changes
- [x] 5.4 Visual check against `./mockups/` in a real browser (dark + light) → verify: dialog + preview surfaces match the mockup design (verified via scratch Vite harness; dark + light screenshots match dialog/preview mockups — typed rows, status badge, date relative suffix, chips, bool, nested sub-grid, malformed warn banner)
