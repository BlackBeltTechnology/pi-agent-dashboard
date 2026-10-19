/**
 * The pane-body placeholder a handler-mode tab renders in place of its
 * built-in viewer. The page-level `FileHandlerLayer` aligns the live handler
 * instance over this element (ResizeObserver), so the instance survives the
 * pane unmounting. Also shows the "Resume" notice for an evicted instance.
 *
 * See change: add-editor-pane-file-handlers (D5, task 5.1).
 */
import { useEffect, useRef } from "react";
import { useI18n } from "../../../lib/i18n/i18n.js";
import { useFileHandlerState, useFileHandlerStore } from "./use-file-handler-store.js";

export function FileHandlerAnchor({ instanceKey }: { instanceKey: string }) {
  const { t } = useI18n();
  const store = useFileHandlerStore();
  const ref = useRef<HTMLDivElement>(null);
  const evicted = useFileHandlerState().evicted.has(instanceKey);

  useEffect(() => {
    const el = ref.current;
    store.setAnchor(el);
    return () => {
      if (store.getState().anchor === el) store.setAnchor(null);
    };
  }, [store]);

  return (
    <div ref={ref} data-testid="file-handler-anchor" className="relative min-h-0 flex-1">
      {evicted && (
        <div
          data-testid="file-handler-evicted"
          className="flex h-full flex-col items-center justify-center gap-3 p-6 text-sm text-[var(--text-tertiary)]"
        >
          <span>{t("fileHandler.evicted", undefined, "Editor closed to save memory")}</span>
          <button
            type="button"
            data-testid="file-handler-resume"
            onClick={() => store.resume(instanceKey)}
            className="rounded border border-[var(--border-primary)] px-3 py-1 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
          >
            {t("fileHandler.resume", undefined, "Resume")}
          </button>
        </div>
      )}
    </div>
  );
}
