# session-card-time.ts — index

Pure picker of session-card relative-time badge anchor timestamp. Exports `selectBadgeTimestamp(session)`. Precedence: `ended`→`endedAt`→`lastActivityAt`→`startedAt`; else `lastActivityAt ?? startedAt`. `lastActivityAt` server-stamped on activity events, seeded from events.jsonl mtime so idle badges don't reset to "0s". See change: session-card-last-activity-badge.
