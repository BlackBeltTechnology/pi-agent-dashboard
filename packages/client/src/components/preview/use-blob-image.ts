/**
 * Load a same-origin file-route image through `fetch` → `blob:` URL, so a
 * click-opened image can carry the grant capability an `<img>` never sends
 * (change: surface-denial-remedy-in-previews, design D1).
 *
 * The request goes through `usePreviewFetch()` (opted out unless operator
 * provenance is declared). `ask()` re-runs it ONCE with the eligible fetch — an
 * operator click on the notice. The hook revokes exactly the URLs it created:
 * on replacement and on unmount.
 */
import { useEffect, useState } from "react";
import { getApiBase } from "../../lib/api/api-context.js";
import { eligibleFetch, usePreviewFetch } from "../../lib/access-grants/preview-provenance.js";
import { type DenialFailure, denialFetch } from "./denial-fetch.js";

export type BlobImageState =
  | { status: "loading" }
  | { status: "ok"; src: string }
  | { status: "failed"; failure: DenialFailure };

/**
 * True when the API base is this page's origin. With a cross-origin base (the
 * `pi-dashboard.dev` shell) images keep `<img>`: such a request can never be
 * eligible, and `fetch` would add a CORS requirement an `<img>` does not have.
 */
export function isSameOriginApiBase(): boolean {
  const base = getApiBase();
  if (!base) return true;
  try {
    return new URL(base, window.location.origin).origin === window.location.origin;
  } catch {
    return false;
  }
}

/** `url` null → the hook is idle (the caller renders another transport). */
export function useBlobImage(url: string | null): {
  state: BlobImageState;
  asked: boolean;
  ask: () => void;
} {
  const { fetch: previewFetch, optedOut } = usePreviewFetch();
  // The ask belongs to one URL: a new target starts un-asked.
  const [askedUrl, setAskedUrl] = useState<string | null>(null);
  const asked = url !== null && askedUrl === url;
  const [state, setState] = useState<BlobImageState>({ status: "loading" });

  useEffect(() => {
    if (url === null) return;
    let cancelled = false;
    let created: string | null = null;
    setState({ status: "loading" });
    // Held while the dialog is open: `loading` stays up for the whole hold.
    void denialFetch(asked ? eligibleFetch : previewFetch, url, asked ? false : optedOut)
      .then(async (r) => {
        if (cancelled) return;
        if (r.kind !== "ok") {
          setState({ status: "failed", failure: r });
          return;
        }
        const blob = await r.response.blob();
        if (cancelled) return;
        created = URL.createObjectURL(blob);
        setState({ status: "ok", src: created });
      })
      .catch((e: unknown) => {
        if (!cancelled) setState({ status: "failed", failure: { kind: "error", message: String(e) } });
      });
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [url, asked, previewFetch, optedOut]);

  return { state, asked, ask: () => setAskedUrl(url) };
}
