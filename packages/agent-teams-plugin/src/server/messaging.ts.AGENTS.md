# messaging.ts — index

`createMessaging`: `SendMessage` (kind `message` only → `kind_reserved`, code-point size cap, lead-only broadcast/urgent, `self_message`, empty broadcast ok, pair breaker + token bucket, urgent interrupt → `degraded:"urgent_as_steer"` when abort is unavailable). Urgent degradation also returns the driver's `warning` text (`driver.urgentDegraded`). See change: add-agent-teams-in-process.
