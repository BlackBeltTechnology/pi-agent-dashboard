# process-metrics.ts — index

Lightweight process metrics collector for bridge heartbeats. Exports `startMetricsMonitor`, `stopMetricsMonitor`, `collectMetrics`. Returns `ProcessMetrics` (rss, heap, cpuPercent, eventLoopMaxMs, loadAvg1m) via Node built-ins; event-loop-delay monitor opt-in.
