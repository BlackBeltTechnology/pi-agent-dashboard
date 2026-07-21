/**
 * Instructions page — the editable scoped-markdown surface.
 *
 * Bounded file picker (left) + controlled Monaco markdown buffer (right) with a
 * dirty-gated Save Bar. Self-contained save contract: this page owns its own
 * dirty/save state and does NOT thread into the global SettingsPanel save
 * fan-out (design Decision #1). Optimistic concurrency via mtime — a stale
 * write returns 409 and surfaces a conflict banner.
 *
 * Scope:
 *   - `cwd` present → directory scope. Reads + writes resolve against `cwd`.
 *   - `cwd` absent  → global scope (~/.pi/agent). Reads via `/api/file/md-read`
 *     (gated by the same `isWritableMdTarget` guard as write + candidates), so
 *     global scope works through one symmetric security model.
 *
 * See change: directory-settings-page-and-scoped-md-editing.
 */
import { Confirm } from "@blackbelt-technology/pi-dashboard-client-utils/Confirm";
import { fileKind } from "@blackbelt-technology/pi-dashboard-shared/file-kind.js";
import type {
  FileWriteResponse,
  MdCandidate,
} from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import type { ApiResponse } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useSearchParams } from "wouter";
import { useMediaQuery } from "../../hooks/useMediaQuery.js";
import { useTreeColumnWidth } from "../../hooks/useTreeColumnWidth.js";
import { getApiBase } from "../../lib/api/api-context.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { FilePicker } from "./FilePicker.js";
// The lazy Monaco mount + mtime formatting live in InstructionsEditorPane.
import { InstructionsEditorPane } from "./InstructionsEditorPane.js";

interface Props {
  cwd?: string;
}

interface Message {
  type: "success" | "error";
  text: string;
}

/** Discard-unsaved-changes confirm, shared by the file-switch and mobile-back guards. */
function DiscardConfirm({
  open,
  testId,
  fileLabel,
  onConfirm,
  onClose,
}: {
  open: boolean;
  testId: string;
  fileLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Confirm
      open={open}
      testId={testId}
      intent="danger"
      title={i18nT("common.discardUnsavedChanges", undefined, "Discard unsaved changes?")}
      message={i18nT(
        "common.discardUnsavedToFile",
        undefined,
        `Discard unsaved changes to ${fileLabel}?`,
      )}
      confirmLabel={i18nT("common.discard", undefined, "Discard")}
      onConfirm={onConfirm}
      onClose={onClose}
    />
  );
}

/** Build the scoped markdown read URL; global scope omits `cwd`. */
function fileReadUrl(cwd: string | undefined, absPath: string): string {
  const base = `${getApiBase()}/api/file/md-read?path=${encodeURIComponent(absPath)}`;
  return cwd ? `${base}&cwd=${encodeURIComponent(cwd)}` : base;
}

/**
 * Resolve which candidate the `?file=` query selects. Exact match wins; else the
 * default is viewport-gated — desktop falls back to AGENTS.md/first, mobile
 * returns null so the master/detail layout shows the tree.
 */
function resolveSelection(
  candidates: MdCandidate[],
  fileParam: string | null,
  isDesktop: boolean,
): MdCandidate | null {
  const target = fileParam ? candidates.find((c) => c.relPath === fileParam) : undefined;
  if (target) return target;
  if (!isDesktop) return null;
  return candidates.find((c) => c.relPath === "AGENTS.md") ?? candidates[0] ?? null;
}

/**
 * `md`-breakpoint gate. jsdom lacks `matchMedia`; treat its absence as desktop
 * so the default split renders (and existing desktop tests stay green).
 */
function useIsDesktop(): boolean {
  const mdUp = useMediaQuery("(min-width: 768px)");
  const hasMatchMedia = typeof window !== "undefined" && typeof window.matchMedia === "function";
  return hasMatchMedia ? mdUp : true;
}

export function InstructionsPage({ cwd }: Props) {
  // URL is the source of truth for the active file (`?file=<relPath>`), so each
  // selection is a discrete, refresh-safe, back-walkable history entry.
  // See change: fix-plugin-and-scoped-back-navigation.
  const [location, navigate] = useLocation();
  const [searchParams] = useSearchParams();
  const fileParam = searchParams.get("file");

  // Below `md` the page is a mobile master/detail; at/above it is a split.
  const isDesktop = useIsDesktop();

  // Resizable tree column (desktop only). The hook owns the drag lifecycle and
  // persists on mouseup. See change: directory-settings-tree-and-resize.
  const { width: treeWidth, containerRef: pageRef, startResize } = useTreeColumnWidth();
  const [candidates, setCandidates] = useState<MdCandidate[]>([]);
  const [selected, setSelected] = useState<MdCandidate | null>(null);
  const [loadedContent, setLoadedContent] = useState<string>("");
  const [loadedMtime, setLoadedMtime] = useState<number | null>(null);
  const [buffer, setBuffer] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  // Pending file switch awaiting discard confirmation (dirty guard).
  const [pendingSwitch, setPendingSwitch] = useState<MdCandidate | null>(null);
  // Mobile back-to-tree awaiting discard confirmation (dirty guard).
  const [confirmBack, setConfirmBack] = useState(false);

  const dirty = buffer !== loadedContent;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  // Monotonic load token. Each `loadCandidate` bumps it; a slower in-flight read
  // whose token is stale is discarded, so clicking file A then B can never let
  // A's late response overwrite B's buffer. See change (CodeRabbit): out-of-order reads.
  const loadSeqRef = useRef(0);

  // Hard exits (tab close / reload) while dirty → native prompt.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  // Load a candidate's content into the buffer.
  const loadCandidate = useCallback(
    (candidate: MdCandidate) => {
      const seq = ++loadSeqRef.current;
      const isStale = () => seq !== loadSeqRef.current;
      setSelected(candidate);
      setLoading(true);
      setReadError(null);
      setConflict(false);
      setMessage(null);
      fetch(fileReadUrl(cwd, candidate.path))
        .then((res) => res.json() as Promise<ApiResponse<{ content?: string; mtime?: number }>>)
        .then((body) => {
          if (isStale()) return; // a newer load superseded this one
          if (!body.success || typeof body.data?.content !== "string") {
            setReadError(body.success ? "File is not readable as text" : body.error ?? "Failed to load file");
            setLoadedContent("");
            setBuffer("");
            setLoadedMtime(null);
            return;
          }
          setLoadedContent(body.data.content);
          setBuffer(body.data.content);
          setLoadedMtime(body.data.mtime ?? null);
        })
        .catch((err) => {
          if (isStale()) return;
          setReadError(err?.message ?? "Network error");
          setLoadedContent("");
          setBuffer("");
          setLoadedMtime(null);
        })
        .finally(() => {
          if (!isStale()) setLoading(false);
        });
    },
    [cwd],
  );

  const handleCandidatesLoaded = useCallback((cands: MdCandidate[]) => {
    setCandidates(cands);
  }, []);

  // Resolve the active file from `?file=` against the loaded candidates. Default
  // selection is viewport-gated: at ≥md, absent/unknown `?file=` falls back to
  // AGENTS.md/first; below md, absent/unknown `?file=` leaves the selection null
  // so the mobile master/detail layout shows the tree.
  // See change: directory-settings-tree-and-resize.
  useEffect(() => {
    if (candidates.length === 0) return;
    const next = resolveSelection(candidates, fileParam, isDesktop);
    if (next === null) {
      if (selected !== null) setSelected(null);
      return;
    }
    if (next.path !== selected?.path) loadCandidate(next);
  }, [fileParam, candidates, selected, isDesktop, loadCandidate]);

  // Selection is a URL push so browser/OS back walks file→file→page→launcher.
  const selectFile = useCallback(
    (candidate: MdCandidate) => {
      navigate(`${location}?file=${encodeURIComponent(candidate.relPath)}`);
    },
    [location, navigate],
  );

  // Picker click: guard with a confirm when the buffer is dirty.
  const handleSelect = useCallback(
    (candidate: MdCandidate) => {
      if (candidate.path === selected?.path) return;
      if (dirtyRef.current) {
        setPendingSwitch(candidate);
        return;
      }
      selectFile(candidate);
    },
    [selected, selectFile],
  );

  const confirmSwitch = useCallback(() => {
    const next = pendingSwitch;
    setPendingSwitch(null);
    if (next) selectFile(next);
  }, [pendingSwitch, selectFile]);

  const handleDiscard = useCallback(() => {
    setBuffer(loadedContent);
    setConflict(false);
    setMessage(null);
  }, [loadedContent]);

  // POST the buffer. Returns the parsed response so callers can chain.
  const postWrite = useCallback(
    async (mtime: number) => {
      if (!selected) return null;
      const res = await fetch(`${getApiBase()}/api/file/write`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(cwd ? { cwd } : {}),
          path: selected.path,
          content: buffer,
          mtime,
        }),
      });
      const body = (await res.json()) as FileWriteResponse;
      return { status: res.status, body };
    },
    [cwd, selected, buffer],
  );

  // Apply a write response to state. `handle409` routes a stale-mtime response
  // into the conflict banner (Save) vs. treating it as a plain error (Overwrite).
  const applyWriteOutcome = useCallback(
    (result: { status: number; body: FileWriteResponse }, handle409: boolean) => {
      const { status, body } = result;
      if (status === 200 && body.success && body.data) {
        setLoadedContent(buffer);
        setLoadedMtime(body.data.mtime);
        setConflict(false);
        setMessage({ type: "success", text: i18nT("common.saved", undefined, "Saved") });
        return;
      }
      if (handle409 && status === 409) {
        setConflict(true);
        setMessage(null);
        return;
      }
      setMessage({
        type: "error",
        text: body.success ? "Write failed" : body.error ?? `Save failed (${status})`,
      });
    },
    [buffer],
  );

  const handleSave = useCallback(async () => {
    if (!selected || loadedMtime === null || saving) return;
    setSaving(true);
    setMessage(null);
    try {
      const result = await postWrite(loadedMtime);
      if (result) applyWriteOutcome(result, true);
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Network error" });
    } finally {
      setSaving(false);
    }
  }, [selected, loadedMtime, saving, postWrite, applyWriteOutcome]);

  // Conflict resolution — reload disk content, replacing the buffer.
  const reloadFromDisk = useCallback(() => {
    if (selected) loadCandidate(selected);
  }, [selected, loadCandidate]);

  // Conflict resolution — re-fetch the fresh mtime, then overwrite with it.
  const overwriteAnyway = useCallback(async () => {
    if (!selected || saving) return;
    setSaving(true);
    setMessage(null);
    try {
      const readRes = await fetch(fileReadUrl(cwd, selected.path));
      const readBody = (await readRes.json()) as ApiResponse<{ mtime?: number }>;
      const freshMtime = readBody.success ? readBody.data?.mtime : undefined;
      if (typeof freshMtime !== "number") {
        setMessage({ type: "error", text: "Could not read current file state" });
        return;
      }
      const result = await postWrite(freshMtime);
      if (result) applyWriteOutcome(result, false);
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Network error" });
    } finally {
      setSaving(false);
    }
  }, [selected, saving, cwd, postWrite, applyWriteOutcome]);

  const editable = selected ? fileKind(selected.path).editable : false;

  // Mobile back control: clear `?file=` (navigate to the page route) so the
  // master/detail returns to the tree WITHOUT relying on the depth-aware back.
  // Back-navigation is a switch-away-from-dirty case, so it routes through the
  // same discard confirm as a file switch. See change: directory-settings-tree-and-resize.
  const backToTree = useCallback(() => {
    if (dirtyRef.current) {
      setConfirmBack(true);
      return;
    }
    navigate(location);
  }, [navigate, location]);

  const confirmBackDiscard = useCallback(() => {
    setConfirmBack(false);
    setBuffer(loadedContent); // clear dirty so a later reselect won't re-confirm
    navigate(location);
  }, [loadedContent, navigate, location]);

  // Master/detail visibility. Desktop always shows both panes (split). Mobile
  // shows the editor once a file is selected, else the tree.
  const showEditor = isDesktop || selected !== null;
  const showTree = isDesktop || selected === null;

  return (
    <div
      ref={pageRef}
      className="flex flex-col md:flex-row h-full min-h-0"
      data-testid="instructions-page"
    >
      {showTree && (
        <FilePicker
          cwd={cwd}
          selectedPath={selected?.path ?? null}
          onSelect={handleSelect}
          onLoaded={handleCandidatesLoaded}
          width={isDesktop ? treeWidth : undefined}
        />
      )}

      {/* Resize gutter — desktop only (no split/resize on mobile). */}
      {isDesktop && (
        <div
          data-testid="tree-gutter"
          onMouseDown={startResize}
          title={i18nT("common.dragToResize", undefined, "Drag to resize")}
          className="hidden md:block w-1.5 shrink-0 cursor-col-resize hover:bg-blue-500/30 active:bg-blue-500/50"
        />
      )}

      {/* Editor pane */}
      {showEditor && (
        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          {!selected ? (
            <div className="p-4 text-sm text-[var(--text-tertiary)]">
              {i18nT("common.selectAFileToEdit", undefined, "Select a file to edit")}
            </div>
          ) : (
            <InstructionsEditorPane
              selected={selected}
              dirty={dirty}
              loadedMtime={loadedMtime}
              conflict={conflict}
              saving={saving}
              loading={loading}
              readError={readError}
              errorText={message?.type === "error" ? message.text : null}
              buffer={buffer}
              editable={editable}
              onChangeBuffer={setBuffer}
              onReload={reloadFromDisk}
              onOverwrite={overwriteAnyway}
              onDiscard={handleDiscard}
              onSave={handleSave}
              onBack={isDesktop ? undefined : backToTree}
            />
          )}
        </div>
      )}

      {/* Unsaved-changes guard on file switch */}
      <DiscardConfirm
        open={pendingSwitch !== null}
        testId="instructions-switch-confirm"
        fileLabel={selected?.relPath ?? "this file"}
        onConfirm={confirmSwitch}
        onClose={() => setPendingSwitch(null)}
      />

      {/* Unsaved-changes guard on mobile back-to-tree */}
      <DiscardConfirm
        open={confirmBack}
        testId="instructions-back-confirm"
        fileLabel={selected?.relPath ?? "this file"}
        onConfirm={confirmBackDiscard}
        onClose={() => setConfirmBack(false)}
      />
    </div>
  );
}
