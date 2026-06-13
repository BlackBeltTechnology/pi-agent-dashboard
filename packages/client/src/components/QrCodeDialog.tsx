import React, { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Icon } from "@mdi/react";
import { mdiContentCopy, mdiCheck, mdiLanDisconnect, mdiLanConnect, mdiCog } from "@mdi/js";
import { Dialog } from "@blackbelt-technology/pi-dashboard-client-utils/Dialog";

interface Props {
  url?: string;
  connected: boolean;
  onClose: () => void;
  onDisconnect?: () => void;
  onConnect?: () => void;
  onSetup?: () => void;
  /** Disables connect/disconnect + swaps their labels while an action runs. */
  busy?: boolean;
}

export function QrCodeDialog({ url, connected, onClose, onDisconnect, onConnect, onSetup, busy }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (canvasRef.current && url) {
      // qrcode's canvas renderer calls ctx.createImageData which is null
      // under jsdom (no 2D canvas). Swallow the rejection so it doesn't
      // surface as an Unhandled Rejection during tests. Failing to render
      // a QR code is non-fatal — the URL is still shown as text + copy button.
      // Wrap in Promise.resolve so this works whether toCanvas returns a
      // Promise (real qrcode lib) or undefined (test mocks).
      Promise.resolve(
        QRCode.toCanvas(canvasRef.current, url, {
          width: 256,
          margin: 2,
          color: { dark: "#000000", light: "#ffffff" },
        }),
      ).catch(() => {
        /* no-op — QR rendering failed (likely headless/jsdom, no canvas ctx) */
      });
    }
  }, [url]);

  async function handleCopy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={connected ? "Open on Mobile" : "Tunnel Disconnected"}
      size="sm"
      testId="qr-dialog"
    >
          {connected && url ? (
            <>
              {/* QR Code */}
              <div className="flex justify-center mb-4">
                <canvas
                  ref={canvasRef}
                  data-testid="qr-canvas"
                  className="rounded"
                />
              </div>

              {/* URL + Copy */}
              <div className="flex items-center gap-2 bg-[var(--bg-surface)] rounded px-3 py-2">
                <span
                  className="text-sm text-[var(--text-secondary)] truncate flex-1 select-all"
                  title={url}
                  data-testid="qr-url"
                >
                  {url}
                </span>
                <button
                  onClick={handleCopy}
                  className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors flex-shrink-0"
                  title={copied ? "Copied!" : "Copy URL"}
                  data-testid="qr-copy-btn"
                >
                  <Icon path={copied ? mdiCheck : mdiContentCopy} size={0.7} />
                </button>
              </div>

              <p className="text-xs text-[var(--text-muted)] mt-3 text-center">
                Scan to open PI Dashboard or install as an app
              </p>
            </>
          ) : (
            <div className="text-center py-4">
              <p className="text-sm text-[var(--text-secondary)] mb-1">
                Tunnel is set up but not connected.
              </p>
              <p className="text-xs text-[var(--text-muted)]">
                Connect to generate a QR code for mobile access.
              </p>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center justify-center gap-3 mt-4 pt-3 border-t border-[var(--border-primary)]">
            {connected && onDisconnect && (
              <button
                onClick={onDisconnect}
                disabled={busy}
                className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-red-400 transition-colors disabled:opacity-50"
                title="Disconnect tunnel"
                data-testid="qr-disconnect-btn"
              >
                <Icon path={mdiLanDisconnect} size={0.55} />
                {busy ? "Disconnecting…" : "Disconnect"}
              </button>
            )}
            {!connected && onConnect && (
              <button
                onClick={onConnect}
                disabled={busy}
                className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-green-400 transition-colors disabled:opacity-50"
                title="Connect tunnel"
                data-testid="qr-connect-btn"
              >
                <Icon path={mdiLanConnect} size={0.55} />
                {busy ? "Connecting…" : "Connect"}
              </button>
            )}
            {onSetup && (
              <button
                onClick={onSetup}
                className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                title="Tunnel setup"
                data-testid="qr-setup-btn"
              >
                <Icon path={mdiCog} size={0.55} />
                Setup
              </button>
            )}
          </div>
    </Dialog>
  );
}
