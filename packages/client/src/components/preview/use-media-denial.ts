/**
 * Diagnosis for multi-request viewers — video, audio, PDF (change:
 * surface-denial-remedy-in-previews, design D2).
 *
 * These load one resource with several requests, and Allow once admits exactly
 * one, so none of their own requests may raise the dialog. After a load failure:
 *
 *   1. at most ONE opted-out probe (`Range: bytes=0-0`) per load attempt, read
 *      only for its status and denial fields;
 *   2. the notice's Ask for access issues ONE eligible probe, which raises the
 *      dialog; on a 2xx the viewer remounts / reloads (`attempt` changes);
 *   3. if that retry fails again, NO probe: the client knows the sequence
 *      (asked → probe admitted → stream refused) and says so itself.
 *
 * A remount does not re-arm the probe; only a new explicit ask does.
 */
import { useCallback, useRef, useState } from "react";
import { fetchWithoutGrantPrompt } from "../../lib/access-grants/grant-channel.js";
import { eligibleFetch } from "../../lib/access-grants/preview-provenance.js";
import { type DenialFailure, probeMedia } from "./denial-fetch.js";

export type MediaPhase =
  | { kind: "media" }
  | { kind: "diagnosing" }
  | { kind: "failed"; failure: DenialFailure; asked: boolean; admittedCheckOnly: boolean };

const MEDIA: MediaPhase = { kind: "media" };

const freshFlags = (url: string): Flags => ({
  url,
  probed: false,
  retriedAfterAsk: false,
  lastFailure: { kind: "unknown" },
  op: 0,
});

/** Per-URL flags. A new URL gets a fresh object, so completions for the old one are ignored. */
interface Flags {
  url: string;
  probed: boolean;
  retriedAfterAsk: boolean;
  lastFailure: DenialFailure;
  /** Bumped per request; only the latest request's completion may apply. */
  op: number;
}

export function useMediaDenial(url: string): {
  phase: MediaPhase;
  /** Bumps when the media element must remount (or the document reload). */
  attempt: number;
  /** `message`: the viewer's own error text, shown when the probe finds no refusal. */
  onLoadError: (message?: string) => void;
  ask: () => void;
} {
  const [attempt, setAttempt] = useState(0);
  // Keyed by URL and derived synchronously: the first render for a new target
  // is already `media`, so a viewer that needs its element mounted to load
  // (PdfPreview's container) never renders a stale notice for it.
  const [state, setState] = useState<{ url: string; phase: MediaPhase }>({ url, phase: MEDIA });
  const phase = state.url === url ? state.phase : MEDIA;
  const flags = useRef<Flags>(freshFlags(url));
  // Reset at render, not lazily at the next operation: the moment a new target
  // renders, every in-flight completion for the old one fails its identity
  // check (A→B→A included — the returning A gets a fresh object). Idempotent
  // for a repeated render of the same URL.
  if (flags.current.url !== url) flags.current = freshFlags(url);

  const onLoadError = useCallback(
    (message?: string) => {
      const f = flags.current;
      if (f.retriedAfterAsk) {
        setState({ url, phase: { kind: "failed", failure: f.lastFailure, asked: true, admittedCheckOnly: true } });
        return;
      }
      if (f.probed) return;
      f.probed = true;
      const op = ++f.op;
      setState({ url, phase: { kind: "diagnosing" } });
      void probeMedia(fetchWithoutGrantPrompt, url, true).then((r) => {
        if (flags.current !== f || f.op !== op) return; // superseded (new target or newer request)
        // A probe that succeeds says nothing about access: the element failed
        // for another reason (codec, corrupt file). A `416` (zero-byte file) is
        // an ordinary load error too — `classifyResponse` maps it to `error`.
        const failure: DenialFailure = r.kind === "ok" ? { kind: "error", message: message ?? "media error" } : r;
        f.lastFailure = failure;
        setState({ url, phase: { kind: "failed", failure, asked: false, admittedCheckOnly: false } });
      });
    },
    [url],
  );

  const ask = useCallback(() => {
    const f = flags.current;
    const op = ++f.op;
    setState({ url, phase: { kind: "diagnosing" } }); // held while the dialog is open
    void probeMedia(eligibleFetch, url, false).then((r) => {
      if (flags.current !== f || f.op !== op) return;
      if (r.kind === "ok") {
        f.retriedAfterAsk = true;
        setAttempt((a) => a + 1);
        setState({ url, phase: MEDIA });
        return;
      }
      f.lastFailure = r;
      setState({ url, phase: { kind: "failed", failure: r, asked: true, admittedCheckOnly: false } });
    });
  }, [url]);

  return { phase, attempt, onLoadError, ask };
}
