/**
 * Declared-server confirm chip (change: auto-canvas, Section 7 / Decision 4).
 *
 * Surfaced from a `canvas({ target:{ kind:"server", port } })` declare with NO
 * pre-tap fetch (S29 — the chip carries ONLY the port, never an agent-announced
 * host). On TAP it probes `127.0.0.1:port` through the existing
 * `LiveServerViewer` allowlist-add path (`startLiveServer`), then classifies the
 * probe result (pure `classifyServerProbe`):
 *   - reachable  → open the live-server viewer via `onTap` (iframe).
 *   - refused / proxy error → "server not running" (S30), NO iframe.
 *   - >3000ms no response   → "server not responding" (S31), NO iframe.
 *
 * The chip is the automatism; the probe is the human's explicit tap gesture.
 */
import type { ServerChip } from "@blackbelt-technology/pi-dashboard-shared/canvas-declare.js";
import { mdiServerNetwork } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useState } from "react";
import { getApiBase } from "../../lib/api/api-context.js";
import { classifyServerProbe } from "../../lib/canvas/canvas-gate.js";
import { useI18n } from "../../lib/i18n/i18n.js";
import { startLiveServer } from "../../lib/api/live-server-api.js";

/** Client timeout for the on-tap probe (S31 threshold). */
const PROBE_TIMEOUT_MS = 3000;

interface Props {
  chip: ServerChip;
  /** Route a REACHABLE probe through the LiveServerViewer allowlist-add path. */
  onTap: (loopbackUrl: string) => void;
}

type ChipStatus = "idle" | "probing" | "not-running" | "not-responding";

export function CanvasServerChip({ chip, onTap }: Props) {
  const { t } = useI18n();
  const [status, setStatus] = useState<ChipStatus>("idle");
  const label = chip.title ?? t("canvas.serverChipLabel", undefined, "Preview dev server");

  const probe = async () => {
    if (status === "probing") return;
    setStatus("probing");
    // Register the loopback target (SSRF gate) and obtain its proxied path.
    const started = await startLiveServer({ host: "127.0.0.1", port: chip.port });
    if (!started.ok) {
      setStatus("not-running");
      return;
    }
    // Probe the proxied path with a hard 3000ms client timeout. A refused
    // upstream surfaces as a non-ok proxy response (fast); a hung upstream
    // trips the abort. No iframe is opened on either failure.
    let aborted = false;
    let ok = false;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      aborted = true;
      controller.abort();
    }, PROBE_TIMEOUT_MS);
    try {
      const res = await fetch(`${getApiBase()}${started.target.path}`, { signal: controller.signal });
      ok = res.ok;
    } catch {
      // AbortError (timeout) or a network error (refused) — classified below.
    } finally {
      clearTimeout(timer);
    }
    const outcome = classifyServerProbe({ aborted, ok });
    if (outcome === "iframe") {
      setStatus("idle");
      onTap(`http://127.0.0.1:${chip.port}/`);
    } else {
      setStatus(outcome);
    }
  };

  const message =
    status === "not-running"
      ? t("canvas.serverNotRunning", undefined, "Server not running")
      : status === "not-responding"
        ? t("canvas.serverNotResponding", undefined, "Server not responding")
        : null;

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        data-testid="canvas-server-chip"
        data-port={chip.port}
        disabled={status === "probing"}
        onClick={() => void probe()}
        className="flex min-h-[44px] items-center gap-2 rounded-full border border-[var(--border-secondary)] bg-[var(--bg-secondary)] px-3 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-50"
        title={t("canvas.serverChipHint", undefined, "Tap to probe 127.0.0.1 and preview")}
      >
        <Icon path={mdiServerNetwork} size={0.6} className="text-[var(--accent-blue)]" />
        <span className="font-medium">{label}</span>
        <span className="font-mono text-[var(--text-tertiary)]">:{chip.port}</span>
      </button>
      {message && (
        <span data-testid="canvas-server-chip-status" className="text-xs text-[var(--accent-red)]">
          {message}
        </span>
      )}
    </div>
  );
}
