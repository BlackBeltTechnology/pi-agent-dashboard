/**
 * The providers this plugin can serve. Client-safe (no node imports), so both
 * the settings UI and the server fetcher registry agree on one list.
 *
 * A provider belongs here ONLY when its usage-endpoint contract is fully owned
 * in `server/quotas/`. Deliberately absent: `opencode` (the Zen pay-as-you-go
 * gateway — a wallet balance behind a browser-session cookie + workspace id, not
 * a resetting window), `deepseek` and `minimax` (they expose a wallet balance,
 * not a resetting window, so there is no reset stamp to compute pace against).
 * The Go SUBSCRIPTION `opencode-go` IS supported — a key-authenticated
 * resetting-window usage API. A permanently-empty row is worse than no row.
 *
 * `server/quotas/fetchers.ts` is asserted against this list by test, so adding
 * an id here without a fetcher fails the build.
 *
 * See change: publish-quota-plugin.
 */
export const SUPPORTED_PROVIDERS: string[] = [
  "anthropic",
  "github-copilot",
  "kimi-coding",
  "openai-codex",
  "opencode-go",
  "openrouter",
  "synthetic",
  "zai",
];
