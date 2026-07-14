# @blackbelt-technology/pi-dashboard-session-distiller

Offline miner that distills reusable, verified knowledge from pi session JSONL
logs. It is the deterministic engine behind the `distill-session-knowledge` pi
skill; use the skill package
[`@blackbelt-technology/pi-dashboard-distill-session-knowledge`](https://www.npmjs.com/package/@blackbelt-technology/pi-dashboard-distill-session-knowledge)
to load the discipline into a pi session, or use this engine directly as a CLI /
library.

## What it does

Walks the pi sessions for a project (newer than a persisted watermark),
segments each trajectory, and extracts five signal classes anchored on objective
outcomes:

- **fault** — a tool error that a later same-tool retry resolves (`isError` flip).
- **user_correction** — a human correction after an assistant action.
- **ask_user_decision** — a recorded human decision.
- **procedure** — an episode of >5 tool calls that ends verified-good.
- **documentation** — a recurring how-to summary.

Only patterns that recur across `>= N` sessions (default 3) are promoted. Each
promoted cluster is distilled into an artifact with provenance and a
confidence score that decays with age and model change, then routed to a sink
(`skill_manage`, `memory`, or `docs`).

## Privacy

The miner is **dry-run by default** — nothing is written until you pass
`--apply`. State (the watermark and below-threshold candidate store) is written
to `~/.pi/agent/distill-session-knowledge/` on your machine; it is never
bundled or transmitted. Distilled artifacts land only in your own local sinks
after review. The emitted plan carries slugged signatures and provenance
(session ids, model), not raw session payloads.

## CLI

```bash
# dry-run over the current project (no writes)
npx distill-session-knowledge --cwd "$(git rev-parse --show-toplevel)"

# change the recurrence threshold and emit the routing plan as JSON
npx distill-session-knowledge --cwd "$(pwd)" --n 3 --json

# persist the watermark + candidate store and print the final plan
npx distill-session-knowledge --cwd "$(pwd)" --apply --json
```

Flags: `--cwd <dir>`, `--n <k>` (recurrence threshold), `--sessions-dir <dir>`,
`--apply`, `--json`.

## Library

```ts
import { run } from "@blackbelt-technology/pi-dashboard-session-distiller/main.js";

const result = run({ cwd: process.cwd(), n: 3 }); // dry-run
console.log(result.plan);
```

## License

MIT
