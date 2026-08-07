/**
 * Notify level normalization, shared by the bridge send site and the server's
 * legacy-shape guard. An already-published bridge forwards pi's `level` as an
 * unvalidated string, so the server cannot rely on the send site alone.
 * See change: split-notify-from-prompt-request.
 */
import type { NotifyLevel } from "./protocol.js";

const NOTIFY_LEVELS: readonly string[] = ["info", "success", "warning", "error"];

/** Maps an unrecognized level to `"info"`. */
export function normalizeNotifyLevel(level: unknown): NotifyLevel {
  return typeof level === "string" && NOTIFY_LEVELS.includes(level)
    ? (level as NotifyLevel)
    : "info";
}
