/**
 * Default-session permission policy. Pure decision logic + a thin installer; no Electron import.
 *
 * Only `clipboard-sanitized-write`, `notifications` and `fullscreen` are ever granted, only to the main frame
 * at the origin `getAllowedOrigin()` returns (the main window's current URL origin when the navigate-to-server
 * allowlist trusts it). A document-less check (service worker, `webContents` null, no `requestingUrl`) is judged
 * by its `requestingOrigin` alone and only for `notifications`. Everything else, including `openExternal`
 * (would bypass the http/https/mailto scheme allowlist of `safeOpenExternal`), is denied and logged once per
 * (permission, origin).
 * See change: close-local-listener-and-egress-gaps (D3).
 */

export const ALLOWED_PERMISSIONS: ReadonlySet<string> = new Set(["clipboard-sanitized-write", "notifications", "fullscreen"]);

export function isPermissionAllowed(permission: string): boolean {
  return ALLOWED_PERMISSIONS.has(permission);
}

export interface PermissionSessionLike {
  setPermissionRequestHandler(handler: (wc: unknown, permission: string, cb: (granted: boolean) => void, details: any) => void): void;
  setPermissionCheckHandler(handler: (wc: unknown, permission: string, requestingOrigin: string, details: any) => boolean): void;
}

/** URL origin, or `null` for an unparsable value or an opaque (`file:`, `data:`, `about:`) origin. */
function realOrigin(url: unknown): string | null {
  if (typeof url !== "string" || !url) return null;
  try {
    const o = new URL(url).origin;
    return o === "null" ? null : o;
  } catch {
    return null;
  }
}

export function installDefaultSessionPermissions(
  session: PermissionSessionLike,
  getAllowedOrigin: () => string | undefined,
  warn: (msg: string) => void = console.warn,
): void {
  const warned = new Set<string>();
  const deny = (permission: string, origin: string): false => {
    const key = `${permission}\u0000${origin}`;
    if (!warned.has(key)) {
      warned.add(key);
      warn(`[permissions] denied ${permission} for ${origin || "(unknown origin)"}`);
    }
    return false;
  };
  // A throwing getter (destroyed window) is a denial, never an exception out of the handler.
  const allowedOrigin = (): string | null => {
    try {
      return getAllowedOrigin() ?? null;
    } catch {
      return null;
    }
  };

  session.setPermissionRequestHandler((_wc, permission, cb, details) => {
    const origin = realOrigin(details?.requestingUrl);
    const allowed = allowedOrigin();
    const ok = isPermissionAllowed(permission) && details?.isMainFrame === true && origin !== null && origin === allowed;
    cb(ok || deny(permission, origin ?? String(details?.requestingUrl ?? "")));
  });

  session.setPermissionCheckHandler((_wc, permission, requestingOrigin, details) => {
    const allowed = allowedOrigin();
    if (!details?.requestingUrl) {
      const o = realOrigin(requestingOrigin);
      if (permission === "notifications" && o !== null && o === allowed) return true;
      return deny(permission, o ?? String(requestingOrigin ?? ""));
    }
    const origin = realOrigin(details.requestingUrl);
    if (isPermissionAllowed(permission) && details.isMainFrame === true && origin !== null && origin === allowed) return true;
    return deny(permission, origin ?? String(details.requestingUrl));
  });
}
