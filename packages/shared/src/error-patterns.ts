/**
 * Shared provider/billing error-pattern regexes.
 *
 * Single source of truth for the client + extension; both packages import
 * from here. See change: unify-status-banner-and-terminal-limit-stop.
 *
 * `USAGE_LIMIT_PATTERN` matches terminal billing/quota error categories
 * observed in production across providers. Used by:
 *
 *   - Bridge (`packages/extension/src/usage-limit-orderer.ts`) — orders the
 *     synthesized `auto_retry_end{success:false,finalError}` BEFORE
 *     `agent_end` so the dashboard's `retryState` clears before `lastError`.
 *   - Bridge (`packages/extension/src/bridge.ts`) — auto-aborts the session
 *     on `message_end` match (skips pi's pointless retry sleep for terminal
 *     billing errors) and synthesizes `auto_retry_end` for first-attempt
 *     terminal limits seen on `agent_end` outside a retry chain.
 *   - Client (`packages/client/src/lib/event-reducer.ts`) — `deriveBannerState`
 *     selector routes `lastError` matching this pattern to the
 *     `limit-exceeded` SessionBanner variant.
 *
 * Coverage (verified via `__tests__/error-patterns.test.ts`):
 *
 *   - Codex / Anthropic / generic: usage_limit_reached, usage_not_included,
 *     quota_exceeded, credit_balance, insufficient_quota, monthly limit,
 *     daily limit, hourly limit, "reset after Nh|Nm|Ns".
 *   - Gemini / Google: "monthly spending cap", "spending cap",
 *     RESOURCE_EXHAUSTED.
 *   - Generic catch-all for "exceeded ... (quota|cap|spending)" within
 *     ~40 chars (avoids a string with no terminal-meaning context).
 */
export const USAGE_LIMIT_PATTERN =
  /usage[_ ]limit[_ ]reached|usage_not_included|insufficient_quota|credit[_ ]balance|quota[_ ]exceeded|resource[_ ]exhausted|monthly[_ ]limit|monthly[_ ]spending[_ ]cap|hourly[_ ]limit|daily[_ ]limit|spending[_ ]cap|exceeded[^"]{0,40}(quota|cap|spending)|reset after \d+[hms]/i;
