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
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchWithoutGrantPrompt } from "../../lib/access-grants/grant-channel.js";
import { eligibleFetch } from "../../lib/access-grants/preview-provenance.js";
import { type DenialFailure, probeMedia } from "./denial-fetch.js";

export type MediaPhase =
  | { kind: "media" }
  | { kind: "diagnosing" }
  | { kind: "failed"; failure: DenialFailure; asked: boolean; admittedCheckOnly: boolean };

export function useMediaDenial(url: string): {
  phase: MediaPhase;
  /** Bumps when the media element must remount (or the document reload). */
  attempt: number;
  /** `message`: the viewer's own error text, shown when the probe finds no refusal. */
  onLoadError: (message?: string) => void;
  ask: () => void;
} {
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState<MediaPhase>({ kind: "media" });
  const probed = useRef(false);
  const retriedAfterAsk = useRef(false);
  const lastFailure = useRef<DenialFailure>({ kind: "unknown" });
  const live = useRef(url);

  useEffect(() => {
    live.current = url;
    probed.current = false;
    retriedAfterAsk.current = false;
    setPhase({ kind: "media" });
  }, [url]);

  const onLoadError = useCallback((message?: string) => {
    if (retriedAfterAsk.current) {
      setPhase({ kind: "failed", failure: lastFailure.current, asked: true, admittedCheckOnly: true });
      return;
    }
    if (probed.current) return;
    probed.current = true;
    setPhase({ kind: "diagnosing" });
    void probeMedia(fetchWithoutGrantPrompt, url, true).then((r) => {
      if (live.current !== url) return;
      // A probe that succeeds says nothing about access: the element failed for
      // another reason (codec, corrupt file). A `416` (zero-byte file) is an
      // ordinary load error too — `classifyResponse` maps it to `error`.
      const failure: DenialFailure = r.kind === "ok" ? { kind: "error", message: message ?? "media error" } : r;
      lastFailure.current = failure;
      setPhase({ kind: "failed", failure, asked: false, admittedCheckOnly: false });
    });
  }, [url]);

  const ask = useCallback(() => {
    setPhase({ kind: "diagnosing" }); // held while the dialog is open
    void probeMedia(eligibleFetch, url, false).then((r) => {
      if (live.current !== url) return;
      if (r.kind === "ok") {
        retriedAfterAsk.current = true;
        setAttempt((a) => a + 1);
        setPhase({ kind: "media" });
        return;
      }
      lastFailure.current = r;
      setPhase({ kind: "failed", failure: r, asked: true, admittedCheckOnly: false });
    });
  }, [url]);

  return { phase, attempt, onLoadError, ask };
}
