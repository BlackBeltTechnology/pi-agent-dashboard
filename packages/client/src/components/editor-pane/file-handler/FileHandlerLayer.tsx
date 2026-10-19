/**
 * Page-level host of every live file-handler instance. Mounted ONCE at the app
 * shell, outside `EditorPane` / `SplitWorkspace`, so closing the editor pane,
 * switching tabs/layout/sessions never unmounts an instance (and its edits).
 * Each instance is positioned over the active tab's pane body (the
 * `FileHandlerAnchor`, tracked with a `ResizeObserver`) and hidden otherwise.
 *
 * Also owns: the dialog host (guards, conflict, first-overwrite, cap), the
 * copy-saved toast, `beforeunload`, live plugin-disable reconciliation and the
 * pane bridge (own-save tracking / baseline) for the selected session.
 *
 * See change: add-editor-pane-file-handlers (D5, tasks 5.1–5.3).
 */
import {
  CurrentPluginLayer,
  SlotErrorBoundary,
  useShellSessionOrNull,
  useSlotClaimsVersion,
  useSlotRegistryOrNull,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import { Dialog } from "@blackbelt-technology/pi-dashboard-client-utils/Dialog";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useI18n } from "../../../lib/i18n/i18n.js";
import { Toast, useToast } from "../../primitives/Toast.js";
import { useOptionalSplitWorkspace } from "../../split/SplitWorkspaceContext.js";
import { listFileHandlerClaims } from "./file-handler-claims.js";
import type { HandlerInstance } from "./file-handler-store.js";
import { useFileHandlerState, useFileHandlerStore } from "./use-file-handler-store.js";

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** Viewport rect of `el`, kept current by a `ResizeObserver` + window resize/scroll. */
function useElementRect(el: HTMLElement | null): Rect | null {
  const [rect, setRect] = useState<Rect | null>(null);
  useEffect(() => {
    if (!el) {
      setRect(null);
      return;
    }
    const read = () => {
      const r = el.getBoundingClientRect();
      setRect((p) =>
        p && p.top === r.top && p.left === r.left && p.width === r.width && p.height === r.height
          ? p
          : { top: r.top, left: r.left, width: r.width, height: r.height },
      );
    };
    read();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(read);
    ro?.observe(el);
    window.addEventListener("resize", read);
    window.addEventListener("scroll", read, true);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", read);
      window.removeEventListener("scroll", read, true);
    };
  }, [el]);
  return rect;
}

function InstanceBody({ inst, visible }: { inst: HandlerInstance; visible: boolean }) {
  const store = useFileHandlerStore();
  const session = useShellSessionOrNull(inst.sessionId);
  const setDirty = useCallback((s: boolean | "unknown") => store.setDirty(inst.key, s), [store, inst.key]);
  const context = useMemo(() => ({ pluginId: inst.pluginId }), [inst.pluginId]);
  const Comp = inst.Component;
  if (!Comp || inst.error) return null;
  return (
    <SlotErrorBoundary pluginId={inst.pluginId} slotId="editor-pane-file-handler">
      <Suspense fallback={null}>
        <CurrentPluginLayer pluginId={inst.pluginId}>
          <Comp
            key={inst.mountNonce}
            cwd={inst.cwd}
            path={inst.path}
            session={session ?? null}
            isActive={visible}
            snapshot={inst.host.snapshot}
            save={inst.host.save}
            setDirty={setDirty}
            context={context}
          />
        </CurrentPluginLayer>
      </Suspense>
    </SlotErrorBoundary>
  );
}

function Instance({ inst, visible, rect }: { inst: HandlerInstance; visible: boolean; rect: Rect | null }) {
  const { t } = useI18n();
  const store = useFileHandlerStore();
  const [, navigate] = useLocation();
  const shown = visible && !!rect;
  const style = shown && rect
    ? { position: "fixed" as const, top: rect.top, left: rect.left, width: rect.width, height: rect.height }
    : { display: "none" };
  const discard = async () => {
    if (await store.guardDiscard(inst.key, "discard")) store.discard(inst.key);
  };
  return (
    <div
      data-testid="file-handler-instance"
      data-instance-key={inst.key}
      data-visible={shown ? "1" : "0"}
      style={style}
      className="z-raised flex flex-col overflow-auto bg-[var(--bg-primary)]"
    >
      <InstanceBody inst={inst} visible={shown} />
      {inst.error && (
        <div data-testid="file-handler-error" className="p-4 text-sm text-[var(--text-secondary)]">
          {inst.error.message}
        </div>
      )}
      {inst.claimGone && (
        <div
          data-testid="file-handler-disabled-overlay"
          className="absolute inset-0 flex items-center justify-center bg-[var(--bg-overlay)] p-6 text-center text-sm text-[var(--text-primary)]"
        >
          <div className="flex flex-col items-center gap-3 rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] p-4 shadow-lg">
          <span>
            {t(
              "fileHandler.pluginDisabled",
              { plugin: inst.pluginId },
              "{plugin} was disabled. Re-enable it to save, or discard the edits.",
            )}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              data-testid="file-handler-reenable"
              onClick={() => navigate(`/settings/plugins/${encodeURIComponent(inst.pluginId)}`)}
              className="rounded border border-[var(--border-primary)] px-3 py-1 text-xs hover:bg-[var(--bg-hover)]"
            >
              {t("fileHandler.reenable", undefined, "Re-enable")}
            </button>
            <button
              type="button"
              data-testid="file-handler-discard"
              onClick={() => void discard()}
              className="rounded border border-[var(--border-primary)] px-3 py-1 text-xs hover:bg-[var(--bg-hover)]"
            >
              {t("fileHandler.discardEdits", undefined, "Discard edits")}
            </button>
          </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Renders the head of the store's dialog queue. */
function DialogHost() {
  const { t } = useI18n();
  const store = useFileHandlerStore();
  const head = useFileHandlerState().dialogs[0];
  if (!head) return null;
  const { request, id } = head;
  const tid = request.testId ?? "file-handler-dialog";
  return (
    <Dialog open onClose={() => store.resolveDialog(id, null)} title={request.title} size="sm" testId={tid}>
      <p className="text-sm text-[var(--text-secondary)]">{request.message}</p>
      {request.list && (
        <ul className="mt-2 list-disc pl-5 text-xs text-[var(--text-secondary)]" data-testid={`${tid}-list`}>
          {request.list.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
      <Dialog.Footer>
        <Dialog.Cancel onClick={() => store.resolveDialog(id, null)} testId={`${tid}-cancel`}>
          {t("common.cancel", undefined, "Cancel")}
        </Dialog.Cancel>
        {request.actions.map((a) => (
          <Dialog.Action
            key={a.id}
            intent={a.intent ?? "primary"}
            onClick={() => store.resolveDialog(id, a.id)}
            testId={`${tid}-${a.id}`}
          >
            {a.label}
          </Dialog.Action>
        ))}
      </Dialog.Footer>
    </Dialog>
  );
}

export function FileHandlerLayer() {
  const { t } = useI18n();
  const store = useFileHandlerStore();
  const state = useFileHandlerState();
  const registry = useSlotRegistryOrNull();
  const claimsVersion = useSlotClaimsVersion();
  const split = useOptionalSplitWorkspace();
  const { messages, showToast, dismissToast } = useToast();
  const rect = useElementRect(state.anchor);

  // Pane bridge: own-save tracking + baseline for the selected session.
  const sessionId = split?.sessionId;
  const cwd = split?.cwd;
  const trackedFileWrite = split?.trackedFileWrite;
  const setBaseline = split?.setBaseline;
  const openInSplit = split?.openInSplit;
  useEffect(() => {
    if (sessionId === undefined || cwd === undefined || !trackedFileWrite || !setBaseline || !openInSplit) return;
    store.setBridge({
      sessionId,
      cwd,
      trackedFileWrite,
      setBaseline,
      openFile: (p) => openInSplit(p),
    });
    return () => store.setBridge(null);
  }, [store, sessionId, cwd, trackedFileWrite, setBaseline, openInSplit]);

  // Live plugin disable/enable (slot-claims bump): clean instances close, unsaved ones get the overlay.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `claimsVersion` is the registry's change signal
  useEffect(() => {
    if (!registry) return;
    store.reconcileClaims(new Set(listFileHandlerClaims(registry).map((c) => c.key)));
  }, [store, registry, claimsVersion]);

  // "Saved a copy" toast with an Open action.
  useEffect(() => {
    store.setNotifier((sid, c, path) =>
      showToast(t("fileHandler.copySaved", { path }, "Saved a copy: {path}"), "success", {
        action:
          openInSplit && sessionId === sid && cwd === c
            ? { label: t("fileHandler.open", undefined, "Open"), onClick: () => openInSplit(path) }
            : undefined,
      }),
    );
    return () => store.setNotifier(null);
  }, [store, showToast, t, openInSplit, sessionId, cwd]);

  // Leaving or reloading the page with unsaved/unknown handler edits.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!store.hasUnsaved()) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [store]);

  return (
    <>
      {state.instances.map((inst) => (
        <Instance key={inst.key} inst={inst} visible={state.visibleKey === inst.key} rect={rect} />
      ))}
      <DialogHost />
      <Toast messages={messages} onDismiss={dismissToast} />
    </>
  );
}
