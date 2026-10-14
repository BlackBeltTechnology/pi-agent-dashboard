/**
 * Plain-language toast text for a failed "open server window" request
 * (text, never colour alone). Kept apart from `electron-server-windows.ts` so
 * that module stays DOM-free/i18n-free for `lib/api/server-switch.ts`.
 *
 * See change: add-electron-server-windows.
 */
import { t as i18nT } from "./i18n/i18n.js";

/** Plain-language toast for a failed open request (text, never colour alone). */
export function describeOpenFailure(reason: string, name: string): string {
  switch (reason) {
    case "identity_mismatch":
      return i18nT("connection.openWindow.identityMismatch", { name }, "{name} answered with a different identity than the one pinned. No window was opened.");
    case "unreachable":
      return i18nT("connection.openWindow.unreachable", { name }, "{name} is unreachable, or answered with a different identity.");
    case "needs_pairing":
      return i18nT("connection.openWindow.needsPairing", { name }, "{name} no longer accepts this computer. Pair again from Connect to Remote Dashboard.");
    case "unknown_server":
      return i18nT("connection.openWindow.unknown", { name }, "{name} is not a known server for this app. Pair it from Connect to Remote Dashboard.");
    default:
      return i18nT("connection.openWindow.failed", { name }, "Could not open {name}.");
  }
}
