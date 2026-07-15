/**
 * Declared-server confirm chip (change: auto-canvas, Section 7 / Decision 4).
 *
 * Surfaced from a `canvas({ target:{ kind:"server", port } })` declare with NO
 * pre-tap fetch (S29 — the chip carries ONLY the port, never an agent-announced
 * host). On TAP it probes `127.0.0.1:port` through the existing
 * `LiveServerViewer` allowlist-add path (`openLiveTarget`), which runs the
 * client+server loopback SSRF check and resolves to an iframe, or to
 * "server not running" (refused, S30) / "server not responding" (>3000ms, S31)
 * WITHOUT ever iframing a failed target.
 *
 * The chip is the automatism; the fetch is the human's explicit tap gesture.
 */
import { mdiServerNetwork } from "@mdi/js";
import { Icon } from "@mdi/react";
import type { ServerChip } from "@blackbelt-technology/pi-dashboard-shared/canvas-declare.js";
import { useI18n } from "../lib/i18n";

interface Props {
  chip: ServerChip;
  /** Route the tap through the LiveServerViewer allowlist-add + loopback probe. */
  onTap: (loopbackUrl: string) => void;
}

export function CanvasServerChip({ chip, onTap }: Props) {
  const { t } = useI18n();
  const label = chip.title ?? t("canvas.serverChipLabel", undefined, "Preview dev server");
  return (
    <button
      type="button"
      data-testid="canvas-server-chip"
      data-port={chip.port}
      onClick={() => onTap(`http://127.0.0.1:${chip.port}/`)}
      className="flex items-center gap-2 rounded-full border border-[var(--border-secondary)] bg-[var(--bg-secondary)] px-3 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
      title={t("canvas.serverChipHint", undefined, "Tap to probe 127.0.0.1 and preview")}
    >
      <Icon path={mdiServerNetwork} size={0.6} className="text-[var(--accent-blue)]" />
      <span className="font-medium">{label}</span>
      <span className="font-mono text-[var(--text-tertiary)]">:{chip.port}</span>
    </button>
  );
}
