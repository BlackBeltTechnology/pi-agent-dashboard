import {
  mdiAlertCircleOutline,
  mdiAlertOutline,
  mdiCheckCircleOutline,
  mdiInformationOutline,
} from "@mdi/js";
import { type NotifyRepeat, notifyRenderedText } from "../../lib/chat/collapse-repeated-notifies.js";
import { t as i18nT, useI18n } from "../../lib/i18n/i18n.js";
import { MarkdownContent } from "../preview/MarkdownContent.js";
import { InlineMessage, type Severity } from "../primitives/InlineMessage.js";
import type { InteractiveRendererProps } from "./types.js";

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
  // Shared with the collapse key so a run matches what renders.
  // See change: collapse-and-order-notify-rows.
  const message = notifyRenderedText(params);
  const { language, t } = useI18n();
  // OWN-property check: a bare `in` also matches `Object.prototype` names, so a
  // level of "toString" would destructure a FUNCTION and crash InlineMessage on
  // `tone.bg`. See CodeRabbit review, PR #453.
  const level =
    typeof params.level === "string" && Object.hasOwn(LEVEL_PRESENTATION, params.level)
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
        <RepeatBadge repeat={params.repeat} language={language} t={t} />
      </InlineMessage>
    </div>
  );
}

/** Validates the collapse annotation; only a real repeat (count > 1) renders. */
function asRepeat(value: unknown): NotifyRepeat | null {
  const r = value as Partial<NotifyRepeat> | null | undefined;
  if (!r || typeof r.count !== "number" || r.count <= 1) return null;
  if (typeof r.firstTs !== "number" || typeof r.lastTs !== "number") return null;
  return r as NotifyRepeat;
}

function sameLocalDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

/** `HH:MM–HH:MM`; both ends carry a short date when they fall on different days. */
function formatRepeatRange(firstTs: number, lastTs: number, language: string): string {
  const withDate = !sameLocalDay(firstTs, lastTs);
  const fmt = new Intl.DateTimeFormat(language, {
    ...(withDate ? { month: "short", day: "numeric" } : {}),
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${fmt.format(firstTs)}–${fmt.format(lastTs)}`;
}

/**
 * `×N` + first–last time for a collapsed run of identical notifies. The count
 * and range are conveyed as text (and an accessible label), never colour alone.
 * See change: collapse-and-order-notify-rows (D4).
 */
function RepeatBadge({
  repeat: raw,
  language,
  t,
}: {
  repeat: unknown;
  language: string;
  t: (key: string, vars?: Record<string, string | number>, fallback?: string) => string;
}) {
  const repeat = asRepeat(raw);
  if (!repeat) return null;
  const range = formatRepeatRange(repeat.firstTs, repeat.lastTs, language);
  const label = t(
    "common.notifyRepeat.label",
    { count: repeat.count, range },
    "Repeated {count} times, {range}",
  );
  return (
    <div
      className="mt-1 flex items-center gap-2 text-xs opacity-80"
      data-testid="notify-repeat"
      role="note"
      aria-label={label}
    >
      <span
        className="rounded border border-current px-1.5 font-medium tabular-nums"
        data-testid="notify-repeat-count"
        aria-hidden="true"
      >
        {t("common.notifyRepeat.badge", { count: repeat.count }, "×{count}")}
      </span>
      <span data-testid="notify-repeat-range" aria-hidden="true">
        {range}
      </span>
    </div>
  );
}
