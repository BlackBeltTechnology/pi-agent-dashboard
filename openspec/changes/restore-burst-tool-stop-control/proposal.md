## Why

Issue: https://github.com/BlackBeltTechnology/pi-agent-dashboard/issues/688

The inline per-tool-call **stop / force-stop** button next to a running tool call is gone from the chat detail view. Users notice it most on long-running `Bash` and Execute (`ctx_execute`) calls. Only the card control (`SessionActivityBar`) is left.

Reported root cause (verify during planning):
- Tool grouping is now universal (threshold 1). `packages/client/src/lib/chat/group-tool-bursts.ts` wraps every tool-like run, so every `toolResult` renders through `packages/client/src/components/chat/ToolBurstGroup.tsx`.
- `ToolBurstGroup` renders `<ToolCallStep …>` without `onAbort` / `onForceKill`. The burst header (`GroupFrame`) has only a chevron.
- The only `ToolCallStep` wired with abort handlers is the direct render in `ChatView.tsx`. Bursts now consume every `toolResult`, so that path is unreachable, and the stop UI in `ToolCallStep.tsx` is dead code.

## What Changes

- Pass `onAbort` / `onForceKill` down `ChatView` → `ToolBurstGroup` → `BurstBodyItem` → `ToolCallStep`, shown only while `toolStatus === "running"`. Or add a stop control to the running burst header. Pick one in design.
- Remove the dead direct-render branch, or make it the single source of truth.
- Settle the semantics the issue links to (abort granularity, #689): does "stop this tool" abort the session or only this tool? The label and tooltip must match the behaviour.

## Capabilities

### Modified Capabilities
- `tool-burst-grouping` — running steps inside a burst expose stop / force-stop.
- `play-stop-controls` — per-tool stop semantics and labelling.

## Non-goals

- Changing the burst grouping threshold.
- New server-side per-tool abort mechanics, unless the semantics decision requires them. If it does, split that out.

## Discipline Skills

- `review-code` — before commit.
- `react-expert` subagent — prop threading across the chat render tree, without regressing burst memoisation.
- No security, perf or observability triggers (UI wiring to existing abort actions).

## Impact

- `packages/client/src/components/chat/{ChatView,ToolBurstGroup,ToolCallStep}.tsx`, `packages/client/src/lib/chat/group-tool-bursts.ts`.
- Accessibility: the stop buttons are keyboard-reachable and have accurate `aria-label`s.
- Compatibility: client only. Rollback = revert.
