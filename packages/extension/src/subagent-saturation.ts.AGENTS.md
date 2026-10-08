# subagent-saturation.ts — index

Private pressure sampler for fan-out admission: own `monitorEventLoopDelay` histogram over a fixed 5 s window + own CPU baseline, never `collectMetrics()` (destructive read). Pure hysteresis `nextSaturationState` (enter at threshold, leave below 80 %) + `anyMetricAtOrAbove`. Process-domain (`cpuPercent`, `eventLoopDelayMs`) and machine-domain (`loadAvg1m`) thresholds stay separate. See change: bound-subagent-fanout-under-host-pressure. → see `subagent-saturation.ts.AGENTS.md`
