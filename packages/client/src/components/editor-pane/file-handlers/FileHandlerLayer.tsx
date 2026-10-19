/**
 * Page-level layer that renders every live plugin file-handler instance.
 *
 * Mounted ONCE at the app shell (inside the split provider, outside
 * `SplitWorkspace`/`EditorPane`), because `SplitWorkspace` unmounts the editor
 * subtree when the pane closes. Each instance is positioned `fixed` over the
 * session pane body (tracked by a `ResizeObserver`) and hidden — never
 * unmounted — when its tab is not the active one, the pane is closed or another
 * session is selected. Owns: eviction placeholder ("Resume"), the live
 * plugin-disable overlay, the "unavailable" notice, the dialogs, the copy toast
 * and the `beforeunload` guard.
 *
 * See change: add-editor-pane-file-handlers (D5).
 */
import { useSlotClaimsVersion, useSlotRegistryOrNull } from "@blackbelt-technology/dashboard-plugin-runtime";
import { useCallback, useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react";
import { useLocation } from "wouter";
import { useI18n } from "../../../lib/i18n/i18n.js";
import { Toast, type ToastMessage } from "../../primitives/Toast.js";
import { useOptionalSplitWorkspace } from "../../split/SplitWorkspaceContext.js";
import { FileHandlerDialogs } from "./FileHandlerDialogs.js";
import { FileHandlerHost } from "./FileHandlerHost.js";
import { type FileHandlerStore, fileHandlerStore, type HandlerInstance } from "./file-handler-store.js";

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Viewport rect of `el`, refreshed on resize of the element, window resize and any scroll. */
function useAnchorRect(el: HTMLElement | null): Rect | null {
  const [rect, setRect] = useState<Rect | null>(null);
  useLayoutEffect(() => {
    if (!el) {
      setRect(null);
      return;
    }
    const update = () => {
      const r = el.getBoundingClientRect();
      setRect((p) => (p && p.left === r.left && p.top === r.top && p.width === r.width && p.height === r.height ? p : { left: r.left, top: r.top, width: r.width, height: r.height }));
    };
    update();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    ro?.observe(el);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [el]);
  return rect;
}

function Overlay({ testId, children }: { testId: string; children: React.ReactNode }) {
  return (
    <div
      data-testid={testId}
      className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-[var(--bg-primary)]/95 p-6 text-center text-sm text-[var(--text-secondary)]"
    >
      {children}
    </div>
  );
}

const BTN = "rounded border border-[var(--border-primary)] px-3 py-1 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)]";

function InstanceFrame({ inst, visible, rect, store }: { inst: HandlerInstance; visible: boolean; rect: Rect | null; store: FileHandlerStore }) {
  const { t } = useI18n();
  const [, navigate] = useLocation();
  const style = visible && rect ? { position: "fixed" as const, left: rect.left, top: rect.top, width: rect.width, height: rect.height } : { display: "none" };
  const discard = async () => {
    // `disable` guard confirms (the instance is unsaved/unknown by construction).
    if (!(await store.guard(inst.key, "disable"))) return;
    store.destroy(inst.key);
    store.getState().pane?.clearMode(inst.path);
  };
  const backToPreview = () => {
    store.destroy(inst.key);
    store.getState().pane?.clearMode(inst.path);
  };
  return (
    <div
      data-testid="file-handler-instance"
      data-instance-key={inst.key}
      data-claim={inst.claim.ref}
      data-visible={visible ? "true" : "false"}
      data-dirty={String(inst.dirty)}
      className="z-10 flex flex-col overflow-auto bg-[var(--bg-primary)]"
      style={style}
    >
      {inst.evicted ? (
        <div data-testid="file-handler-evicted" className="flex h-full flex-col items-center justify-center gap-3 p-6 text-sm text-[var(--text-tertiary)]">
          <span>{t("fileHandler.evicted", undefined, "Editor closed to save memory")}</span>
          <button type="button" className={BTN} data-testid="file-handler-resume" onClick={() => store.resume(inst.key)}>
            {t("fileHandler.resume", undefined, "Resume")}
          </button>
        </div>
      ) : (
        <>
          <div className="relative flex min-h-0 flex-1 flex-col">
            <FileHandlerHost key={inst.nonce} inst={inst} isActive={visible} store={store} />
          </div>
          {inst.unavailableLimit !== undefined && (
            <Overlay testId="file-handler-unavailable">
              <span>{t("fileHandler.unavailable", { limit: Math.round(inst.unavailableLimit / (1024 * 1024)) }, "This mode is unavailable: the file exceeds its {limit} MiB limit.")}</span>
              <button type="button" className={BTN} data-testid="file-handler-unavailable-back" onClick={backToPreview}>
                {t("fileHandler.backToPreview", undefined, "Back to Preview")}
              </button>
            </Overlay>
          )}
          {inst.disabled && (
            <Overlay testId="file-handler-disabled">
              <span>{t("fileHandler.disabled", { plugin: inst.claim.pluginId }, "{plugin} was disabled. Re-enable it to save, or discard the edits.")}</span>
              <div className="flex gap-2">
                <button type="button" className={BTN} data-testid="file-handler-reenable" onClick={() => navigate("/settings/plugins")}>
                  {t("fileHandler.reenable", undefined, "Re-enable")}
                </button>
                <button type="button" className={`${BTN} text-red-400`} data-testid="file-handler-discard" onClick={() => void discard()}>
                  {t("fileHandler.discard", undefined, "Discard")}
                </button>
              </div>
            </Overlay>
          )}
        </>
      )}
    </div>
  );
}

export function FileHandlerLayer({ store = fileHandlerStore }: { store?: FileHandlerStore }) {
  const { t } = useI18n();
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const { instances, pane, dialogs, notices } = state;
  const rect = useAnchorRect(pane?.anchor ?? null);
  const registry = useSlotRegistryOrNull();
  const claimsVersion = useSlotClaimsVersion();
  const ws = useOptionalSplitWorkspace();

  // Live plugin disable: the layer kept the component captured at mount, so a
  // vanished claim leaves the instance mounted. Clean → close (the tab falls back
  // to the built-in view); unsaved/unknown → hold with the overlay.
  // biome-ignore lint/correctness/useExhaustiveDependencies: claimsVersion is a re-run trigger
  useEffect(() => {
    if (!registry) return;
    const present = new Set(registry.getClaims("editor-pane-file-handler").map((c) => `${c.pluginId}/${c.id}`));
    for (const inst of instances.values()) {
      const has = present.has(inst.claim.ref);
      if (!has && (inst.evicted || inst.dirty === false)) store.destroy(inst.key);
      else store.setDisabled(inst.key, !has);
    }
  }, [registry, claimsVersion, instances, store]);

  // `beforeunload`: prevent only while some live instance is unsaved/unknown.
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (!store.hasUnsaved()) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [store]);

  const openCopy = useCallback(
    (sessionId: string, path: string) => {
      if (ws && ws.sessionId === sessionId) ws.openInSplit(path);
    },
    [ws],
  );
  const toasts: ToastMessage[] = notices.map((n) => ({
    id: n.id,
    text: t("fileHandler.copySaved", { path: n.path }, "Saved a copy: {path}"),
    variant: "success",
    noAutoDismiss: true,
    action: { label: t("fileHandler.open", undefined, "Open"), onClick: () => openCopy(n.sessionId, n.path) },
  }));

  return (
    <>
      {[...instances.values()].map((inst) => (
        <InstanceFrame
          key={inst.key}
          inst={inst}
          visible={!!pane && pane.sessionId === inst.sessionId && pane.activeKey === inst.key}
          rect={rect}
          store={store}
        />
      ))}
      <FileHandlerDialogs entry={dialogs[0]} store={store} />
      {toasts.length > 0 && <Toast messages={toasts} onDismiss={(id) => store.dismissNotice(id)} />}
    </>
  );
}
