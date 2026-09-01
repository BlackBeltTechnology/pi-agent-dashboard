# sleek-chat-design Specification

## Purpose

Visual contract for the chat view: message bubble borders, a divider before the copy button in messages, and an accent on tool call steps.

## Requirements

### Requirement: Message bubble borders
User message bubbles SHALL have `border border-blue-500/20` in addition to their background. Assistant message bubbles SHALL have `border border-gray-700/40` in addition to their background.

#### Scenario: User message styling
- **WHEN** a user message is rendered
- **THEN** it SHALL have `bg-blue-600` background AND `border border-blue-500/20`

#### Scenario: Assistant message styling
- **WHEN** an assistant message is rendered
- **THEN** it SHALL have `bg-gray-800` background AND `border border-gray-700/40`

### Requirement: Copy button divider in messages
Copy buttons within message bubbles SHALL be separated from message content by a thin horizontal divider (`border-t border-gray-700/30`), with slight top padding.

#### Scenario: Copy buttons with divider
- **WHEN** a message bubble with copy buttons is rendered
- **THEN** a thin divider line SHALL appear between the message content and the copy button row

### Requirement: Tool call step accent
Tool call steps in the chat view SHALL display a subtle left border accent (`border-l-2 border-gray-700/50`) and slightly increased padding for visual distinction.

#### Scenario: Tool call step rendering
- **WHEN** a tool call step is rendered in the chat view
- **THEN** it SHALL have a `border-l-2 border-gray-700/50` left accent and `pl-3` padding
