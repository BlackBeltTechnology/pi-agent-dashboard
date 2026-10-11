/**
 * Inline warning for an action that would move the passkey RP ID (D3): a
 * primary-tunnel switch or an `auth.redirectBaseUrl` edit. Asks the server how
 * many usable passkeys the new origin would orphan and states it; renders
 * nothing when none would be (or when the directory is unavailable — e.g.
 * passkeys disabled or the caller is not an operator). Debounced so a typed
 * URL does not fire one request per keystroke.
 * See change: add-passkey-user-auth.
 */
import { useEffect, useState } from "react";
import { type CredentialImpact, credentialImpact, type ImpactQuery } from "../../lib/users/users-api.js";
import { impactConsequence } from "../../lib/users/users-text.js";

const isHttpUrl = (v: string) => /^https?:\/\//i.test(v);

/** Askable: a provider URL, or a redirect draft that is empty (cleared) or a URL. */
function askable(q: ImpactQuery | undefined): ImpactQuery | null {
  if (!q) return null;
  if ("url" in q) return isHttpUrl(q.url.trim()) ? { url: q.url.trim() } : null;
  const v = q.redirectBaseUrl.trim();
  return v === "" || isHttpUrl(v) ? { redirectBaseUrl: v } : null;
}

export function PasskeyImpactNote({ query, testId, debounceMs = 0 }: { query: ImpactQuery | undefined; testId: string; debounceMs?: number }) {
  const [impact, setImpact] = useState<CredentialImpact | null>(null);
  const q = askable(query);
  const key = q ? JSON.stringify(q) : "";

  useEffect(() => {
    setImpact(null);
    if (!key) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      credentialImpact(JSON.parse(key) as ImpactQuery)
        .then((r) => {
          if (!cancelled) setImpact(r);
        })
        .catch(() => {
          // Unavailable (disabled / not an operator / offline): say nothing
          // rather than block the action on an advisory.
        });
    }, debounceMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key, debounceMs]);

  const text = impactConsequence(impact);
  if (!text) return null;
  return (
    <p data-testid={testId} role="status" className="mt-1 text-[11px] text-[var(--severity-warning-fg)]">
      {text}
    </p>
  );
}
