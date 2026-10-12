import { t } from "../../lib/i18n/i18n.js";
import type { FallbackObjectView } from "./parse-fallback-object.js";

/**
 * Key/value view for the generic custom-entry fallback. Text nodes only — keys
 * and values are untrusted extension input, so nothing is interpreted or
 * linkified. See change: render-unclaimed-custom-entries.
 */
export function FallbackKeyValueList({ view }: { view: FallbackObjectView }) {
  return (
    <div className="mx-3 mb-2 px-2 pt-1 pb-1 rounded bg-[var(--bg-secondary)] overflow-y-auto overflow-x-auto max-h-[240px] text-[11px] leading-relaxed">
      <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 font-mono">
        {view.entries.map(([key, display]) => (
          <div key={key} className="contents">
            <dt className="text-[var(--text-tertiary)] break-all">{key}</dt>
            <dd className="text-[var(--text-secondary)] whitespace-pre-wrap break-all">{display}</dd>
          </div>
        ))}
      </dl>
      {view.omitted > 0 ? (
        <div className="mt-1 text-[var(--text-tertiary)]">
          {t(
            view.omitted === 1 ? "customEntry.moreKeysOne" : "customEntry.moreKeysOther",
            { count: view.omitted },
            view.omitted === 1 ? `${view.omitted} more key` : `${view.omitted} more keys`,
          )}
        </div>
      ) : null}
    </div>
  );
}
