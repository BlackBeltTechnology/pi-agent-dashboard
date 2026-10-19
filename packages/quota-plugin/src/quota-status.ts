/**
 * Provider display names + the `/api/quota` provider-status hook, shared by the
 * settings body (`QuotaSettings.tsx`) and the widget (`client.tsx`). Split out so
 * the settings render tree does not import the widget module.
 * See change: retro-ux-plugin-settings-wave-2.
 */
import { useEffect, useState } from "react";
import type { ApiQuotaResponse, QuotaUnavailableReason } from "./types.js";

// Display names only; providers.ts owns WHICH providers exist.
const PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Anthropic",
  "openai-codex": "Codex",
  "github-copilot": "Copilot",
  openrouter: "OpenRouter",
  synthetic: "Synthetic",
  zai: "Z.ai",
  "kimi-coding": "Kimi Code",
  "opencode-go": "OpenCode Go",
};

export function providerLabel(id: string): string {
  return PROVIDER_LABELS[id] ?? id;
}

/**
 * Live per-provider state for the settings rows, from the same `/api/quota`
 * payload the widget reads: `reasons` = why an ENABLED provider produced
 * nothing (server-named cause), `withData` = providers that currently report at
 * least one window (a retained snapshot counts: the user can see it).
 *
 * Every provider is tickable — the plugin owns each contract, so there is no
 * peer to be missing. But a tick can still yield nothing (not signed in,
 * endpoint throttled) and silence there is indistinguishable from a bug; the
 * settings row prints a worded pill instead.
 *
 * Fetched once per mount (no poll): the Settings panel is short-lived.
 */
export function useQuotaProviderStatus(): {
  reasons: Record<string, QuotaUnavailableReason>;
  withData: ReadonlySet<string>;
} {
  const [state, setState] = useState<{
    reasons: Record<string, QuotaUnavailableReason>;
    withData: ReadonlySet<string>;
  }>({ reasons: {}, withData: new Set() });
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/quota");
        const json = (await res.json()) as ApiQuotaResponse;
        if (!alive) return;
        setState({
          reasons: Object.fromEntries((json.unavailable ?? []).map((u) => [u.provider, u.reason])),
          withData: new Set((json.providers ?? []).filter((p) => p.windows.length > 0).map((p) => p.provider)),
        });
      } catch {
        if (alive) setState({ reasons: {}, withData: new Set() });
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  return state;
}
