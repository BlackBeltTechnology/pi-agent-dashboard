/**
 * Declared-server confirm chip (change: auto-canvas, Section 7 / Decision 4).
 *
 * Surfaced from a `canvas({ target:{ kind:"server", port } })` or loopback
 * `kind:"url"` declare with NO pre-tap fetch (S29 — the chip carries ONLY the
 * port + declared path, never an agent-announced host). On TAP it probes
 * `127.0.0.1:port` via the shared `useOpenCanvasTarget().openServer` (registers
 * an in-memory PRESET target, mints a restricted capability, classifies the
 * probe):
 *   - reachable  → opens the restricted preset at the declared path.
 *   - refused / proxy error → "server not running" (S30), NO iframe.
 *   - >3000ms no response   → "server not responding" (S31), NO iframe.
 *
 * The chip is the automatism; the probe is the human's explicit tap gesture.
 * See change: improve-canvas-html-and-url-ux (D1/D8).
 */
import type { ServerChip } from "@blackbelt-technology/pi-dashboard-shared/canvas-declare.js";
import { mdiServerNetwork } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useI18n } from "../../lib/i18n/i18n.js";
import { useOpenCanvasTarget } from "./useOpenCanvasTarget.js";

interface Props {
  chip: ServerChip;
}

export function CanvasServerChip({ chip }: Props) {
  const { t } = useI18n();
  const { openServer, serverStatus: status } = useOpenCanvasTarget();
  const label = chip.title ?? t("canvas.serverChipLabel", undefined, "Preview dev server");
  const address = `:${chip.port}${chip.path && chip.path !== "/" ? chip.path : ""}`;

  const message =
    status === "not-running"
      ? t("canvas.serverNotRunning", undefined, "Server not running")
      : status === "not-responding"
        ? t("canvas.serverNotResponding", undefined, "Server not responding")
        : null;

  return (
    <div className="flex min-w-0 max-w-full items-center gap-2">
      <button
        type="button"
        data-testid="canvas-server-chip"
        data-port={chip.port}
        disabled={status === "probing"}
        onClick={() => {
          if (status !== "probing") void openServer(chip.port, chip.path);
        }}
        className="pointer-events-auto flex min-h-[44px] min-w-0 max-w-full items-center gap-2 rounded-full border border-[var(--border-secondary)] bg-[var(--bg-secondary)] px-3 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-50"
        title={t("canvas.serverChipHint", undefined, "Tap to probe 127.0.0.1 and open a restricted preview")}
      >
        <Icon path={mdiServerNetwork} size={0.6} className="shrink-0 text-[var(--accent-blue)]" />
        <span className="min-w-0 truncate font-medium">{label}</span>
        <span className="shrink-0 font-mono text-[var(--text-tertiary)]">{address}</span>
      </button>
      {message && (
        <span data-testid="canvas-server-chip-status" className="pointer-events-auto text-xs text-[var(--accent-red)]">
          {message}
        </span>
      )}
    </div>
  );
}
