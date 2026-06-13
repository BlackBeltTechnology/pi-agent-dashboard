# pi-dashboard-goal-plugin

Surfaces the [`@ricoyudog/pi-goal-hermes`](https://github.com/ricoyudog/pi-goal-hermes) goal-continuation loop ("Ralph loop") in the pi-dashboard: a live session-card chip plus set / pause / resume / clear controls.

## What it does

`@ricoyudog/pi-goal-hermes` is a pi extension that runs an autonomous loop — set a standing goal and a judge model decides "done or continue" after every turn, feeding the agent a continuation prompt until the goal is achieved, paused, or a turn budget runs out. The extension owns the loop, the judge model, the `/goal` command, and continuation injection.

This plugin adds the **dashboard surfaces** the extension's TUI-only UX never reached:

- **GoalChip** (session card): `● Pursuing n/m` · `⏸ Paused · reason` · `✓ Achieved`. Hidden when no goal.
- **GoalControl** (session card action bar): a "Set goal" input when none is set; Pause / Done / Clear when active; Resume / Clear when paused.

## Requirements

The plugin **requires the `@ricoyudog/pi-goal-hermes` pi extension**. It activates only when that extension is installed (manifest `requires.piExtensions`). Install it into pi:

```bash
pi extension add @ricoyudog/pi-goal-hermes
```

The judge **model** and **turn budget** (`maxTurns`, default 20) are configured on the extension, not this plugin.

## How it works

```
[control]  GoalControl → plugin_action → server → sendToSession("/goal …")
             → bridge routes slash → extension /goal command → loop runs
[status]   extension pi-goal-hermes:event → plugin bridge entry
             → dashboard:plugin-message → plugin_pi_message → server cache
             → plugin_event broadcast → client store → GoalChip
```

Continuation injection stays owned by the extension. The main bridge's `enqueueSystemFollowup` primitive is the collision-safe fallback if a plugin ever routes a continuation itself.

## v1 scope

- Setting / controlling a goal works in **dashboard-spawned (headless)** sessions, where the bridge routes `/goal` through the RPC keeper.
- Typed `/goal` in chat and reliable control in **terminal-hosted** sessions inherit the documented extension-slash-command routing limitation.
- Continuations are text-only (no image-bearing continuations).

See change: `add-goal-continuation-plugin`.
