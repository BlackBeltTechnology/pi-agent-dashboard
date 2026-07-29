# Tasks — folder-tools-overflow-menu

## 1. Overflow menu component

- [ ] 1.1 Add a focused `FolderToolsMenu` component using existing menu/sheet
      conventions and accessible trigger state. → verify: component test opens
      it with a keyboard/click activation and observes `aria-expanded`.
- [ ] 1.2 Render supplied secondary folder content without creating duplicate
      actions or changing its callbacks. → verify: test renders a fixture
      section and invokes its action through the open menu.
- [ ] 1.3 Omit the trigger when no eligible content exists. → verify: component
      test renders no trigger for an empty content set.

## 2. Folder-group integration

- [ ] 2.1 Keep `FolderSpawnButtons` as the first, always-visible action surface
      in an expanded folder group. → verify: existing spawn button test IDs
      remain present and their handlers fire.
- [ ] 2.2 Route the existing `SidebarFolderSectionSlot` and eligible
      `FolderOpenSpecSection` into `FolderToolsMenu`. → verify: folder-list
      test finds them only after opening Folder tools.
- [ ] 2.3 Preserve OpenSpec pending/loading rendering and all existing board,
      specs, archive, and refresh callbacks. → verify: tests cover pending and
      initialized OpenSpec fixtures.

## 3. Regression coverage

- [ ] 3.1 Test click propagation: opening Folder tools does not toggle/collapse
      the parent folder. → verify: expanded folder remains expanded after
      trigger activation.
- [ ] 3.2 Run relevant client component tests and client build/typecheck. →
      verify: commands exit 0.
