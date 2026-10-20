/**
 * Page-level registry of live file-handler instances (framework-free; React
 * binds to it through `useFileHandlerStore`). One record per instance key
 * `sessionId + cwd + normalize(path) + claim`; tabs of the same file+claim in a
 * session share it (dirty state, first-overwrite flag, token).
 *
 * Owns: the cap (`MAX_LIVE_HANDLERS`) with LRU clean-only eviction and the
 * save-or-discard dialog, the non-keepAlive close-when-clean rule, every
 * "discard" guard (`guardDiscard`), `remount`, live plugin-disable
 * reconciliation and the dialog queue the layer renders.
 *
 * See change: add-editor-pane-file-handlers (D5, tasks 5.1–5.3).
 */
import { type FileHandlerClaimMeta, fileHandlerClaimKey } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/file-handler.js";
import type { FileDigest } from "../../../lib/file-digest.js";
import { t } from "../../../lib/i18n/i18n.js";
import { type FileHandlerClaim, fileHandlerInstanceKey } from "./file-handler-claims.js";
import type { AskHandlerDialog, HandlerDialogRequest } from "./file-handler-dialogs.js";
import type { FileHandlerHostApi } from "./file-handler-host.js";

/** Live handler instances per browser page, across plugins and sessions. */
export const MAX_LIVE_HANDLERS = 3;

type HandlerDirtyState = boolean | "unknown";
/** What triggers a discard: selects the wording of the confirm. */
type DiscardKind = "switch-mode" | "close-tab" | "refresh" | "reload" | "discard";

/** What the pane exposes to its instances (own-save tracking, baseline, opening a copy). */
interface FileHandlerBridge {
  sessionId: string;
  cwd: string;
  trackedFileWrite(path: string, body: Record<string, unknown>, send: (signal: AbortSignal) => Promise<Response>): Promise<Response>;
  setBaseline(path: string, digest: FileDigest): void;
  /** Open a workspace file in a tab; `mode` = a file-handler claim key (`<pluginId>/<claimId>`) to select. */
  openFile(path: string, mode?: string): void;
}

interface HandlerInstanceSpec {
  sessionId: string;
  cwd: string;
  /** Tab path as the pane holds it. */
  path: string;
  claim: FileHandlerClaim;
}

/** Immutable view of an instance for rendering. */
export interface HandlerInstance {
  key: string;
  sessionId: string;
  cwd: string;
  path: string;
  claimKey: string;
  pluginId: string;
  claimId: string;
  label: string;
  meta: FileHandlerClaimMeta;
  Component: FileHandlerClaim["Component"];
  dirty: HandlerDirtyState;
  /** Bumps on `remount` — the React key of the handler body. */
  mountNonce: number;
  lastActivated: number;
  /** Set when `snapshot()` refused (e.g. too large); the layer shows a notice instead of the handler. */
  error: { code: string; message: string; limit?: number } | null;
  /** Plugin disabled live while edits are held: the layer shows the re-enable/discard overlay. */
  claimGone: boolean;
  host: FileHandlerHostApi;
}

interface PendingDialog {
  id: number;
  request: HandlerDialogRequest;
}

export interface FileHandlerStoreState {
  instances: readonly HandlerInstance[];
  /** Keys closed to save memory — their tab offers "Resume". */
  evicted: ReadonlySet<string>;
  /** Key of the instance the active pane tab shows, or `null`. */
  visibleKey: string | null;
  /** Pane body element the layer aligns the visible instance to. */
  anchor: HTMLElement | null;
  dialogs: readonly PendingDialog[];
}

interface Rec extends Omit<HandlerInstance, "host"> {
  token: string | null;
  firstOverwriteDone: boolean;
  host: FileHandlerHostApi;
}

export interface FileHandlerStore {
  subscribe(listener: () => void): () => void;
  getState(): FileHandlerStoreState;
  getInstance(key: string): HandlerInstance | undefined;
  setBridge(bridge: FileHandlerBridge | null): void;
  setAnchor(el: HTMLElement | null): void;
  /** Set a callback the layer uses to toast a new copy's path. */
  setNotifier(n: ((sessionId: string, cwd: string, path: string) => void) | null): void;
  /** Create (or touch) the instance for a tab. `false` = refused (cap dialog cancelled). */
  activate(spec: HandlerInstanceSpec): Promise<boolean>;
  /** The pane's active tab shows `key` (or no handler). Applies the non-keepAlive close rule to the previous key. */
  setActive(sessionId: string, key: string | null): void;
  /** The pane for `sessionId` went away: hide, no close policy (instances survive). */
  paneClosed(sessionId: string): void;
  /** Drop this scope's instances whose tab no longer exists (unguarded). */
  syncTabs(sessionId: string, cwd: string, wanted: ReadonlySet<string>): void;
  setDirty(key: string, state: HandlerDirtyState): void;
  /** `FileHandlerProps.openFile` of instance `key`: open `path`, optionally in that plugin's claim `claimId`. */
  openFile(key: string, path: string, claimId?: string): void;
  /** Confirm discarding the instance's edits; `true` when nothing to lose or the user agreed. */
  guardDiscard(key: string, kind: DiscardKind): Promise<boolean>;
  /** Re-mount from a fresh snapshot (call after `guardDiscard`). */
  remount(key: string): void;
  /** Remove the instance (call after `guardDiscard`). */
  discard(key: string): void;
  /** Leave the evicted state so the next `activate` mounts again. */
  resume(key: string): void;
  /** Apply the current enabled-claim key set (live plugin disable/enable). */
  reconcileClaims(enabledKeys: ReadonlySet<string>): void;
  /** True when any instance holds unsaved or unknown state. */
  hasUnsaved(): boolean;
  ask: AskHandlerDialog;
  resolveDialog(id: number, actionId: string | null): void;
}

export function createFileHandlerStore(): FileHandlerStore {
  const recs = new Map<string, Rec>();
  let evicted: ReadonlySet<string> = new Set();
  let active: { sessionId: string; key: string | null } | null = null;
  let anchor: HTMLElement | null = null;
  let dialogs: readonly PendingDialog[] = [];
  const resolvers = new Map<number, (v: string | null) => void>();
  let dialogSeq = 0;
  let clock = 0;
  let bridge: FileHandlerBridge | null = null;
  let notifier: ((sessionId: string, cwd: string, path: string) => void) | null = null;
  const listeners = new Set<() => void>();
  let snapshot: FileHandlerStoreState | null = null;

  const emit = (): void => {
    snapshot = null;
    for (const l of listeners) l();
  };

  const view = (r: Rec): HandlerInstance => {
    const { token: _t, firstOverwriteDone: _f, ...rest } = r;
    return rest;
  };

  const getState = (): FileHandlerStoreState => {
    if (!snapshot) {
      snapshot = {
        instances: [...recs.values()].map(view),
        evicted,
        visibleKey: active?.key && recs.has(active.key) ? active.key : null,
        anchor,
        dialogs,
      };
    }
    return snapshot;
  };

  const ask: AskHandlerDialog = (request) =>
    new Promise<string | null>((resolve) => {
      const id = ++dialogSeq;
      resolvers.set(id, resolve);
      dialogs = [...dialogs, { id, request }];
      emit();
    });

  const resolveDialog = (id: number, actionId: string | null): void => {
    const resolve = resolvers.get(id);
    if (!resolve) return;
    resolvers.delete(id);
    dialogs = dialogs.filter((d) => d.id !== id);
    emit();
    resolve(actionId);
  };

  const bridgeFor = (r: Rec): FileHandlerBridge | null =>
    bridge && bridge.sessionId === r.sessionId && bridge.cwd === r.cwd ? bridge : null;

  function buildRec(spec: HandlerInstanceSpec, key: string): Rec {
    const { claim } = spec;
    const rec: Rec = {
      key,
      sessionId: spec.sessionId,
      cwd: spec.cwd,
      path: spec.path,
      claimKey: claim.key,
      pluginId: claim.pluginId,
      claimId: claim.claimId,
      label: claim.meta.label,
      meta: claim.meta,
      Component: claim.Component,
      dirty: "unknown",
      mountNonce: 0,
      lastActivated: ++clock,
      error: null,
      claimGone: false,
      token: null,
      firstOverwriteDone: false,
      host: undefined as unknown as FileHandlerHostApi,
    };
    // The host (snapshot/save/conflict flow, ~12 KB) loads on the first call, off the entry chunk
    // (mdi-chunk-size cap). See change: add-editor-pane-file-handlers.
    let loaded: Promise<typeof import("./file-handler-host.js")> | null = null;
    const hostModule = () => {
      loaded ??= import("./file-handler-host.js");
      return loaded;
    };
    let innerP: Promise<FileHandlerHostApi> | null = null;
    const innerHost = (): Promise<FileHandlerHostApi> => {
      innerP ??= hostModule().then((m) =>
        m.createFileHandlerHost({
          cwd: spec.cwd,
          path: spec.path,
          claimKey: claim.key,
          meta: claim.meta,
          getToken: () => rec.token,
          setToken: (s) => {
            rec.token = s;
          },
          firstOverwriteDone: () => rec.firstOverwriteDone,
          markFirstOverwriteDone: () => {
            rec.firstOverwriteDone = true;
          },
          getDirty: () => rec.dirty,
          setDirty: (s) => setDirty(key, s),
          ask,
          guardReload: () => guardDiscard(key, "reload"),
          remount: () => remount(key),
          setBaseline: (d) => bridgeFor(rec)?.setBaseline(rec.path, d),
          trackedWrite: (send) => {
            const b = bridgeFor(rec);
            return b ? b.trackedFileWrite(rec.path, { cwd: rec.cwd }, send) : send(new AbortController().signal);
          },
          notifyCopy: (p) => notifier?.(rec.sessionId, rec.cwd, p),
        }),
      );
      return innerP;
    };
    rec.host = {
      async save(bytes, opts) {
        return (await innerHost()).save(bytes, opts);
      },
      async snapshot() {
        const inner = await innerHost();
        const { FileHandlerSnapshotError } = await hostModule();
        try {
          const s = await inner.snapshot();
          if (rec.error) {
            rec.error = null;
            emit();
          }
          return s;
        } catch (err) {
          if (err instanceof FileHandlerSnapshotError && err.code === "too-large") {
            rec.error = { code: err.code, message: err.message, limit: err.limit };
            emit();
          }
          throw err;
        }
      },
    };
    return rec;
  }

  function setDirty(key: string, state: HandlerDirtyState): void {
    const r = recs.get(key);
    if (!r || r.dirty === state) return;
    r.dirty = state;
    emit();
  }

  const discard = (key: string): void => {
    const had = recs.delete(key);
    const wasEvicted = evicted.has(key);
    if (wasEvicted) {
      const next = new Set(evicted);
      next.delete(key);
      evicted = next;
    }
    if (had || wasEvicted) emit();
  };

  const evict = (key: string): void => {
    recs.delete(key);
    evicted = new Set(evicted).add(key);
    emit();
  };

  const labelOf = (r: Rec): string => `${r.path} — ${r.label}`;

  async function guardDiscard(key: string, kind: DiscardKind): Promise<boolean> {
    const r = recs.get(key);
    if (!r || r.dirty === false) return true;
    const unknown = r.dirty === "unknown";
    const what = unknown
      ? t("fileHandler.guardUnknown", { name: r.path }, "{name} may have unsaved edits.")
      : t("fileHandler.guardDirty", { name: r.path }, "{name} has unsaved edits.");
    const consequence: Record<DiscardKind, string> = {
      "switch-mode": t("fileHandler.guardSwitch", undefined, "Switching to another view discards them."),
      "close-tab": t("fileHandler.guardClose", undefined, "Closing this tab discards them."),
      refresh: t("fileHandler.guardRefresh", undefined, "Reloading from disk discards them."),
      reload: t("fileHandler.guardRefresh", undefined, "Reloading from disk discards them."),
      discard: t("fileHandler.guardDiscard", undefined, "Discarding closes the editor and loses them."),
    };
    const choice = await ask({
      title: t("fileHandler.guardTitle", undefined, "Discard unsaved edits?"),
      message: `${what} ${consequence[kind]}`,
      testId: "file-handler-guard-dialog",
      actions: [{ id: "discard", label: t("fileHandler.discardEdits", undefined, "Discard edits"), intent: "danger" }],
    });
    return choice === "discard";
  }

  function remount(key: string): void {
    const r = recs.get(key);
    if (!r) return;
    r.mountNonce += 1;
    r.dirty = "unknown";
    r.token = null;
    r.error = null;
    emit();
  }

  /** Free one slot among `candidates`: evict the LRU clean one, else ask save-or-discard. */
  async function makeRoom(candidates: () => Rec[]): Promise<boolean> {
    const pool = candidates();
    const clean = pool.filter((r) => r.dirty === false).sort((a, b) => a.lastActivated - b.lastActivated)[0];
    if (clean) {
      evict(clean.key);
      return true;
    }
    const choice = await ask({
      title: t("fileHandler.capTitle", undefined, "Too many editors open"),
      message: t(
        "fileHandler.capMessage",
        { max: MAX_LIVE_HANDLERS },
        "At most {max} editors stay open at once and all of them have unsaved edits. Save one of them first, or discard one to continue.",
      ),
      list: pool.map(labelOf),
      testId: "file-handler-cap-dialog",
      actions: pool.map((r) => ({
        id: r.key,
        label: t("fileHandler.discardNamed", { name: r.path }, "Discard {name}"),
        intent: "danger" as const,
      })),
    });
    if (!choice) return false;
    discard(choice);
    return true;
  }

  let chain: Promise<unknown> = Promise.resolve();

  async function doActivate(spec: HandlerInstanceSpec): Promise<boolean> {
    const key = fileHandlerInstanceKey(spec.sessionId, spec.cwd, spec.path, spec.claim.key);
    const existing = recs.get(key);
    if (existing) {
      existing.lastActivated = ++clock;
      emit();
      return true;
    }
    if (evicted.has(key)) return true; // the tab shows "Resume"
    const max = spec.claim.meta.keepAlive?.max;
    while (max !== undefined && [...recs.values()].filter((r) => r.claimKey === spec.claim.key).length >= max) {
      if (!(await makeRoom(() => [...recs.values()].filter((r) => r.claimKey === spec.claim.key)))) return false;
    }
    while (recs.size >= MAX_LIVE_HANDLERS) {
      if (!(await makeRoom(() => [...recs.values()]))) return false;
    }
    const rec = buildRec(spec, key);
    recs.set(key, rec);
    emit();
    return true;
  }

  return {
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getState,
    getInstance: (key) => {
      const r = recs.get(key);
      return r ? view(r) : undefined;
    },
    setBridge(b) {
      bridge = b;
    },
    openFile(key, path, claimId) {
      const r = recs.get(key);
      if (!r) return;
      bridgeFor(r)?.openFile(path, claimId ? fileHandlerClaimKey(r.pluginId, claimId) : undefined);
    },
    setAnchor(el) {
      if (anchor === el) return;
      anchor = el;
      emit();
    },
    setNotifier(n) {
      notifier = n;
    },
    activate(spec) {
      const run = chain.then(() => doActivate(spec));
      chain = run.catch(() => undefined);
      return run;
    },
    setActive(sessionId, key) {
      const prev = active;
      active = { sessionId, key };
      const prevKey = prev && prev.sessionId === sessionId && prev.key !== key ? prev.key : null;
      const r = prevKey ? recs.get(prevKey) : undefined;
      // Non-keepAlive instances close when their tab goes inactive, unless unsaved/unknown.
      if (r && !r.meta.keepAlive && r.dirty === false) recs.delete(r.key);
      if (r || prev?.key !== key || prev?.sessionId !== sessionId) emit();
    },
    paneClosed(sessionId) {
      if (active?.sessionId !== sessionId) return;
      active = null;
      emit();
    },
    syncTabs(sessionId, cwd, wanted) {
      let changed = false;
      for (const r of [...recs.values()]) {
        if (r.sessionId === sessionId && r.cwd === cwd && !wanted.has(r.key)) {
          recs.delete(r.key);
          changed = true;
        }
      }
      if ([...evicted].some((k) => k.startsWith(`${sessionId}\u0000${cwd}\u0000`) && !wanted.has(k))) {
        evicted = new Set([...evicted].filter((k) => !k.startsWith(`${sessionId}\u0000${cwd}\u0000`) || wanted.has(k)));
        changed = true;
      }
      if (changed) emit();
    },
    setDirty,
    guardDiscard,
    remount,
    discard,
    resume(key) {
      if (!evicted.has(key)) return;
      const next = new Set(evicted);
      next.delete(key);
      evicted = next;
      emit();
    },
    reconcileClaims(enabledKeys) {
      let changed = false;
      for (const r of [...recs.values()]) {
        const gone = !enabledKeys.has(r.claimKey);
        if (gone && r.dirty === false) {
          recs.delete(r.key);
          changed = true;
        } else if (r.claimGone !== gone) {
          r.claimGone = gone;
          changed = true;
        }
      }
      if (changed) emit();
    },
    hasUnsaved: () => [...recs.values()].some((r) => r.dirty !== false),
    ask,
    resolveDialog,
  };
}

/** Process-wide store (one per browser page). Tests build their own with `createFileHandlerStore`. */
export const fileHandlerStore: FileHandlerStore = createFileHandlerStore();
