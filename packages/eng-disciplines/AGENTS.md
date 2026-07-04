# DOX — packages/eng-disciplines

Cross-cutting engineering-discipline skills for pi sessions. NL-triggered, orthogonal to the openspec pipeline. One row per source file.

| File | Purpose |
|------|---------|
| `.pi/skills/code-simplification/SKILL.md` | Active simplify pass. Triggers "simplify this", "reduce complexity". Adapted from Addy-Osmani agent-skills (MIT). |
| `.pi/skills/doubt-driven-review/SKILL.md` | In-flight adversarial check before a decision stands. Triggers "stress-test this", "are we sure". Adapted from Addy-Osmani (MIT). |
| `.pi/skills/interview-me/SKILL.md` | Pre-spec intent extraction, one question at a time. Triggers "interview me", "grill me". Adapted from Addy-Osmani (MIT). |
| `.pi/skills/node-inspect-debugger/SKILL.md` | Runtime state a console.log can't reach: real breakpoints + scope-chain dump. Carries spike-verified jiti launch recipe (register hook via createRequire; line-preserving `.ts` URLs; pending-breakpoint nuance). Triggers "set a breakpoint", "console.log isn't enough". Ported from NousResearch/hermes-agent (MIT). See change: add-debugging-skills. |
| `.pi/skills/node-inspect-debugger/scripts/cdp-inspect.ts` | Dependency-free CDP scope dumper (Node 24 global WebSocket, no chrome-remote-interface). `npx tsx cdp-inspect.ts <port> <ts-url> <line>` → attaches, sets `.ts` breakpoint, resumes past entry halt, prints `PAUSED at <file>:<line> fn=<name>` + one line per local/closure var. See change: add-debugging-skills. |
| `.pi/skills/observability-instrumentation/SKILL.md` | Runtime visibility: logging/metrics/tracing. Triggers "instrument this", "add metrics". Adapted from Addy-Osmani (MIT). |
| `.pi/skills/performance-optimization/SKILL.md` | Measure-first perf. Triggers "it's slow", "profile this". Adapted from Addy-Osmani (MIT). |
| `.pi/skills/security-hardening/SKILL.md` | Security discipline. Triggers "security audit", "harden this", "threat model". Adapted from Addy-Osmani (MIT). |
| `.pi/skills/systematic-debugging/SKILL.md` | Post-failure root-cause discipline: 4-phase (Root Cause→Pattern→Hypothesis→Implementation), Rule of Three hands off to doubt-driven-review at ≥3 failed fixes. Triggers "root cause this", "why is this failing". Ported from NousResearch/hermes-agent (MIT). See change: add-debugging-skills. |
| `NOTICE` | Third-party attribution. Addy-Osmani agent-skills + NousResearch hermes-agent, both MIT. |
| `README.md` | Package overview + skills table + loading model. |
| `package.json` | Manifest. `pi.skills[]` registers all 8 skills; `files[]` ships `.pi/skills/`, README, NOTICE. |
