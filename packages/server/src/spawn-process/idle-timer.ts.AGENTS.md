# idle-timer.ts — index

Auto-shutdown timer with sleep-wake resilience. Exports `IdleTimer`, `HasActiveTerminals`, `createIdleTimer(config, piGateway, hasActiveTerminals)`. Starts shutdown countdown when `piGateway` empty; cancels on connection; blocks shutdown while active terminals exist. Sleep-wake guarded via `lastConnectionTimestamp` recheck.
