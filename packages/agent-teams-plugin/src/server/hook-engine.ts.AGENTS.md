# hook-engine.ts — index

`createHookEngine`: run ≤3 commands of one event under ONE deadline (`opGateBudgetMs` − margin); exit 0 allow, 2 block (`hookFeedback`: stderr ≤2000, control chars stripped, `hook blocked (no output)`), else fail-open; counters, first-occurrence lead notices (spawn error, timeout), 3-error streak notice. Logs never carry stdin/stdout. See change: add-agent-teams-templates-hooks.
