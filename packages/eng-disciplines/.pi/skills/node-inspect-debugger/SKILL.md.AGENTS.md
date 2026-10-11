# .pi/skills/node-inspect-debugger/SKILL.md — index

Runtime state a console.log can't reach: real breakpoints + scope-chain dump. Carries spike-verified jiti launch recipe (register hook via createRequire; line-preserving `.ts` URLs; pending-breakpoint nuance). Triggers "set a breakpoint", "console.log isn't enough". Ported from NousResearch/hermes-agent (MIT). See change: add-debugging-skills. Adds native-loader launch recipe (register resolved by package specifier); jiti recipe kept as `PI_DASHBOARD_TS_LOADER=jiti` opt-in. See change: fix-appimage-cold-boot-latency.
