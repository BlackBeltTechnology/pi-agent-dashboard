/**
 * Barrel for the `./minimal-chat` subpath export.
 *
 * Consumers import via:
 *   import { MinimalChatView } from "@blackbelt-technology/pi-dashboard-client-utils/minimal-chat";
 *
 * See change: extract-minimal-chat-view.
 */
export { MinimalChatView, statusVisualsFor, extractInputPreview } from "./MinimalChatView.js";
export { currentSentence, plainTail } from "./live-tail-text.js";
export type {
  MinimalChatEntry,
  MinimalChatLiveEntry,
  MinimalChatMeta,
  MinimalChatMode,
  MinimalChatStatus,
  MinimalChatViewProps,
} from "./types.js";
