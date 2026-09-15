# DOX — spike

Throwaway measurement scripts. NOT shipped, NOT imported by src. Run by hand.

| File | Purpose |
|------|---------|
| `perchild-cost-spike.mjs` | Measures ISOLATED per-child pi loader cost with a warm parent: `node spike/perchild-cost-spike.mjs <cwd> <full\|lean\|wrapper> <n> [agentDir]`. Prints `{wallMs, maxLoopLagMs, rssMB, distinctRuntime, perChild[]}`. Optional 4th arg `agentDir` picks WHICH checkout's extensions load, so a resolver change can be A/B-measured without touching `~/.pi/agent`. Backs test-plan #P2 (`maxLoopLagMs` < 300 ms, baseline 5046 ms). See change: heal-orphaned-tool-cards-on-session-end. |
