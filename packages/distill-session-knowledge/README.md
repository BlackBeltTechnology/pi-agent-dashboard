# @blackbelt-technology/pi-dashboard-distill-session-knowledge

A pi skill that offline-mines your pi session JSONL logs into reusable, verified
knowledge — routing distilled patterns into `skill_manage`, `memory`, and
`docs`. It loads by natural-language trigger ("mine my sessions", "distill
session knowledge") in any pi session.

The skill is a thin wrapper over the deterministic engine
[`@blackbelt-technology/pi-dashboard-session-distiller`](https://www.npmjs.com/package/@blackbelt-technology/pi-dashboard-session-distiller),
declared here as a runtime dependency and invoked through its
`distill-session-knowledge` bin.

## Install

Add the package to a pi project so its skill is discovered:

```bash
npm install @blackbelt-technology/pi-dashboard-distill-session-knowledge
```

Then, in a pi session, say "mine my sessions" or "distill session knowledge".

## What it does

Walks sessions newer than a watermark, extracts five objective-anchored signal
classes (faults, `ask_user` decisions, corrections, procedures, docs), promotes
only patterns recurring across `>= N` sessions, and presents a routing plan for
review. It is **dry-run by default** — nothing is written until you review and
apply. See the engine package for the algorithm and privacy details.

## License

MIT
