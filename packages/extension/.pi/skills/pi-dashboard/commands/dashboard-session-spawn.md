---
description: Spawn a new session in a directory. Usage /dashboard:session-spawn [cwd]
---
Use the pi-dashboard skill (see ../SKILL.md). Spawn a new session over the WebSocket bus:

    npx tsx ./scripts/dashboard-bus.ts spawn <cwd> [--prompt <text>] [--attach <change>] [--model <ref>] [--thinking <level>]

Default <cwd> to the current working directory if no argument is given. Optionally pass `--prompt <text>` to send an initial prompt and `--attach <change>` to attach an OpenSpec change. `--model` takes `provider/id`, `provider/id:<level>`, `@role` or `@role:<level>` (an `@role` is resolved once, at spawn time); `--thinking` takes `off|minimal|low|medium|high|xhigh`. A dropped model choice prints `warning: <text>` and the session still starts on the default model. The CLI sends the typed `spawn` verb and correlates the reply exactly. Report the new session id.

Optional argument (cwd):
