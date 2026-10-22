# ui-link-base.ts — index

`resolveRequestUiBase(input)` (pure): origin used in `GET /api/sessions` `uiUrl`/`diffUrl`. Order: (1) configured origin (public bases, live tunnels, `auth.redirectBaseUrl`) whose hostname equals the first `X-Forwarded-Host` value, else `Host`; (2) `Host` admitted by `isAdmitted` (also in `report` mode) → `<protocol>://<normalized host>[:port 1-65535]`; (3) `<protocol>://localhost:<port>`. `X-Forwarded-Host` only selects a configured origin, never mints one; `trustProxy` stays off. Result has no trailing slash. See change: add-session-ui-deep-links-for-agents.
