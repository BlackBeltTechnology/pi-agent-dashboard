/**
 * Real-world usage-limit / quota / billing error strings extracted from
 * production session logs (~/.pi/agent/sessions/**\/*.jsonl) plus
 * representative samples from provider docs. Used as fixtures for the
 * USAGE_LIMIT_PATTERN regex coverage tests.
 *
 * See change: fix-retry-banner-stuck-on-limit-exceeded.
 */

export interface UsageLimitFixture {
  provider: string;
  /** A short label for the test name. */
  label: string;
  /** The verbatim errorMessage string as it appears on the wire. */
  error: string;
}

/**
 * Strings the broadened USAGE_LIMIT_PATTERN MUST match (terminal —
 * dashboard shows red banner, no retry).
 */
export const USAGE_LIMIT_FIXTURES: UsageLimitFixture[] = [
  {
    provider: "google-generative-ai",
    label: "Gemini monthly spending cap (real fixture, BME-szakdoga session)",
    error: JSON.stringify({
      error: {
        message:
          "Your project has exceeded its monthly spending cap. Please go to AI Studio at https://ai.studio/spend to manage your project spend cap. Learn more at https://ai.google.dev/gemini-api/docs/billing#project-spend-caps. ",
        status: "RESOURCE_EXHAUSTED",
      },
      code: 429,
      status: "Too Many Requests",
    }),
  },
  {
    provider: "google-generative-ai",
    label: "Gemini RESOURCE_EXHAUSTED standalone",
    error: '{"error":{"status":"RESOURCE_EXHAUSTED","code":429}}',
  },
  {
    provider: "google",
    label: "Cloud Code Assist quota reset after Nh",
    error:
      "Cloud Code Assist API error (429): You have exhausted your capacity on this model. Your quota will reset after 50h27m20s.",
  },
  {
    provider: "openai-codex-responses",
    label: "Codex usage_limit_reached",
    error: "usage_limit_reached: 5000 RPM exceeded",
  },
  {
    provider: "openai-codex-responses",
    label: "Codex usage_not_included",
    error: "usage_not_included for this account",
  },
  {
    provider: "openai",
    label: "OpenAI insufficient_quota",
    error:
      'You exceeded your current quota, please check your plan and billing details. {"code":"insufficient_quota"}',
  },
  {
    provider: "anthropic",
    label: "Anthropic credit balance too low",
    error:
      'Your credit balance is too low to access the Anthropic API. Please go to https://console.anthropic.com/billing to add credits.',
  },
  {
    provider: "github-copilot",
    label: "Copilot daily limit",
    error: "You have reached the daily limit for free GitHub Copilot users",
  },
  {
    provider: "anthropic",
    label: "Anthropic quota_exceeded snake-case",
    error: "quota_exceeded: monthly token allotment used",
  },
];

/**
 * Strings the broadened USAGE_LIMIT_PATTERN MUST NOT match (transient —
 * pi-coding-agent retries internally; dashboard shows yellow banner only).
 */
export const NON_USAGE_LIMIT_FIXTURES: UsageLimitFixture[] = [
  {
    provider: "anthropic",
    label: "Anthropic transient overloaded",
    error: '{"type":"overloaded_error","message":"Anthropic is currently overloaded"}',
  },
  {
    provider: "google",
    label: "Gemini 503 transient high demand",
    error:
      '{"error":{"code":503,"message":"This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.","status":"UNAVAILABLE"}}',
  },
  {
    provider: "unknown",
    label: "Generic fetch failed",
    error: "fetch failed",
  },
  {
    provider: "unknown",
    label: "Generic timeout",
    error: "Request timed out.",
  },
  {
    provider: "unknown",
    label: "Generic connection error",
    error: "Connection error.",
  },
  {
    provider: "unknown",
    label: "Tool execution failed (not a provider error)",
    error: "tool execution failed",
  },
  {
    provider: "anthropic",
    label: "Anthropic 502 Bad Gateway",
    error: "502 Bad Gateway",
  },
  {
    provider: "unknown",
    label: "Empty error message",
    error: "",
  },
];
