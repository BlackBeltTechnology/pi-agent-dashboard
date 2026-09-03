# mdi-icon-system Specification

## Purpose

Replaces emoji icons throughout the UI with MDI icons, so iconography renders consistently across platforms. Defines the component contracts this requires — icon props accepting `ReactNode`, icon lookup maps returning `ReactNode`, the icon-plus-text pattern for labelled actions — and the deliberate exception that cancel buttons stay text-only.

## Requirements

### Requirement: MDI icons replace all emoji icons
The system SHALL use Material Design Icons (`@mdi/js` + `@mdi/react`) for all icons in client components. No emoji characters SHALL be used as icons. All buttons SHALL display an MDI `<Icon>` component for their visual indicator — text-only labels, emoji characters, and Unicode symbols (✕, ×, ←, ↻, ▶, ▼, +) SHALL NOT be used as button icons.

#### Scenario: Copy buttons show MDI icons
- **WHEN** a copy button is rendered (code block, markdown, chat view)
- **THEN** it SHALL display an MDI `Icon` component instead of emoji (📋, 📊, 📝)

#### Scenario: Tool call status shows MDI icons
- **WHEN** a tool call step is rendered with status running, complete, or error
- **THEN** it SHALL display an MDI icon (mdiLoading, mdiCheck, mdiAlertCircle) instead of emoji (⏳, ✓)

#### Scenario: Expand/collapse shows MDI chevrons
- **WHEN** a tool call step or collapsible section has an expand/collapse toggle
- **THEN** it SHALL display mdiChevronRight (collapsed) or mdiChevronDown (expanded) instead of ▶/▼

#### Scenario: Session source shows MDI icons
- **WHEN** a session is displayed in sidebar or card
- **THEN** source icons SHALL be MDI (mdiMonitor for tui, mdiFlash for zed, mdiWeb for dashboard, mdiHelpCircle for unknown)

#### Scenario: Command input shows MDI icons
- **WHEN** command suggestions are displayed
- **THEN** source type icons SHALL be MDI (mdiFlash for extension, mdiClipboardText for prompt, mdiWrench for skill)

#### Scenario: Extension UI shows MDI icons
- **WHEN** permission or selection UI is rendered
- **THEN** status icons SHALL be MDI (mdiCheckCircle for allowed, mdiCloseCircle for denied, mdiLoading for pending)

#### Scenario: Dialog close buttons show MDI close icon
- **WHEN** a dialog has a close/dismiss button (ExploreDialog, NewChangeDialog, TerminalView, etc.)
- **THEN** it SHALL display `<Icon path={mdiClose} />` instead of ✕ or × characters

#### Scenario: Back buttons show MDI arrow icon
- **WHEN** a view has a back/navigation button (FileDiffView, MarkdownPreviewView, ZrokInstallGuide, etc.)
- **THEN** it SHALL display `<Icon path={mdiArrowLeft} />` instead of ← text

#### Scenario: Action buttons show MDI icons
- **WHEN** a session action button is rendered (Resume, Fork, Run Flow, Attach, Changed Files, etc.)
- **THEN** it SHALL display an appropriate MDI icon inline with the text label

#### Scenario: Flow control buttons show MDI icons
- **WHEN** flow dashboard controls are rendered (Auto toggle, Abort, Collapse)
- **THEN** they SHALL display MDI icons (mdiRobotOutline, mdiStop, mdiChevronUp)

#### Scenario: Refresh buttons show MDI refresh icon
- **WHEN** a refresh or retry button is rendered (FileDiffView, PiResourcesView, etc.)
- **THEN** it SHALL display `<Icon path={mdiRefresh} />` instead of ↻ text

#### Scenario: OpenSpec section buttons show MDI icons
- **WHEN** FolderOpenSpecSection renders Archive and Specs buttons
- **THEN** Archive SHALL display `<Icon path={mdiArchiveOutline} />` and Specs SHALL display `<Icon path={mdiFileDocumentOutline} />`

#### Scenario: Diff panel mode toggles show MDI icons
- **WHEN** DiffPanel renders Diff/File and Split/Unified toggle buttons
- **THEN** they SHALL display MDI icons (mdiCompare, mdiFileOutline, mdiViewSplitVertical, mdiViewSequential)

#### Scenario: OpenSpec action buttons show MDI icons
- **WHEN** SessionOpenSpecActions renders action buttons (Explore, Continue, FF, Apply, Verify, Archive, Detach, Bulk Archive, Attach, Change)
- **THEN** each button SHALL display an appropriate MDI icon (mdiCompassOutline, mdiChevronRight, mdiFastForward, mdiPlayCircleOutline, mdiCheckCircleOutline, mdiArchiveOutline, mdiLinkOff, mdiArchiveArrowUp, mdiPaperclip, mdiPlus)

#### Scenario: OpenSpec activity badge shows MDI icon
- **WHEN** OpenSpecActivityBadge renders the 📋 indicator
- **THEN** it SHALL display `<Icon path={mdiClipboardTextOutline} />` instead of emoji

#### Scenario: Thinking level selector shows MDI icon
- **WHEN** ThinkingLevelSelector or SessionHeader renders the thinking level indicator
- **THEN** it SHALL display `<Icon path={mdiHeadLightbulb} />` instead of 💭 emoji

#### Scenario: Flow activity badge shows MDI icons
- **WHEN** FlowActivityBadge renders status indicators (running, success, error, aborted)
- **THEN** it SHALL display MDI icons (mdiLoading, mdiCheckCircle, mdiAlertCircle, mdiStopCircle) instead of emoji/text

#### Scenario: Flow agent card shows MDI status icons
- **WHEN** FlowAgentCard renders agent status (pending, running, complete, error, blocked)
- **THEN** it SHALL display MDI icons (mdiCircleOutline, mdiLoading, mdiCheckCircle, mdiCloseCircle, mdiAlertCircle) and loop indicator SHALL use mdiRefresh instead of ↻

#### Scenario: Flow agent detail shows MDI status icons
- **WHEN** FlowAgentDetail renders agent status in the header
- **THEN** it SHALL display MDI icons (mdiCheckCircle, mdiCloseCircle, mdiAlertCircle, mdiCircle, mdiCircleOutline) instead of text symbols

#### Scenario: Flow summary shows MDI status icons
- **WHEN** FlowSummary renders flow and per-agent status
- **THEN** it SHALL display MDI icons for both flow-level (mdiCheckCircle, mdiAlertCircle, mdiStopCircle) and agent-level status

#### Scenario: Model selector shows MDI loading icon
- **WHEN** ModelSelector shows a pending model change
- **THEN** it SHALL display `<Icon path={mdiLoading} />` with spin animation instead of ⏳ emoji

#### Scenario: Pin directory button shows MDI icons
- **WHEN** SessionList renders the pin-a-directory button
- **THEN** it SHALL display `<Icon path={mdiPin} />` and `<Icon path={mdiPlus} />` instead of 📌+ emoji

### Requirement: CopyButton accepts ReactNode icon prop
The CopyButton component SHALL accept a `ReactNode` type for its `icon` prop to support MDI `Icon` components.

#### Scenario: CopyButton renders MDI icon
- **WHEN** CopyButton receives an `<Icon path={mdiContentCopy} />` as icon prop
- **THEN** it SHALL render the SVG icon in default state and mdiCheck icon in copied state

### Requirement: Icon lookup maps return ReactNode
All icon lookup maps (statusIcons, sourceIcons, editorIcons) SHALL return `ReactNode` values instead of string values.

#### Scenario: Icon maps used in JSX
- **WHEN** a component looks up an icon from a map
- **THEN** the returned value SHALL be a valid React element renderable in JSX

### Requirement: Labeled action buttons use icon + text pattern
Action buttons with visible text labels SHALL display an MDI icon inline before the text. The icon SHALL use `size={0.4}` with `className="inline mr-0.5"` for compact buttons, or `size={0.5}` with `className="mr-1"` for dialog-sized buttons.

#### Scenario: Session resume button has icon and text
- **WHEN** a session card renders a Resume button
- **THEN** it SHALL display `<Icon path={mdiPlayCircleOutline} size={0.4} />` followed by text "Resume"

#### Scenario: Session fork button has icon and text
- **WHEN** a session card renders a Fork button
- **THEN** it SHALL display `<Icon path={mdiSourceFork} size={0.4} />` followed by text "Fork"

#### Scenario: Run flow button has icon and text
- **WHEN** SessionHeader or SessionFlowActions renders a Run Flow button
- **THEN** it SHALL display `<Icon path={mdiPlay} size={0.4} />` followed by text "Flow" or "Run Flow..."

#### Scenario: Changed files button has icon and text
- **WHEN** SessionHeader renders the Changed Files button
- **THEN** it SHALL display `<Icon path={mdiFileCompare} size={0.4} />` followed by text "Changed Files"

#### Scenario: Attach button has icon and text
- **WHEN** SessionHeader renders the Attach OpenSpec button
- **THEN** it SHALL display `<Icon path={mdiPaperclip} size={0.4} />` followed by text "Attach"

### Requirement: OpenSpec ActionButton accepts optional icon prop
The SessionOpenSpecActions ActionButton helper SHALL accept an optional `icon` string prop (MDI path). When provided, it SHALL render `<Icon path={icon} size={0.4} className="inline mr-0.5" />` before the label text.

#### Scenario: ActionButton renders icon when provided
- **WHEN** ActionButton receives an `icon` prop
- **THEN** it SHALL display the MDI icon inline before the label

#### Scenario: ActionButton renders text-only when no icon
- **WHEN** ActionButton does not receive an `icon` prop
- **THEN** it SHALL display only the label text

### Requirement: Flow status maps use ReactNode icons
All flow status icon maps (FlowActivityBadge, FlowAgentCard, FlowSummary) SHALL return `ReactNode` values containing MDI `<Icon>` components instead of string emoji/text values.

#### Scenario: Flow status maps render SVG icons
- **WHEN** a flow component looks up a status icon from its config map
- **THEN** the returned value SHALL be an MDI `<Icon>` React element

### Requirement: Cancel buttons remain text-only
Cancel buttons in dialogs SHALL NOT have icons. They are secondary actions and SHALL use text-only styling to maintain visual hierarchy with the primary action button.

#### Scenario: Dialog cancel button is text-only
- **WHEN** a dialog renders a Cancel button (ExploreDialog, FlowLaunchDialog, BranchPicker, etc.)
- **THEN** it SHALL display only the text "Cancel" without an icon
