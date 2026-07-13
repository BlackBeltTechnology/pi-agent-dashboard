## 1. Fix activity detector regex — done via fix-openspec-activity-detection

- [x] 1.1 Add `CLI_NEW_CHANGE_RE = /openspec\s+new\s+change\s+["']?([^\s"']+)["']?/` to `src/extension/openspec-activity-detector.ts`
- [x] 1.2 Add check for `CLI_NEW_CHANGE_RE` in the Bash tool handler, before existing `CLI_CHANGE_FLAG_RE` check
- [x] 1.3 Write tests: detect change name from `openspec new change "name"`, `openspec new change name`, `openspec new change "name" --schema spec-driven`
- [x] 1.4 Verify existing `--change` flag detection and archive detection still pass

## 2. Add initialPrompt to process manager — SUPERSEDED (pending-initial-prompt registry shipped by project-init-skill-and-profiles)

- ~~[ ] 2.1 Add `initialPrompt?: string` to `SessionOptions` interface in `src/server/process-manager.ts`~~
- ~~[ ] 2.2 Update `buildTmuxCommand()`: append shell-escaped `initialPrompt` as positional arg to pi command when set~~
- ~~[ ] 2.3 Update `buildHeadlessArgs()`: append `initialPrompt` to args array when set~~
- ~~[ ] 2.4 Write tests for `buildTmuxCommand` with initialPrompt~~
- ~~[ ] 2.5 Write tests for `buildHeadlessArgs` with initialPrompt~~

## 3. Extend spawn_session protocol message — done via project-init-skill-and-profiles

- [x] 3.1 Add optional `initialPrompt?: string` to `spawn_session` message in `browser-protocol.ts`
- [x] 3.2 Pass `initialPrompt` through in `session-action-handler.ts` `handleSpawnSession` handler to pending-initial-prompt registry

## 4. Add New Spec button to FolderOpenSpecSection

- [ ] 4.1 Add `onNewSpec?: (cwd: string) => void` prop to `FolderOpenSpecSection`
- [ ] 4.2 Render "New Spec" button in section header (next to Bulk Archive and Refresh)
- [ ] 4.3 Wire click to send `spawn_session` with `cwd` and `initialPrompt: "/opsx:explore"` from `App.tsx`
- [ ] 4.4 Write test: New Spec button calls onNewSpec callback

## 5. Verify end-to-end flow

- [ ] 5.1 Run full test suite, fix broken tests
- [ ] 5.2 Manual smoke test: click New Spec → agent spawns in explore mode → create proposal → auto-attach fires (registry-based flow, not positional CLI arg)
- [ ] 5.3 Update `AGENTS.md` and `docs/architecture.md` with New Spec spawn flow
