/**
 * `editor-pane-file-handler` slot rules shared by the manifest validator, the
 * server write route and the client host/switcher.
 *
 * See change: add-editor-pane-file-handlers (D1, D4).
 */

/** Core ceiling for a handler snapshot / `write-binary` body: 128 MiB. */
export const HANDLER_MAX_BYTES = 128 * 1024 * 1024;

/** Claim id: `^[a-z][a-z0-9-]{0,31}$`, unique within a plugin. */
export const FILE_HANDLER_ID_RE = /^[a-z][a-z0-9-]{0,31}$/;

/** One claimed extension: lower-case, single segment, leading dot, no wildcard. */
export const FILE_HANDLER_EXT_RE = /^\.[a-z0-9][a-z0-9+-]{0,15}$/;

/** `copySuffix`: `^[a-z][a-z0-9-]{1,31}$`. */
export const FILE_HANDLER_COPY_SUFFIX_RE = /^[a-z][a-z0-9-]{1,31}$/;

/** Max `label` / `firstOverwriteNotice` lengths and `keepAlive.max` bounds. */
export const FILE_HANDLER_LABEL_MAX = 40;
export const FILE_HANDLER_NOTICE_MAX = 300;
export const FILE_HANDLER_KEEPALIVE_MAX = 3;

/** Wire reference of a claim: `<pluginId>/<claimId>` (the `claim` query param, `handlerMode` tab state). */
export function fileHandlerClaimKey(pluginId: string, claimId: string): string {
  return `${pluginId}/${claimId}`;
}

/** Inverse of {@link fileHandlerClaimKey}; `null` unless exactly `<non-empty>/<non-empty>`. */
export function parseFileHandlerClaimKey(key: string): { pluginId: string; claimId: string } | null {
  if (typeof key !== "string") return null;
  const parts = key.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { pluginId: parts[0], claimId: parts[1] };
}

/**
 * Runtime metadata of an `editor-pane-file-handler` claim, emitted into the
 * generated client registry as `ClaimEntry.fileHandler` (the validated manifest
 * fields; the component itself is `ClaimEntry.Component`).
 */
export interface FileHandlerClaimMeta {
  id: string;
  extensions: string[];
  mode: "preview" | "edit";
  label: string;
  keepAlive?: { max: number };
  maxBytes?: number;
  firstOverwriteNotice?: string;
  copySuffix?: string;
  /** Edit mode: native sibling extensions (`write-binary?mode=copy&siblingExt=`). See change: extend-craft-web-to-all-apps (D6). */
  siblingExtensions?: string[];
  validator?: boolean;
}

/** `write-binary` query modes. */
export type FileWriteBinaryMode = "overwrite" | "copy";

/** 200 body of `POST /api/file/write-binary`. */
export interface FileWriteBinaryResult {
  /** Cwd-relative path written (the copy's path for `mode=copy`). */
  path: string;
  mtime: number;
  sha1: string;
}

/** 409 body of `POST /api/file/write-binary` (overwrite conflict). `sha1`/`mtime` absent when the file no longer exists. */
export interface FileWriteBinaryConflict {
  error: string;
  sha1?: string;
  mtime?: number;
}
