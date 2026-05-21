/**
 * Barrel for the `./minimal-chat` subpath export.
 *
 * Consumers import via:
 *   import { MinimalChatView } from "@blackbelt-technology/pi-dashboard-client-utils/minimal-chat";
 *
 * See change: extract-minimal-chat-view.
 */
export { MinimalChatView, statusVisualsFor, extractInputPreview } from "./MinimalChatView.js";
export type {
  MinimalChatEntry,
  MinimalChatMeta,
  MinimalChatMode,
  MinimalChatStatus,
  MinimalChatViewProps,
} from "./types.js";
