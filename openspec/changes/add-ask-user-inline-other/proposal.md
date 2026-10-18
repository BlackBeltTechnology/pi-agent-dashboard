## Why

Issue: https://github.com/BlackBeltTechnology/pi-agent-dashboard/issues/872

When the agent calls `ask_user` and none of the options fit, the dashboard card offers no way to give a custom answer. The user has to leave the card and type in the separate chat composer. In `packages/client/src/components/interactive-renderers/`, `SelectRenderer` and `MultiselectRenderer` show only the listed options, and `BatchRenderer` uses `InputComposer` only for `input` sub-questions.

## What Changes

- **select:** an inline "Other" radio with a text field inside the card. The typed text becomes `value`.
- **multiselect:** an "Other" checkbox with a text field. The text is added to `values[]` next to the checked options.
- **batch:** the same row on every select/multiselect sub-step.
- No separate input step and no round-trip through the composer.
- The answer encoding is extended so it carries custom values (`packages/shared/src/prompt-answer.ts`, `packages/client/src/lib/questions/dialog-answer.ts`). Tests cover all three renderers.
- Open questions to settle in design:
  - Is a custom answer marked (`{custom:true}`) or sent as a plain string?
  - Does `confirm` get an "Other" row too? Leaning no.
  - Should an `allowOther:false` opt-out exist (default on)? Reconcile with the existing `allowCustom` parameter of the `ask_user` tool.

## Capabilities

### Modified Capabilities
- `interactive-renderers` — inline "Other" row on select, multiselect and batch.
- `prompt-answer-response-encoding` — custom values.
- `ask-user-tool` — opt-out/default semantics, aligned with `allowCustom`.

## Non-goals

- Free text on `confirm` (unless the design decides otherwise).
- Changing how the TUI renders `ask_user`.

## Discipline Skills

- `review-code` — before commit.
- The free text is user-authored and goes back to the agent as an answer. Render it as plain text, not HTML (that is the existing sanitization path). No new trust boundary, so `security-hardening` is not triggered.
- No perf or observability triggers.

## Impact

- `packages/client/src/components/interactive-renderers/{SelectRenderer,MultiselectRenderer,BatchRenderer}.tsx`, `packages/shared/src/prompt-answer.ts`, `packages/client/src/lib/questions/dialog-answer.ts`, the `ask_user` tool schema (extension).
- Accessibility: the "Other" text field is labelled, focuses when chosen, and works with the keyboard.
- Compatibility: additive answer shape. Older agents ignore the extra values. Rollback = revert.
