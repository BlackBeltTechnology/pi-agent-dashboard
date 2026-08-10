# replay-truncate.spec.ts — index

Playwright spec. Strategy B: full replay in fresh browser context pre-truncates heavy (>200-line) tool result to display form (`«N earlier lines hidden»` + last 200 lines). Captures WS event_replay frames, asserts result starts with « marker + last-200 tail, head dropped. Drives `[[faux:tool-bash-large]]`. PI_E2E_SEED=1, PW_CHANNEL=chrome. See change: reduce-session-replay-traffic.
