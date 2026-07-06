## 1. Tree data model

- [x] 1.1 Add a pure `buildTree(candidates)` helper (split `relPath` on `/`, nest dirs, collect leaf files) — colocate with `FilePicker` or a small `file-tree.ts`
- [x] 1.2 Write unit tests for `buildTree`: nesting, single-child dirs kept separate, alphabetical dir order, leaf basename

## 2. Collapsible tree rendering (FilePicker.tsx)

- [x] 2.1 Write/extend `FilePicker.test.tsx`: candidates fold into directory + file rows, file rows show basename only, single-child dir not merged (assert the ADDED spec scenarios) — verify red
- [x] 2.2 Replace the flat `filtered.map(...)` with recursive tree rows using `mdiChevronDown/Right` + `depth*16px` indent (reuse `resource-tree.tsx` idiom); file rows keep `onSelect` + active state
- [x] 2.3 Wire the substring filter to keep a directory visible when any descendant matches, and force-expand matching branches while filtering → verify 2.1 green

## 3. Persisted collapse state

- [x] 3.1 Add test: folders default expanded with no persisted state; collapsing `.pi` then reload keeps only `.pi` collapsed — verify red
- [x] 3.2 Hold a `collapsed` `Set<string>` in state, hydrate from `localStorage` under a `dashboard:`-namespaced key (e.g. `dashboard:dirset-collapsed`, storing only collapsed paths), persist on toggle; wrap `localStorage` access so a throw degrades to in-memory → verify 3.1 green

## 4. Resizable tree column (InstructionsPage.tsx)

- [x] 4.1 Add test: dragging the gutter changes tree width within clamp; width restored from `localStorage` on mount — verify red
- [x] 4.2 Add a `col-resize` gutter between `FilePicker` and the editor pane by reusing/mirroring the existing `useSidebarState` hook (clamp + `localStorage`), not re-implementing persistence; replace `FilePicker`'s static `md:w-60` class with an inline `style={{ width }}`; clamp 200–560px, persist under `dashboard:dirset-width` on mouseup, restore on mount; hide the gutter below `md` → verify 4.1 green

## 5. Mobile master/detail layout

- [x] 5.1 Add test: below `md`, no gutter; with no `?file=` the tree is full-width and NO default file is auto-selected; selecting a file shows the editor; the editor's back control navigates to the page route with `?file=` cleared and returns to the tree — verify red
- [x] 5.2 Make the default-selection effect in `InstructionsPage` **viewport-gated**: at ≥`md` keep the AGENTS.md/first fallback; below `md` do NOT auto-select when `?file=` absent (leave `selected` null). Add a mobile editor-header back control that navigates to the page route with `?file=` cleared (do NOT rely on the depth-aware back action). Render tree OR editor keyed off `?file=`; rows ≥44px → verify 5.1 green
- [x] 5.3 Add a desktop regression test: at ≥`md`, absent `?file=` still applies the default selection and the existing file→file back-walk is unchanged

## 6. Verify & gate

- [x] 6.0 Verify the Directory-scope height wrapper: confirm the tree/editor split fills vertically under `directory-settings-content` (`overflow-y-auto`, no `flex flex-col`); if it does not, add `flex flex-col min-h-0` to that wrapper in `DirectorySettings.tsx` (parity with global `settings-content`) — surfaced by cross-model doubt review
- [x] 6.1 Run `npm test` (FilePicker + InstructionsPage suites green); manual check of both mockup behaviors against the running dashboard, including mobile viewport (tree↔editor back control)
- [x] 6.2 Run `npm run quality:changed` and the CodeRabbit review gate on the diff; fix Critical/Warning findings
- [x] 6.3 Update `packages/client/src/components/DirectorySettings/AGENTS.md` rows for the changed `FilePicker.tsx` / `InstructionsPage.tsx` with a `See change:` note
