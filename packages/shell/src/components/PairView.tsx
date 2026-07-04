import { useCallback, useEffect, useRef, useState } from "react";
import { addServer } from "../lib/keyring.js";
import {
  challengeIdentity,
  decodePayloadString,
  type PairingPayload,
  postJson,
} from "../lib/protocol.js";

type Phase = "idle" | "verifying" | "confirm" | "polling" | "done" | "error";

interface RedeemResult {
  pendingId: string;
  confirmCode: string;
}

interface PollResult {
  status: "pending" | "approved" | "unknown";
  token?: string;
}

const POLL_INTERVAL_MS = 2000;

export function PairView({ onPaired }: { onPaired?: () => void }) {
  const [raw, setRaw] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [confirmCode, setConfirmCode] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const cancelled = useRef(false);

  // Stop any in-flight polling loop when the component unmounts (e.g. the user
  // navigates to the keyring mid-pairing) so /api/pair/poll doesn't fire forever.
  useEffect(() => () => { cancelled.current = true; }, []);

  const run = useCallback(async (payload: PairingPayload) => {
    cancelled.current = false;
    setError(null);
    setPhase("verifying");

    // 1. Confirm the pinned fingerprint against a live-signed challenge on the
    //    first reachable url. Refuse on mismatch.
    let verifiedUrl: string | null = null;
    let pinnedPubkey: string | null = null;
    for (const url of payload.urls) {
      try {
        const proof = await challengeIdentity(url);
        if (proof.verified && proof.fingerprint === payload.id) {
          verifiedUrl = url;
          pinnedPubkey = proof.publicKey;
          break;
        }
      } catch {
        // try next url
      }
    }
    if (!verifiedUrl || !pinnedPubkey) {
      setPhase("error");
      setError("Could not verify server identity (pin mismatch or unreachable).");
      return;
    }

    // 2. Redeem the pairing code → get the confirm code to show the operator.
    let redeemed: RedeemResult;
    try {
      redeemed = await postJson<RedeemResult>(verifiedUrl, "/api/pair/redeem", {
        code: payload.code,
      });
    } catch (err) {
      setPhase("error");
      setError(`Redeem failed: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    setConfirmCode(redeemed.confirmCode);
    setPhase("confirm");

    // 3. Poll until approved. The operator types the confirm code into the
    //    dashboard to approve; then the durable bearer arrives.
    setPhase("polling");
    while (!cancelled.current) {
      let poll: PollResult;
      try {
        poll = await postJson<PollResult>(verifiedUrl, "/api/pair/poll", {
          pendingId: redeemed.pendingId,
        });
      } catch (err) {
        setPhase("error");
        setError(`Poll failed: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }
      if (poll.status === "approved" && poll.token) {
        try {
          await addServer({
            id: payload.id,
            label: label.trim() || new URL(verifiedUrl).host,
            urls: payload.urls,
            pinnedPubkey,
            pinnedFingerprint: payload.id,
            bearerToken: poll.token,
          });
        } catch (err) {
          setPhase("error");
          setError(`Could not save to keyring: ${err instanceof Error ? err.message : String(err)}`);
          return;
        }
        setPhase("done");
        onPaired?.();
        return;
      }
      if (poll.status === "unknown") {
        setPhase("error");
        setError("Pairing expired or was rejected. Start over.");
        return;
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  }, [label, onPaired]);

  const submitPaste = useCallback(() => {
    try {
      run(decodePayloadString(raw));
    } catch (err) {
      setPhase("error");
      setError(err instanceof Error ? err.message : "Invalid pairing string");
    }
  }, [raw, run]);

  const scanQr = useCallback(async () => {
    if (!("BarcodeDetector" in window)) {
      setError("QR scanning not supported on this browser — paste the code instead.");
      return;
    }
    setError(null);
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      const video = document.createElement("video");
      video.srcObject = stream;
      await video.play();
      // biome-ignore lint/suspicious/noExplicitAny: BarcodeDetector lacks lib types.
      const detector = new (window as any).BarcodeDetector({ formats: ["qr_code"] });
      const deadline = Date.now() + 30_000;
      let found: string | null = null;
      while (Date.now() < deadline && !found) {
        const codes = await detector.detect(video);
        if (codes.length > 0) found = codes[0].rawValue as string;
        else await new Promise((r) => setTimeout(r, 200));
      }
      if (!found) {
        setError("No QR code detected. Try again or paste the code.");
        return;
      }
      setRaw(found);
      run(decodePayloadString(found));
    } catch (err) {
      setError(`Camera/scan error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      // Always release the camera, even if detect() throws mid-loop.
      if (stream) for (const track of stream.getTracks()) track.stop();
    }
  }, [run]);

  const busy = phase === "verifying" || phase === "confirm" || phase === "polling";

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <h2 className="text-lg font-semibold">Pair a server</h2>

      <label className="block text-sm text-neutral-400">
        Label (optional)
        <input
          className="mt-1 w-full rounded bg-neutral-900 px-3 py-2 text-neutral-100 outline-none ring-1 ring-neutral-800 focus:ring-blue-600"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="My laptop dashboard"
          disabled={busy}
        />
      </label>

      <label className="block text-sm text-neutral-400">
        Pairing code (paste)
        <textarea
          className="mt-1 h-24 w-full resize-none rounded bg-neutral-900 px-3 py-2 font-mono text-xs text-neutral-100 outline-none ring-1 ring-neutral-800 focus:ring-blue-600"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder="Paste the copy-string from the dashboard…"
          disabled={busy}
        />
      </label>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={submitPaste}
          disabled={busy || raw.trim().length === 0}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          Pair
        </button>
        <button
          type="button"
          onClick={scanQr}
          disabled={busy}
          className="rounded bg-neutral-800 px-4 py-2 text-sm font-medium text-neutral-100 disabled:opacity-40"
        >
          Scan QR
        </button>
      </div>

      {phase === "verifying" && <p className="text-sm text-neutral-400">Verifying server identity…</p>}

      {(phase === "confirm" || phase === "polling") && confirmCode && (
        <div className="rounded border border-blue-800 bg-blue-950/40 p-4 text-center">
          <p className="text-sm text-neutral-300">Type this code on the dashboard to approve:</p>
          <p className="mt-2 font-mono text-3xl font-bold tracking-widest text-blue-300">{confirmCode}</p>
          <p className="mt-2 text-xs text-neutral-500">Waiting for approval…</p>
        </div>
      )}

      {phase === "done" && (
        <p className="rounded border border-green-800 bg-green-950/40 p-3 text-sm text-green-300">
          Paired successfully. The server is now in your keyring.
        </p>
      )}

      {error && (
        <p className="rounded border border-red-800 bg-red-950/40 p-3 text-sm text-red-300">{error}</p>
      )}
    </div>
  );
}
