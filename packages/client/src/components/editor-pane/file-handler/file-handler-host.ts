/**
 * `FileHandlerHost` — the core-owned half of a handler instance's props:
 * `snapshot()` (consistent bytes + sha1 token via a digest bracket) and
 * `save()` (first-overwrite notice → `POST /api/file/write-binary` wrapped in
 * the pane's own-save tracker → conflict dialog). The handler only sees the
 * outcome. Pure of React: everything stateful is injected.
 *
 * See change: add-editor-pane-file-handlers (D3, tasks 4.1/4.2).
 */
import type { FileHandlerClaimMeta } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/file-handler.js";
import { HANDLER_MAX_BYTES } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/file-handler.js";
import type {
  FileHandlerProps,
  FileHandlerSaveFailureReason,
  FileHandlerSaveResult,
  FileHandlerSnapshot,
} from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/slot-props.js";
import { getApiBase } from "../../../lib/api/api-context.js";
import { type FileDigest, fetchFileDigest } from "../../../lib/file-digest.js";
import { t } from "../../../lib/i18n/i18n.js";
import { sha1Hex } from "../../../lib/sha1.js";
import type { AskHandlerDialog } from "./file-handler-dialogs.js";

/** Snapshot attempts before giving up on a file that keeps changing. */
const SNAPSHOT_MAX_ATTEMPTS = 3;

export type SnapshotErrorCode = "too-large" | "inconsistent" | "unreadable";

/** Why `snapshot()` rejected. `limit` is the claim's byte limit for `too-large`. */
export class FileHandlerSnapshotError extends Error {
  readonly code: SnapshotErrorCode;
  readonly limit?: number;
  constructor(code: SnapshotErrorCode, message: string, limit?: number) {
    super(message);
    this.name = "FileHandlerSnapshotError";
    this.code = code;
    this.limit = limit;
  }
}

export interface FileHandlerHostDeps {
  cwd: string;
  /** Tab path as the pane holds it (the changed-on-disk baseline key). */
  path: string;
  claimKey: string;
  meta: FileHandlerClaimMeta;
  /** Instance state (shared across the instance's tabs). */
  getToken(): string | null;
  setToken(sha1: string | null): void;
  firstOverwriteDone(): boolean;
  markFirstOverwriteDone(): void;
  getDirty(): boolean | "unknown";
  setDirty(state: boolean | "unknown"): void;
  ask: AskHandlerDialog;
  /** Confirm discarding the handler's edits before a reload (resolves true when nothing to lose). */
  guardReload(): Promise<boolean>;
  /** Re-mount the handler from a fresh snapshot. */
  remount(): void;
  /** Set the tab's changed-on-disk baseline to the snapshot's version. */
  setBaseline(digest: FileDigest): void;
  /** Run `send` as the pane's tracked own-save (falls back to just running it). */
  trackedWrite(send: (signal: AbortSignal) => Promise<Response>): Promise<Response>;
  /** Toast the new copy's path with an "Open" action. */
  notifyCopy(path: string): void;
}

export interface FileHandlerHostApi {
  snapshot(): Promise<FileHandlerSnapshot>;
  save: FileHandlerProps["save"];
}

const fail = (reason: FileHandlerSaveFailureReason, message: string): FileHandlerSaveResult => ({ ok: false, reason, message });

interface WriteOutcome {
  status: number;
  data?: { path: string; mtime: number; sha1: string };
  error?: string;
  /** Conflict body: disk version (absent when the file is gone). */
  sha1?: string;
}

async function parseWrite(res: Response): Promise<WriteOutcome> {
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  const data = body?.success ? (body.data as WriteOutcome["data"]) : undefined;
  return {
    status: res.status,
    data,
    error: typeof body?.error === "string" ? body.error : undefined,
    sha1: typeof body?.sha1 === "string" ? body.sha1 : undefined,
  };
}

export function createFileHandlerHost(deps: FileHandlerHostDeps): FileHandlerHostApi {
  const { cwd, path, claimKey, meta } = deps;
  const maxBytes = meta.maxBytes ?? HANDLER_MAX_BYTES;
  let saving = false;

  const q = (extra: Record<string, string>) =>
    new URLSearchParams({ cwd, path, ...extra }).toString();

  const unreadable = () =>
    new FileHandlerSnapshotError("unreadable", t("fileHandler.snapshotUnreadable", undefined, "The file could not be read."));

  /** One digest-bracket attempt; `null` = the file changed while reading (retry). */
  async function readOnce(): Promise<FileHandlerSnapshot | null> {
    // 1. digest (size gate BEFORE any content is fetched)
    const d1 = await fetchFileDigest(cwd, path, "baseline");
    if (!d1) throw unreadable();
    if (d1.size > maxBytes) throw tooLarge(maxBytes);
    // 2. bytes (never the cached response)
    const res = await fetch(`${getApiBase()}/api/file/raw?${q({})}`, { cache: "no-store" });
    if (!res.ok) throw unreadable();
    const bytes = await res.arrayBuffer();
    if (bytes.byteLength > maxBytes) throw tooLarge(maxBytes);
    // 3. digest again; mtime-only changes are tolerated (only sha1 is compared)
    const d2 = await fetchFileDigest(cwd, path, "baseline");
    if (!d2) throw unreadable();
    if (d1.sha1 !== d2.sha1 || (await sha1Hex(bytes)) !== d2.sha1) return null;
    return { bytes, size: bytes.byteLength, mtime: d2.mtime, sha1: d2.sha1 };
  }

  async function snapshot(): Promise<FileHandlerSnapshot> {
    for (let attempt = 1; attempt <= SNAPSHOT_MAX_ATTEMPTS; attempt++) {
      const snap = await readOnce();
      if (!snap) continue;
      deps.setToken(snap.sha1);
      deps.setBaseline({ sha1: snap.sha1, size: snap.size, mtime: snap.mtime });
      return snap;
    }
    throw new FileHandlerSnapshotError(
      "inconsistent",
      t("fileHandler.snapshotInconsistent", undefined, "The file keeps changing on disk; try again."),
    );
  }

  const tooLarge = (limit: number) =>
    new FileHandlerSnapshotError(
      "too-large",
      t("fileHandler.tooLarge", { limit: formatBytes(limit) }, "This file is larger than the {limit} limit of this editor."),
      limit,
    );

  const post = (mode: "overwrite" | "copy", bytes: ArrayBuffer, expectSha1: string | null, signal: AbortSignal, siblingExt?: string): Promise<Response> =>
    fetch(`${getApiBase()}/api/file/write-binary?${q({ mode, claim: claimKey, ...(expectSha1 ? { expectSha1 } : {}), ...(siblingExt ? { siblingExt } : {}) })}`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: bytes,
      signal,
    });

  function mapFailure(o: WriteOutcome): FileHandlerSaveResult {
    const message = o.error ?? `HTTP ${o.status}`;
    if (o.status === 413) return fail("too-large", message);
    if (o.status === 503) return fail("busy", message);
    return fail("rejected", message);
  }

  async function writeCopy(bytes: ArrayBuffer): Promise<FileHandlerSaveResult> {
    let res: Response;
    try {
      res = await post("copy", bytes, null, new AbortController().signal);
    } catch (err) {
      return fail("rejected", err instanceof Error ? err.message : String(err));
    }
    const o = await parseWrite(res);
    if (!o.data) return mapFailure(o);
    deps.notifyCopy(o.data.path);
    // The tab stays bound to the original file: token + baseline are untouched.
    return { ok: true, path: o.data.path, mtime: o.data.mtime, sha1: o.data.sha1 };
  }

  /** Native-format sibling (D6): `mode=copy&siblingExt`; the tab stays bound to its own file. */
  async function writeSibling(bytes: ArrayBuffer, ext: string): Promise<FileHandlerSaveResult> {
    let res: Response;
    try {
      res = await post("copy", bytes, null, new AbortController().signal, ext);
    } catch (err) {
      return fail("rejected", err instanceof Error ? err.message : String(err));
    }
    const o = await parseWrite(res);
    if (!o.data) return o.status === 409 ? fail("conflict-unresolved", o.error ?? "no free name") : mapFailure(o);
    deps.notifyCopy(o.data.path);
    return { ok: true, path: o.data.path, mtime: o.data.mtime, sha1: o.data.sha1 };
  }

  async function writeOverwrite(bytes: ArrayBuffer, expectSha1: string): Promise<WriteOutcome | FileHandlerSaveResult> {
    try {
      const res = await deps.trackedWrite((signal) => post("overwrite", bytes, expectSha1, signal));
      return await parseWrite(res);
    } catch (err) {
      return fail("rejected", err instanceof Error ? err.message : String(err));
    }
  }

  /** The conflict dialog; Reload and Overwrite anyway are offered only while the file still exists. */
  const askConflict = (gone: boolean): Promise<string | null> =>
    deps.ask({
      title: t("fileHandler.conflictTitle", undefined, "File changed on disk"),
      message: gone
        ? t("fileHandler.conflictGone", undefined, "This file no longer exists on disk. Your edits are still open here.")
        : t(
            "fileHandler.conflictMessage",
            undefined,
            "This file was changed on disk after you opened it (for example by the agent). Your edits are still open here. Overwrite anyway replaces the version on disk; that change will be lost.",
          ),
      testId: "file-handler-conflict-dialog",
      actions: [
        ...(gone ? [] : [{ id: "reload", label: t("fileHandler.reload", undefined, "Reload from disk"), intent: "neutral" as const }]),
        { id: "copy", label: t("fileHandler.saveAsCopy", undefined, "Save as copy"), intent: "primary" as const },
        ...(gone ? [] : [{ id: "overwrite", label: t("fileHandler.overwriteAnyway", undefined, "Overwrite anyway"), intent: "danger" as const }]),
      ],
    });

  const askFirstOverwrite = (notice: string): Promise<string | null> =>
    deps.ask({
      title: t("fileHandler.firstOverwriteTitle", undefined, "Overwrite the original file?"),
      message: notice,
      testId: "file-handler-first-overwrite-dialog",
      actions: [
        { id: "overwrite", label: t("fileHandler.overwrite", undefined, "Overwrite"), intent: "danger" },
        { id: "copy", label: t("fileHandler.saveAsCopy", undefined, "Save as copy"), intent: "primary" },
      ],
    });

  const isResult = (v: WriteOutcome | FileHandlerSaveResult): v is FileHandlerSaveResult => "ok" in v;

  /**
   * The user's answer to a conflict: a result to return, or a fresh `expectSha1`
   * to retry with (Overwrite anyway re-reads the digest, replacing whatever is on disk NOW).
   */
  async function resolveConflict(bytes: ArrayBuffer, gone: boolean): Promise<FileHandlerSaveResult | string> {
    const choice = await askConflict(gone);
    if (choice === "reload") {
      if (!(await deps.guardReload())) return fail("cancelled", "cancelled");
      deps.remount();
      return fail("cancelled", "reloaded from disk");
    }
    if (choice === "copy") return writeCopy(bytes);
    if (choice !== "overwrite") return fail("cancelled", "cancelled");
    const fresh = await fetchFileDigest(cwd, path, "baseline").catch(() => null);
    return fresh ? fresh.sha1 : fail("conflict-unresolved", unreadable().message);
  }

  /** Overwrite loop: write → on 409 the conflict dialog → (retry with a fresh token). */
  async function overwrite(bytes: ArrayBuffer): Promise<FileHandlerSaveResult> {
    let expect = deps.getToken();
    if (!expect) return fail("rejected", t("fileHandler.noSnapshot", undefined, "The file was never read; nothing to compare against."));
    for (;;) {
      const r = await writeOverwrite(bytes, expect);
      if (isResult(r)) return r;
      if (r.data) {
        deps.setToken(r.data.sha1);
        return { ok: true, path: r.data.path, mtime: r.data.mtime, sha1: r.data.sha1 };
      }
      if (r.status !== 409) return mapFailure(r);
      const next = await resolveConflict(bytes, r.sha1 === undefined);
      if (typeof next !== "string") return next;
      expect = next;
    }
  }

  /** `overwrite` | `copy`, after the once-per-instance first-overwrite notice; `null` = cancelled. */
  async function pickTarget(requested: "overwrite" | "copy"): Promise<"overwrite" | "copy" | null> {
    if (requested !== "overwrite" || !meta.firstOverwriteNotice || deps.firstOverwriteDone()) return requested;
    const choice = await askFirstOverwrite(meta.firstOverwriteNotice);
    if (choice === "overwrite") deps.markFirstOverwriteDone();
    return choice === "overwrite" || choice === "copy" ? choice : null;
  }

  async function save(
    bytes: ArrayBuffer,
    opts: { target: "overwrite" | "copy" } | { target: "sibling"; ext: string },
  ): Promise<FileHandlerSaveResult> {
    if (bytes.byteLength > maxBytes) return fail("too-large", tooLarge(maxBytes).message);
    if (saving) return fail("busy", t("fileHandler.saveInFlight", undefined, "A save is already in progress."));
    saving = true;
    try {
      // A sibling never overwrites: no first-overwrite notice, no conflict token. Only declared extensions.
      if (opts.target === "sibling") {
        if (!(meta.siblingExtensions ?? []).includes(opts.ext)) return fail("rejected", `${opts.ext} is not a sibling extension of this claim`);
        return await writeSibling(bytes, opts.ext);
      }
      const target = await pickTarget(opts.target);
      if (!target) return fail("cancelled", "cancelled");
      return target === "copy" ? await writeCopy(bytes) : await overwrite(bytes);
    } finally {
      saving = false;
    }
  }

  return { snapshot, save };
}

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${Math.round(n / (1024 * 1024))} MiB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KiB`;
  return `${n} B`;
}
