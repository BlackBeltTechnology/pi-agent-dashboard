## MODIFIED Requirements

### Requirement: Tool-result error surfaces source severity colour from the shared tokens

The chat transcript's tool-result error surfaces SHALL source severity colour
from `--severity-*` tokens, not from raw Tailwind literals. The existing
no-raw-literals requirement enumerates `Toast.tsx`, `SpawnErrorToastHost.tsx`,
`SpawnErrorBanner.tsx`, `extension-ui/ToastSlot.tsx` and `NotifyRenderer.tsx`;
the tool-result renderers were omitted from that list and still ship raw
`red-300` / `red-400` / `red-500` / `red-950` literals. They are added to the
governed set (paths without a package prefix are under `packages/client/src/components/`):

- `tool-renderers/CtxToolRenderer.tsx` — the error card's border, fill and label
- `tool-renderers/AskUserToolRenderer.tsx` — the error icon and message
- `packages/subagents-plugin/src/client/AgentToolRenderer.tsx` — the subagent error line (moved from `tool-renderers/AgentToolRenderer.tsx` by `decouple-plugins-from-core`; it stays governed at its new path)
- `chat/ToolBurstGroup.tsx` — the `N failed` badge
- `chat/BashOutputCard.tsx` — the non-zero `exit N` badge
- `chat/ToolCallStep.tsx` — the errored tool's status icon

These literals are dark-mode-tuned, so every one of these surfaces currently
clears the floor in dark mode and fails it in light mode.

#### Scenario: Component inspection finds no hardcoded severity colour
- **WHEN** the six governed tool-result components are inspected
- **THEN** severity backgrounds, borders, text and icon colours SHALL derive from `--severity-*` (directly or via a class map)
- **AND** SHALL NOT use raw `red-300` / `red-400` / `red-500` / `red-950` literals, with or without an alpha suffix

#### Scenario: A raw literal cannot re-enter a governed surface
- **WHEN** a raw `red-<NNN>` Tailwind literal is introduced into any file in the governed set
- **THEN** a static check SHALL fail and identify the file and line

#### Scenario: Non-error surfaces are unaffected
- **WHEN** files outside the governed set use raw red literals for non-severity purposes, such as a destructive-action button
- **THEN** the check SHALL NOT fail

#### Scenario: Moved renderer stays governed
- **WHEN** a raw `red-<NNN>` literal is introduced into `packages/subagents-plugin/src/client/AgentToolRenderer.tsx`
- **THEN** the static check SHALL fail and identify the file and line
