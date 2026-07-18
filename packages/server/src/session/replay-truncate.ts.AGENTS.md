# replay-truncate.ts — index

truncateToolResultForReplay(event). Strategy B reconciled onto adopt-pi-071-072-073-features. Replay pre-truncates tool_execution_end result >200 lines to display form (`«N earlier lines hidden»` + last 200 lines) to trim replay bytes; store keeps full body for toolCallId route. Mirrors client toDisplayString+truncateOutputForDisplay. Copy, no mutation. See change: reduce-session-replay-traffic.
