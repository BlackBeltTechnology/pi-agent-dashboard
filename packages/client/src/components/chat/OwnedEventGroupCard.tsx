import { mdiChevronRight, mdiPuzzleOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useState } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";

interface Props {
  eventType: string;
  /** Display name of the owning plugin (falls back to its id). */
  pluginName: string;
  count: number;
  payloads: readonly unknown[];
}

/**
 * One collapsed row for a plugin-owned event type whose owner is unavailable:
 * "N <type> events — <plugin> plugin unavailable". Payloads (the last 50) show
 * on expand. Rendered by ChatView only while the owner is unavailable.
 * See change: decouple-plugins-from-core (design D5 item 4).
 */
export function OwnedEventGroupCard({ eventType, pluginName, count, payloads }: Props) {
  const [expanded, setExpanded] = useState(false);
  const label = i18nT(
    "chat.ownedGroup.unavailable",
    { count, type: eventType, plugin: pluginName },
    "{count} {type} events — {plugin} plugin unavailable",
  );

  return (
    <div className="my-1 mx-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] overflow-hidden text-xs">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
      >
        <Icon
          path={mdiChevronRight}
          size={0.55}
          className={`text-[var(--text-tertiary)] transition-transform ${expanded ? "rotate-90" : ""}`}
        />
        <Icon path={mdiPuzzleOutline} size={0.55} className="text-orange-400" />
        <span className="font-mono text-orange-400">{label}</span>
      </button>
      {expanded &&
        payloads.map((payload, i) => (
          <pre
            key={i}
            className="px-3 pb-2 pt-1 overflow-x-auto text-[var(--text-secondary)] font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all"
          >
            {JSON.stringify(payload, null, 2)}
          </pre>
        ))}
    </div>
  );
}
