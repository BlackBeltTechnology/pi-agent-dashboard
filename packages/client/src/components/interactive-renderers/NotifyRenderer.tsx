import {
  mdiAlertCircleOutline,
  mdiAlertOutline,
  mdiCheckCircleOutline,
  mdiInformationOutline,
} from "@mdi/js";
import type { InteractiveRendererProps } from "./types.js";
import { MarkdownContent } from "../preview/MarkdownContent.js";
import { InlineMessage, type Severity } from "../primitives/InlineMessage.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";

/**
 * Per-level presentation: severity tier + icon + label key.
 *
 * `notifyMinLevel` makes `level` the input to a visibility filter, so it must
 * survive without colour. Every level therefore carries FOUR channels: the
 * InlineMessage accent bar, a distinct icon, the level word, and the tone.
 * (WCAG 2.2 §1.4.1 — never colour alone.)
 */
const LEVEL_PRESENTATION: Record<
  "info" | "success" | "warning" | "error",
  { severity: Severity; icon: string; labelKey: string; fallback: string }
> = {
  info: {
    severity: "info",
    icon: mdiInformationOutline,
    labelKey: "common.notifyLevel.info",
    fallback: "Info",
  },
  success: {
    severity: "success",
    icon: mdiCheckCircleOutline,
    labelKey: "common.notifyLevel.success",
    fallback: "Success",
  },
  warning: {
    severity: "warning",
    icon: mdiAlertOutline,
    labelKey: "common.notifyLevel.warning",
    fallback: "Warning",
  },
  error: {
    severity: "error",
    icon: mdiAlertCircleOutline,
    labelKey: "common.notifyLevel.error",
    fallback: "Error",
  },
};

/**
 * Renders `ctx.ui.notify(...)` calls forwarded by the bridge as a chat row.
 *
 * Reached through the interactive-renderer registry from the `interactiveUi`
 * row the notify reducer appends. Notify no longer rides the prompt envelope,
 * so the canonical shape is `params.message` / `params.level`.
 * `params.title` remains as the fallback for a row reduced from a pre-split
 * `prompt_request { prompt.type: "notify" }` that is still in a client's state.
 *
 * Renders through the shared `InlineMessage` severity primitive rather than a
 * bespoke bordered box, so colour comes from `--severity-*` tokens.
 *
 * See change: split-notify-from-prompt-request.
 * See change: gate-notify-rows-by-level.
 */
export function NotifyRenderer({ params }: InteractiveRendererProps) {
  // Validate rather than cast: params cross the wire, and a non-string message
  // would reach MarkdownContent. See change: split-notify-from-prompt-request.
  const message =
    typeof params.message === "string"
      ? params.message
      : typeof params.title === "string"
        ? params.title
        : "";
  const level =
    typeof params.level === "string" && params.level in LEVEL_PRESENTATION
      ? (params.level as keyof typeof LEVEL_PRESENTATION)
      : "info";

  if (!message) return null;

  const { severity, icon, labelKey, fallback } = LEVEL_PRESENTATION[level];

  return (
    <div className="mx-4 my-2">
      <InlineMessage
        severity={severity}
        icon={icon}
        title={i18nT(labelKey, undefined, fallback)}
        testId="inline-message"
      >
        <MarkdownContent content={message} />
      </InlineMessage>
    </div>
  );
}
