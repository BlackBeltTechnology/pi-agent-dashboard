/**
 * Client helpers shared by `GmailSettings.tsx` and `AutoSetup.tsx`: the plugin
 * REST helper and the secondary-button / text class recipes.
 * See change: add-gmail-auto-setup.
 */

const API = "/api/plugins/gmail";

/** JSON helper for the plugin routes; a failed reply throws `{ code: body.error, status, detail: body.message }`. */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: init?.body ? { "content-type": "application/json" } : undefined,
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string; message?: string };
  if (!res.ok) throw Object.assign(new Error(body.error ?? `HTTP ${res.status}`), { code: body.error, status: res.status, detail: body.message });
  return body;
}

// Secondary button recipe (`ui-contract.md`); `tap-target` = 44 px touch, 32 px from sm.
export const btn =
  "focus-ring tap-target rounded-md border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-2.5 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-50";
export const muted = "text-xs text-[var(--text-secondary)]";
export const errorText = "text-xs text-[var(--severity-error-fg)]";
