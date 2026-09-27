/**
 * Ordered backend chain editor, adapted from
 * packages/blackhole-plugin/src/client/ChainEditor.tsx: button reorder (never
 * drag-only, WCAG 2.1.1), boundary controls disabled rather than absent, every
 * control's accessible name names its backend, a one-entry chain has no remove.
 * After a move focus stays on the moved entry (mockup probe finding).
 * With a `consumer`, incompatible backends are hidden from the picker unless
 * "show incompatible" is on; off-machine backends are disabled while the
 * switch is off. See change: add-system-one-registry.
 */
import { useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import type { ConsumerDeclaration } from "@blackbelt-technology/pi-system-one";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import type { BackendView, Draft } from "./api.js";
import { EgressBadge } from "./EgressBadge.js";
import { incompatibleWith, move, unusableReason } from "./model.js";

const btn =
  "inline-grid place-items-center w-8 h-8 max-sm:w-11 max-sm:h-11 rounded-md border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] text-[var(--text-primary)] hover:bg-[var(--bg-surface)] disabled:opacity-40 disabled:cursor-not-allowed";

export interface ChainEditorProps {
  idPrefix: string;
  chain: string[];
  draft: Draft;
  views: Record<string, BackendView>;
  onChange: (next: string[]) => void;
  consumer?: ConsumerDeclaration;
}

export function ChainEditor({ idPrefix, chain, draft, views, onChange, consumer }: ChainEditorProps): React.ReactElement {
  const t = useT();
  const [showIncompat, setShowIncompat] = useState(false);
  const [pick, setPick] = useState("");
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const refs = useRef(new Map<string, HTMLButtonElement | null>());

  useEffect(() => {
    if (!focusKey) return;
    const [id, op] = focusKey.split("\u0000");
    const same = refs.current.get(`${id}:${op}`);
    const other = refs.current.get(`${id}:${op === "up" ? "down" : "up"}`);
    (same && !same.disabled ? same : other)?.focus();
    setFocusKey(null);
  }, [focusKey]);

  const candidates = Object.keys(draft.backends).filter((id) => !chain.includes(id));
  const incompat = (id: string) => (consumer ? incompatibleWith(consumer, id, views) : []);
  const hiddenCount = consumer && !showIncompat ? candidates.filter((id) => incompat(id).length > 0).length : 0;
  const offered = candidates.filter((id) => showIncompat || incompat(id).length === 0);
  const offDisabled = (id: string) => views[id]?.offMachine === true && !draft.allowOffMachine;
  const selectable = offered.filter((id) => !offDisabled(id));
  const current = selectable.includes(pick) ? pick : (selectable[0] ?? "");

  const reasonText = (id: string): string | null => {
    const r = unusableReason(id, draft, views);
    if (r === "off-machine") return t("skippedOffMachine", undefined, "skipped: off-machine use is off");
    if (r === "runtime") return t("skippedRuntime", undefined, "skipped: runtime unavailable");
    if (r === "not-saved") return t("skippedNotSaved", undefined, "save to classify");
    return null;
  };

  return (
    <div className="flex flex-col gap-1.5">
      <ol className="list-none m-0 p-0 flex flex-col gap-1.5" aria-label={t("chainOrder", undefined, "Chain order")}>
        {chain.map((id, i) => {
          const why = reasonText(id);
          return (
            <li
              key={id}
              data-testid={`${idPrefix}-entry-${i}`}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] px-2 py-1.5"
            >
              <span className="w-5 text-right text-[12px] text-[var(--text-secondary)]">{i + 1}</span>
              <span className={`font-semibold ${why ? "line-through text-[var(--text-secondary)]" : "text-[var(--text-primary)]"}`}>{id}</span>
              <EgressBadge view={views[id]} />
              {why && <span className="text-[12px] text-[var(--text-secondary)]">{why}</span>}
              <span className="ml-auto flex gap-1">
                <button
                  type="button"
                  ref={(el) => {
                    refs.current.set(`${id}:up`, el);
                  }}
                  className={btn}
                  disabled={i === 0}
                  aria-label={t("moveUp", { id }, `Move ${id} up`)}
                  onClick={() => {
                    onChange(move(chain, i, i - 1));
                    setFocusKey(`${id}\u0000up`);
                  }}
                >
                  ↑
                </button>
                <button
                  type="button"
                  ref={(el) => {
                    refs.current.set(`${id}:down`, el);
                  }}
                  className={btn}
                  disabled={i === chain.length - 1}
                  aria-label={t("moveDown", { id }, `Move ${id} down`)}
                  onClick={() => {
                    onChange(move(chain, i, i + 1));
                    setFocusKey(`${id}\u0000down`);
                  }}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className={btn}
                  disabled={chain.length <= 1}
                  aria-label={t("removeFromChain", { id }, `Remove ${id} from chain`)}
                  onClick={() => onChange(chain.filter((x) => x !== id))}
                >
                  ×
                </button>
              </span>
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`${idPrefix}-add`}>
          {t("backendToAdd", undefined, "Backend to add")}
        </label>
        <select
          id={`${idPrefix}-add`}
          data-testid={`${idPrefix}-add-select`}
          className="min-w-[12rem] rounded border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-3 py-1.5 text-sm text-[var(--text-primary)]"
          value={current}
          onChange={(e) => setPick(e.target.value)}
        >
          {offered.length === 0 && <option value="">{t("noMoreBackends", undefined, "No more backends")}</option>}
          {offered.map((id) => {
            const notes = [
              incompat(id).length ? t("incompatibleNote", { reasons: incompat(id).join(", ") }, `incompatible: ${incompat(id).join(", ")}`) : null,
              offDisabled(id) ? t("offMachineDisabledNote", undefined, "off-machine, disabled") : null,
            ].filter(Boolean);
            return (
              <option key={id} value={id} disabled={offDisabled(id)}>
                {notes.length ? `${id} (${notes.join("; ")})` : id}
              </option>
            );
          })}
        </select>
        <button
          type="button"
          className="rounded-md border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-3 py-1.5 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-surface)] disabled:opacity-50"
          disabled={!current}
          onClick={() => current && onChange([...chain, current])}
        >
          {t("addToChain", undefined, "Add to chain")}
        </button>
        {consumer && (hiddenCount > 0 || showIncompat) && (
          <label className="flex items-center gap-1.5 text-[12px] text-[var(--text-secondary)] cursor-pointer">
            <input
              type="checkbox"
              data-testid={`${idPrefix}-show-incompat`}
              checked={showIncompat}
              onChange={(e) => setShowIncompat(e.target.checked)}
            />
            {hiddenCount
              ? t("showIncompatibleCount", { count: hiddenCount }, `Show incompatible backends (${hiddenCount} hidden)`)
              : t("showIncompatible", undefined, "Show incompatible backends")}
          </label>
        )}
      </div>
      {consumer && showIncompat && (
        <p className="m-0 text-[12px] text-[var(--text-secondary)]" data-testid={`${idPrefix}-incompat-warning`}>
          {t(
            "incompatibleWarning",
            undefined,
            "Incompatible backends are likely to fail on this consumer's questions; the chain then falls through.",
          )}
        </p>
      )}
    </div>
  );
}
