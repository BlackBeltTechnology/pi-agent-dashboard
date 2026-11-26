/**
 * Page-level registry of unsaved built-in editor buffers (`MarkdownViewer`,
 * `EditablePreviewTab`). Framework-free module singleton, mirroring
 * `file-handler/file-handler-store.ts` — NOT a React context, because the
 * session-switch guard (`handleSelect`) sits above both split providers and
 * must also see folder-pane buffers.
 *
 * Owns: the dirty registry keyed `unsavedKey(sessionId, tabPath)`, the
 * `beforeunload` arming (one listener, armed while any buffer is dirty), and
 * `confirmLeave(keys?)` — ONE Save / Discard / Cancel dialog listing every dirty
 * tab in scope (rendered by `UnsavedChangesHost`). An overlapping leave joins
 * the open dialog's verdict; Save runs the saves in order and resolves `true`
 * only if every one succeeds (no rollback of earlier saves).
 *
 * See change: fix-file-link-editor-routing (D3, G2, G5).
 */

/** Registry key: one store serves session panes and folder panes. */
export const unsavedKey = (sessionOrFolderKey: string, tabPath: string): string => `${sessionOrFolderKey}\u0000${tabPath}`;

export interface UnsavedEntry {
  /** Short name shown in the dialog list. */
  label: string;
  dirty: boolean;
  /** Write the buffer. Resolves `true` on success; on failure the viewer shows its own error / banner and resolves `false`. */
  save: () => Promise<boolean>;
  /** Drop the buffer (reset to the loaded content). */
  discard?: () => void;
}

interface UnsavedDialogItem {
  key: string;
  label: string;
}

interface UnsavedDialogState {
  id: number;
  items: readonly UnsavedDialogItem[];
  /** A Save is in flight (buttons disabled). */
  saving: boolean;
}

interface UnsavedStoreState {
  dialog: UnsavedDialogState | null;
}

type UnsavedVerdict = "save" | "discard" | "cancel";

export interface UnsavedStore {
  subscribe(listener: () => void): () => void;
  getState(): UnsavedStoreState;
  /** Register / replace the entry for `key`. Returns an unregister fn (removes only if still current). */
  registerUnsaved(key: string, entry: UnsavedEntry): () => void;
  unregisterUnsaved(key: string): void;
  /** True when any entry (or any of `keys`) is dirty. */
  hasUnsaved(keys?: readonly string[]): boolean;
  /** Dirty entries in scope, in registration order. */
  dirtyItems(keys?: readonly string[]): UnsavedDialogItem[];
  /** Ask before leaving; `true` = nothing to lose or the user saved / discarded. */
  confirmLeave(keys?: readonly string[]): Promise<boolean>;
  resolveDialog(verdict: UnsavedVerdict): void;
}

export function createUnsavedStore(): UnsavedStore {
  const entries = new Map<string, UnsavedEntry>();
  const listeners = new Set<() => void>();
  let state: UnsavedStoreState = { dialog: null };
  let armed = false;
  let dialogSeq = 0;
  let open: { id: number; keys: ReadonlySet<string>; promise: Promise<boolean>; resolve: (v: boolean) => void } | null = null;

  const emit = (): void => {
    for (const l of [...listeners]) l();
  };
  const setState = (next: UnsavedStoreState): void => {
    state = next;
    emit();
  };

  const onBeforeUnload = (e: BeforeUnloadEvent): void => {
    if (![...entries.values()].some((x) => x.dirty)) return;
    e.preventDefault();
    e.returnValue = "";
  };
  /** Arm / disarm the page-unload warning to match "any buffer dirty". */
  const syncArming = (): void => {
    const want = [...entries.values()].some((x) => x.dirty);
    if (want === armed || typeof window === "undefined") return;
    armed = want;
    if (want) window.addEventListener("beforeunload", onBeforeUnload);
    else window.removeEventListener("beforeunload", onBeforeUnload);
  };

  const dirtyItems = (keys?: readonly string[]): UnsavedDialogItem[] => {
    const scope = keys ? new Set(keys) : null;
    const out: UnsavedDialogItem[] = [];
    for (const [key, e] of entries) if (e.dirty && (!scope || scope.has(key))) out.push({ key, label: e.label });
    return out;
  };

  /** Publish only when the dirty SET changed (not on every keystroke). */
  const put = (key: string, entry: UnsavedEntry | null): void => {
    const was = entries.get(key);
    if (entry) entries.set(key, entry);
    else entries.delete(key);
    if (!!was?.dirty === !!entry?.dirty) return;
    syncArming();
    emit();
  };

  function registerUnsaved(key: string, entry: UnsavedEntry): () => void {
    put(key, entry);
    return () => {
      if (entries.get(key) === entry) put(key, null);
    };
  }

  function finish(verdict: boolean): void {
    const cur = open;
    open = null;
    setState({ dialog: null });
    cur?.resolve(verdict);
  }

  async function runSave(items: readonly UnsavedDialogItem[]): Promise<void> {
    setState({ dialog: state.dialog ? { ...state.dialog, saving: true } : null });
    for (const it of items) {
      const e = entries.get(it.key);
      if (!e?.dirty) continue;
      let ok = false;
      try {
        ok = await e.save();
      } catch {
        ok = false;
      }
      if (!ok) return finish(false);
    }
    finish(true);
  }

  const resolveDialog = (verdict: UnsavedVerdict): void => {
    const d = state.dialog;
    if (!open || !d || d.saving) return;
    if (verdict === "cancel") return finish(false);
    if (verdict === "discard") {
      for (const it of d.items) entries.get(it.key)?.discard?.();
      return finish(true);
    }
    void runSave(d.items);
  };

  async function confirmLeave(keys?: readonly string[]): Promise<boolean> {
    // An open dialog covering every dirty tab of this leave answers it too (G2: never stack).
    // A leave with a tab the open dialog does not list waits for it, then asks about its own scope.
    while (open) {
      const items = dirtyItems(keys);
      if (items.length === 0) return true;
      if (items.every((i) => open?.keys.has(i.key))) return open.promise;
      await open.promise;
    }
    const items = dirtyItems(keys);
    if (items.length === 0) return true;
    let resolve!: (v: boolean) => void;
    const promise = new Promise<boolean>((r) => {
      resolve = r;
    });
    const id = ++dialogSeq;
    open = { id, keys: new Set(items.map((i) => i.key)), promise, resolve };
    setState({ dialog: { id, items, saving: false } });
    return promise;
  }

  return {
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getState: () => state,
    registerUnsaved,
    unregisterUnsaved: (key) => put(key, null),
    hasUnsaved: (keys) => dirtyItems(keys).length > 0,
    dirtyItems,
    confirmLeave,
    resolveDialog,
  };
}

/** Process-wide store (one per browser page). Tests build their own with `createUnsavedStore`. */
export const unsavedStore: UnsavedStore = createUnsavedStore();

export const registerUnsaved = unsavedStore.registerUnsaved;
export const unregisterUnsaved = unsavedStore.unregisterUnsaved;
export const confirmLeave = unsavedStore.confirmLeave;
