# Tasks

## 1. Implementation
- [x] 1.1 In `FolderDragGutter` (`packages/client/src/components/session/SessionList.tsx`), remove the collapse chevron button's `onPointerDown={(e) => e.stopPropagation()}` so pointerdown bubbles to the gutter's dnd-kit listeners.
- [x] 1.2 Change the chevron button cursor to `cursor-grab active:cursor-grabbing` to match the gutter.
- [x] 1.3 Update the `FolderDragGutter` doc comment to describe the chevron+gutter dual drag handles and the 5px click-vs-drag distinction.

## 2. Tests
- [x] 2.1 Existing drag-reorder + SessionList suites pass (`workspace-drag-reorder`, `session-drag-reorder`, `SessionList.expanded-pinned-drag`, `SessionList`) — chevron click-to-toggle (`folder-toggle-btn`) still works.

## 3. Validate
- [x] 3.1 `openspec validate folder-chevron-drag-handle --strict` passes.
- [x] 3.2 Manual: click chevron toggles collapse; drag chevron reorders; collapsed folder reorders via chevron; gutter column still drags.
