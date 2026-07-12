/**
 * Main-process remote-dashboard reachability probe.
 *
 * Extracted from `remote-connect-window.ts` so `main.ts` can back a
 * `dashboard:probe-server` IPC handler WITHOUT importing the BrowserWindow /
 * IPC-registration code in that module. This is a Node `fetch` — it sends NO
 * browser `Origin` header and is therefore not subject to the remote's CORS
 * policy (unlike a renderer `fetch` from the `file://` loading page, whose
 * `Origin: null` a remote deliberately refuses). Same engine already behind
 * "Test Connection".
 *
 * See change: fix-remote-connect-cors-gates.
 */

export interface RemoteProbeResult {
  ok: boolean;
  version?: string;
  reason?: string;
}

/** Normalize a user-entered URL: trim, default http://, strip trailing slash. */
export function normalizeRemoteUrl(input: unknown): string | null {
  const v = typeof input === "string" ? input.trim() : "";
  if (!v) return null;
  const withScheme = /^https?:\/\//i.test(v) ? v : `http://${v}`;
  return withScheme.replace(/\/+$/, "");
}

/** Probe `${url}/api/health` with a short timeout. Node fetch — no Origin header. */
export async function probeRemote(url: string): Promise<RemoteProbeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${url}/api/health`, { signal: controller.signal });
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    let version: string | undefined;
    try {
      const body = (await res.json()) as { version?: string };
      if (typeof body?.version === "string") version = body.version;
    } catch {
      /* health may return non-JSON */
    }
    return { ok: true, version };
  } catch (err) {
    const reason = (err as Error)?.name === "AbortError" ? "Timed out" : "Connection refused";
    return { ok: false, reason };
  } finally {
    clearTimeout(timer);
  }
}
