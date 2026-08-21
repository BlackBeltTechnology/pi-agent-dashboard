# DOX — packages/client/src/components/chat

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `BashOutputCard.tsx` | Renders `!`/`!!`/slash-exec bash output card (command header, exit badge, output pre). → see `BashOutputCard.tsx.AGENTS.md` |
| `ChatView.tsx` | `msg.view` rows render as `<PreviewCard target={msg.view}>` (right-aligned, `bubbleMax` width) BEFORE… → see `ChatView.tsx.AGENTS.md` Merges a default `fileLink` into `toolContext` once (`useMemo`) and passes it to ALL consumers incl. `ToolBurstGroup`/`CollapsedToolGroup`. See change: cleanup-import-cycles. Third pending-prompt render arm for `status=="failed"` (`data-testid="pending-prompt-failed"`, text preserved, never the emerald tick). See change: fix-optimistic-prompt-stuck-sending. |
| `ChatViewMenu.tsx` | Discord-style ⚙ View popover mounted in chat toolbar. Edits per-session `displayPrefsOverride` via… → see `ChatViewMenu.tsx.AGENTS.md` |
| `collapse-summary.tsx` | Shared PROCESS-subcard summary primitives: `splitOverflow<T>` (pure head/overflow-tail sort-then-slice split) + `<CollapseSummary>` (chevron toggle button owning `aria-expanded`+click→onToggle). See change: stable-process-line. |
| `CollapsedToolGroup.tsx` | Renders collapsed group of repeated tool calls. Exports `CollapsedToolGroup`. → see `CollapsedToolGroup.tsx.AGENTS.md` |
| `CommandFeedbackCard.tsx` | Inline card showing slash-command execution feedback. Exports `CommandFeedbackCard`. Status map `started`/`completed`/`error` → icon + color + label. Shows `message` only on `error`. |
| `CommandInput.tsx` | Chat composer textarea + autocomplete. Exports `CommandInput`, `parseViewCommand`, `shouldWalkFileQuery`,… → see `CommandInput.tsx.AGENTS.md` `pendingPrompt` prop is now the status union, not a boolean; only `"sending"` gates the composer. See change: fix-optimistic-prompt-stuck-sending. New `modelRefreshErrors?` prop forwarded to `ModelSelector.refreshErrors`. See change: upgrade-model-selector-primitives. |
| `HistoryGapDivider.tsx` | Click-to-load interstitial disclosing a windowed replay's elided middle. Sits BETWEEN two loaded regions (the gap is bounded on both sides) — not a top-anchored "load older" header. States: A1 idle (`history-gap-count` + `history-gap-load`), A2 `history-gap-loading` (`aria-busy`), A4 `history-gap-error` + `history-gap-retry`, A5 `history-gap-unavailable` (tombstone, no retry — nothing failed, events were trimmed); divider removed entirely once filled. Every protocol `error` code collapses to ONE plain sentence — codes never reach the user. Tokens: `--text-secondary`/`--text-primary` only (`--text-muted` fails AA; `--text-tertiary` is 4.477:1 on light and is a non-text border token). Pill 44px below 480px, 32px above. See change: lazy-load-session-history. |
| `MissingToolInlineError.tsx` | Inline chat error for missing shell binary. `[Install <tool> →]` flags `requestToolInstall` then navigates `/settings?tab=general`. See change: register-bash-and-tool-install-help. |
| `RawEventCard.tsx` | Collapsible card showing one raw event in the event log. Exports `RawEventCard`. → see `RawEventCard.tsx.AGENTS.md` |
| `SkillInvocationCard.tsx` | Collapsible card rendering a `<skill>` user invocation. Purple-tinted, wrench icon, default-collapsed body… → see `SkillInvocationCard.tsx.AGENTS.md` |
| `ThinkingBlock.tsx` | Exports `ThinkingBlock`. Collapsible reasoning panel; props `content`, `isStreaming`, `defaultExpanded`,… → see `ThinkingBlock.tsx.AGENTS.md` |
| `ToolBurstGroup.tsx` | Renders temporal BURST group (data from `lib/group-tool-bursts.ts`). → see `ToolBurstGroup.tsx.AGENTS.md` |
| `ToolCallStep.tsx` | Renders tool-call card. Adds `showResultBody?: boolean` prop (default `true`); when `false` hides result body… → see `ToolCallStep.tsx.AGENTS.md` |
