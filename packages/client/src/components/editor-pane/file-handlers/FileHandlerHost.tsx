/**
 * Host for ONE plugin file-handler instance: renders the claim component with
 * the `FileHandlerProps` contract and implements the core services behind it —
 * `snapshot()` (digest bracket), `save()` (first-overwrite notice, own-save
 * tracking via `trackedFileWrite`, conflict dialog, status → reason mapping) and
 * `setDirty()`. The handler only sees the outcome.
 *
 * Mounted by `FileHandlerLayer` (keyed by `inst.nonce`, so a re-mount is a fresh
 * snapshot). See change: add-editor-pane-file-handlers (D3).
 */
import { CurrentPluginLayer, SlotErrorBoundary, useShellSessionOrNull } from "@blackbelt-technology/dashboard-plugin-runtime";
import type { FileHandlerProps } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/slot-props.js";
import { Suspense, useMemo, useRef } from "react";
import { t as i18nT } from "../../../lib/i18n/i18n.js";
import { type SplitWorkspaceContextValue, useOptionalSplitWorkspace } from "../../split/SplitWorkspaceContext.js";
import { passthroughWrite } from "../../split/use-changed-on-disk.js";
import {
  type BinaryWriteResult,
  classifyWrite,
  FileHandlerError,
  fetchDigest,
  postWriteBinary,
  type SaveFailure,
  type SaveFailureReason,
  type SaveSuccess,
  takeSnapshot,
  type WriteOutcome,
} from "./file-handler-io.js";
import { isGuarded } from "./file-handler-logic.js";
import { type FileHandlerStore, fileHandlerStore, type HandlerInstance } from "./file-handler-store.js";

type SaveResult = SaveSuccess | SaveFailure;

const fail = (reason: SaveFailureReason, message: string): SaveFailure => ({ ok: false, reason, message });

interface HostDeps {
  store: FileHandlerStore;
  inst: () => HandlerInstance;
  ws: () => SplitWorkspaceContextValue | null;
}

/** The `snapshot` / `save` / `setDirty` triple for one mounted instance. */
export function createHostApi({ store, inst, ws }: HostDeps): Pick<FileHandlerProps, "snapshot" | "save" | "setDirty"> {
  // The conflict token: sha1 of the last snapshot or successful overwrite.
  let token: string | null = null;
  let saving = false;
  const t = (key: string, fallback: string) => i18nT(key, undefined, fallback);

  /** Own-save tracking only applies while this instance's session is the one the split provider serves. */
  const tracked = <T extends BinaryWriteResult>(run: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    const i = inst();
    const w = ws();
    return w && w.sessionId === i.sessionId ? w.trackedFileWrite(i.path, run) : passthroughWrite(run);
  };

  const saveCopy = async (bytes: ArrayBuffer): Promise<SaveResult> => {
    const i = inst();
    // Untracked on purpose: the copy lands on a DIFFERENT path, so it must not move this tab's baseline.
    const r = await postWriteBinary({ cwd: i.cwd, path: i.path, mode: "copy", claim: i.claim.ref, bytes });
    const o = classifyWrite("copy", r, i.path);
    if (o.kind === "ok") {
      store.notifyCopy(i.sessionId, o.path);
      return { ok: true, path: o.path, mtime: o.mtime, sha1: o.sha1 };
    }
    return o.kind === "fail" ? fail(o.reason, o.message) : fail("rejected", t("fileHandler.saveRefused", "Save refused"));
  };

  /** Reload from disk: confirm when dirty (`undefined` = declined → back to the dialog), then remount. */
  const reload = async (): Promise<SaveFailure | undefined> => {
    const i = inst();
    if (!(await store.guard(i.key, "reload"))) return undefined;
    store.remount(i.key);
    return fail("cancelled", t("fileHandler.reloaded", "Reloaded from disk"));
  };

  /** Overwrite anyway: re-read the digest so the retry replaces whatever is on disk NOW. */
  const reread = async (): Promise<{ retry: string } | SaveFailure> => {
    const i = inst();
    try {
      return { retry: (await fetchDigest(i.cwd, i.path)).sha1 };
    } catch (e) {
      return fail("conflict-unresolved", e instanceof Error ? e.message : String(e));
    }
  };

  /** The conflict dialog loop: `retry` = resend with a re-read token; else the final save result. */
  const resolveConflict = async (gone: boolean, bytes: ArrayBuffer): Promise<{ retry: string } | SaveResult> => {
    const i = inst();
    for (;;) {
      const choice = await store.ask<"reload" | "copy" | "overwrite" | "cancel">(
        { kind: "conflict", label: i.claim.label, gone, dirty: isGuarded(inst().dirty) },
        "cancel",
        i.key,
      );
      if (choice === "copy") return saveCopy(bytes);
      if (choice === "overwrite") return reread();
      if (choice === "reload") {
        const r = await reload();
        if (r) return r;
        continue;
      }
      return fail("cancelled", t("fileHandler.saveCancelled", "Save cancelled"));
    }
  };

  /** One tracked overwrite attempt against the conflict token `sha1`. */
  const attemptOverwrite = async (bytes: ArrayBuffer, sha1: string): Promise<WriteOutcome> => {
    const i = inst();
    const r = await tracked((signal) =>
      postWriteBinary({ cwd: i.cwd, path: i.path, mode: "overwrite", claim: i.claim.ref, expectSha1: sha1, bytes }, signal),
    );
    return classifyWrite("overwrite", r, i.path);
  };

  /** A successful overwrite moves the conflict token to the saved sha1. */
  const adopt = (o: Extract<WriteOutcome, { kind: "ok" }>): SaveSuccess => {
    if (o.sha1) token = o.sha1;
    return { ok: true, path: o.path, mtime: o.mtime, sha1: o.sha1 };
  };

  const saveOverwrite = async (bytes: ArrayBuffer): Promise<SaveResult> => {
    let expect = token;
    if (!expect) return fail("rejected", t("fileHandler.noSnapshot", "Take a snapshot before saving"));
    for (;;) {
      const o = await attemptOverwrite(bytes, expect);
      if (o.kind === "fail") return fail(o.reason, o.message);
      if (o.kind === "ok") return adopt(o);
      const res = await resolveConflict(o.gone, bytes);
      if (!("retry" in res)) return res;
      expect = res.retry;
    }
  };

  /** First overwrite per instance with a `firstOverwriteNotice`: the notice dialog. `go` = proceed. */
  const firstOverwrite = async (bytes: ArrayBuffer): Promise<SaveResult | "go"> => {
    const i = inst();
    if (!i.claim.firstOverwriteNotice || i.firstOverwriteDone) return "go";
    const c = await store.ask<"overwrite" | "copy" | "cancel">(
      { kind: "first-overwrite", label: i.claim.label, notice: i.claim.firstOverwriteNotice },
      "cancel",
      i.key,
    );
    if (c === "copy") return saveCopy(bytes);
    if (c === "cancel") return fail("cancelled", t("fileHandler.saveCancelled", "Save cancelled"));
    store.markFirstOverwriteDone(i.key);
    return "go";
  };

  const doSave = async (bytes: ArrayBuffer, target: "overwrite" | "copy"): Promise<SaveResult> => {
    if (bytes.byteLength > inst().claim.maxBytes) return fail("too-large", t("fileHandler.tooLarge", "File exceeds the size limit"));
    if (target === "copy") return saveCopy(bytes);
    const first = await firstOverwrite(bytes);
    return first === "go" ? saveOverwrite(bytes) : first;
  };

  const save: FileHandlerProps["save"] = async (bytes, opts) => {
    if (saving) return fail("busy", t("fileHandler.saveInProgress", "A save is already in progress"));
    saving = true;
    try {
      return await doSave(bytes, opts.target);
    } catch (e) {
      return fail("rejected", e instanceof Error ? e.message : String(e));
    } finally {
      saving = false;
    }
  };

  const snapshot: FileHandlerProps["snapshot"] = async () => {
    const i = inst();
    try {
      const snap = await takeSnapshot(i.cwd, i.path, i.claim.maxBytes);
      token = snap.sha1;
      const w = ws();
      if (w && w.sessionId === i.sessionId) w.setBaseline(i.path, snap.sha1);
      return snap;
    } catch (e) {
      if (e instanceof FileHandlerError && e.reason === "too-large") store.setUnavailable(i.key, i.claim.maxBytes);
      throw e;
    }
  };

  const setDirty: FileHandlerProps["setDirty"] = (state) => {
    if (state === true || state === false || state === "unknown") store.setDirty(inst().key, state);
  };

  return { snapshot, save, setDirty };
}

export function FileHandlerHost({ inst, isActive, store = fileHandlerStore }: { inst: HandlerInstance; isActive: boolean; store?: FileHandlerStore }) {
  const ws = useOptionalSplitWorkspace();
  const session = useShellSessionOrNull(inst.sessionId);
  const wsRef = useRef(ws);
  wsRef.current = ws;
  const instRef = useRef(inst);
  instRef.current = inst;
  // One API per mount (the layer keys the host by `inst.nonce`): token + save lock live in its closure.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refs are read lazily; store is stable
  const api = useMemo(() => createHostApi({ store, inst: () => instRef.current, ws: () => wsRef.current }), []);
  const { Component, pluginId } = inst.claim;
  const props: FileHandlerProps = {
    cwd: inst.cwd,
    path: inst.path,
    session: session ?? null,
    isActive,
    context: { pluginId },
    ...api,
  };
  return (
    <SlotErrorBoundary pluginId={pluginId} slotId="editor-pane-file-handler">
      <Suspense fallback={null}>
        <CurrentPluginLayer pluginId={pluginId}>
          <Component {...props} />
        </CurrentPluginLayer>
      </Suspense>
    </SlotErrorBoundary>
  );
}
