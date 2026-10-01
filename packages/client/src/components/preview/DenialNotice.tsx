/**
 * One notice for a refused preview load (change: surface-denial-remedy-in-previews,
 * design D2/D4/D5/D9). Rendered by six surfaces: the editor tab's image, PDF,
 * video/audio, markdown and HTML viewers, `FilePreviewOverlay` and
 * `ImageLightbox`.
 *
 * It explains the outcome and offers at most ONE control, a click-triggered
 * eligible re-request ("Ask for access" / "Ask again"), plus a pointer to
 * Settings → Access. It never posts a grant: the dialog and Settings → Access
 * stay the only grant paths. The subject renders verbatim from the body.
 */
import type { PromptOutcome } from "../../lib/access-grants/access-grants-types.js";
import { canCarryGrantChannel, useHasGrantChannel } from "../../lib/access-grants/grant-channel.js";
import { useI18n } from "../../lib/i18n/i18n.js";
import type { DenialFailure } from "./denial-fetch.js";

/** Outcomes an eligible request can still change, so an opted-out load may ask. */
const ASK_FOR_ACCESS_OUTCOMES: ReadonlySet<PromptOutcome> = new Set(["ineligible", "busy", "unanswered", "unavailable"]);
/** Outcomes where asking again, eligibly, can raise a dialog. */
const ASK_AGAIN_OUTCOMES: ReadonlySet<PromptOutcome> = new Set(["busy", "unanswered", "unavailable"]);

export type NoticeAction = "ask-for-access" | "ask-again" | null;

/**
 * The single action rule (design D4). `asked`: the operator already clicked
 * once for this load — the notice never loops.
 */
export function noticeAction(p: {
  result: DenialFailure;
  canCarry: boolean;
  asked: boolean;
}): NoticeAction {
  if (p.asked || p.result.kind !== "denied") return null;
  const outcome = p.result.promptOutcome;
  if (p.result.optedOut) {
    return p.canCarry && (outcome === undefined || ASK_FOR_ACCESS_OUTCOMES.has(outcome)) ? "ask-for-access" : null;
  }
  return outcome !== undefined && ASK_AGAIN_OUTCOMES.has(outcome) ? "ask-again" : null;
}

interface Props {
  result: DenialFailure;
  /** The refused request's URL: decides whether a capability could ride an ask. */
  url: string;
  /** What failed to load, for the transport-level messages. */
  path: string;
  /** Re-run the load eligibly, once. Absent → the notice offers no control. */
  onAsk?: () => void;
  /** The operator already asked for this load (no-loop rule). */
  asked?: boolean;
  /**
   * A multi-request viewer (video, audio, PDF): say BEFORE the click that a
   * one-time answer admits only a check, not the stream or document (D2).
   */
  multiRequest?: boolean;
  /**
   * Client-side sequence (D2): asked → the eligible probe was admitted → the
   * stream was refused again. The server cannot say why; the client can.
   */
  admittedCheckOnly?: boolean;
}

export function DenialNotice({ result, url, path, onAsk, asked = false, multiRequest = false, admittedCheckOnly = false }: Props) {
  const { t } = useI18n();
  // Re-render when the capability comes or goes (socket loss removes the ask).
  useHasGrantChannel();
  const action = admittedCheckOnly || !onAsk ? null : noticeAction({ result, canCarry: canCarryGrantChannel(url), asked });
  const message = admittedCheckOnly
    ? t(
        "preview.denial.admittedCheckOnly",
        undefined,
        "A one-time answer admitted only the check, not the stream or document.",
      )
    : messageFor(result, path, t);
  const subject = result.kind === "denied" && result.subject ? result.subject : null;
  // Only a containment denial is about access; a plain refusal, a missing file
  // or a transport failure must not suggest a grant.
  const showsSettings = result.kind === "denied";

  return (
    <div
      data-testid="denial-notice"
      data-outcome={result.kind === "denied" ? (result.promptOutcome ?? "withheld") : result.kind}
      role="status"
      className="flex h-full w-full flex-col items-center justify-center gap-2 p-4 text-center text-sm text-[var(--text-secondary)]"
    >
      <p>{message}</p>
      {subject && (
        <p className="font-mono text-xs break-all text-[var(--text-tertiary)]">
          {t("preview.denial.subject", { subject }, "Folder: {subject}")}
        </p>
      )}
      {action && multiRequest && (
        <p className="text-xs text-[var(--text-tertiary)]">
          {t(
            "preview.denial.multiRequestWarning",
            undefined,
            "A one-time answer admits only a check, not the whole stream or document.",
          )}
        </p>
      )}
      {action && onAsk && (
        <button
          type="button"
          onClick={onAsk}
          className="rounded border border-[var(--border-primary)] px-3 py-1 text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
        >
          {action === "ask-for-access"
            ? t("preview.denial.askForAccess", undefined, "Ask for access")
            : t("preview.denial.askAgain", undefined, "Ask again")}
        </button>
      )}
      {!action && showsSettings && (
        <p className="text-xs text-[var(--text-tertiary)]">
          {t("preview.denial.settingsPointer", undefined, "Access can be granted in Settings → Access.")}
        </p>
      )}
    </div>
  );
}

type Translate = ReturnType<typeof useI18n>["t"];

function messageFor(result: DenialFailure, path: string, t: Translate): string {
  switch (result.kind) {
    case "not-found":
      return t("preview.denial.notFound", { path }, "File not found: {path}");
    case "error": {
      const message = result.message ?? t("preview.denial.httpStatus", { status: result.status ?? 0 }, "HTTP {status}");
      return t("preview.denial.loadError", { path, message }, "Couldn't load {path}: {message}");
    }
    case "unknown":
      return t("preview.denial.unknown", { path }, "Couldn't load {path}.");
    case "refused":
      return result.error || t("preview.denial.refusedNoReason", undefined, "Access to this file was refused.");
    case "denied":
      return result.promptOutcome
        ? outcomeMessage(result.promptOutcome, t)
        : t("preview.denial.refusedNoReason", undefined, "Access to this file was refused.");
  }
}

/** The D5 copy table: one distinct key per outcome. States facts; never steers a verdict. */
function outcomeMessage(outcome: PromptOutcome, t: Translate): string {
  switch (outcome) {
    case "cannot-ask":
      return t("preview.denial.cannotAsk", undefined, "This kind of preview can't ask for access.");
    case "off":
      return t("preview.denial.off", undefined, "Access prompts are off for this server.");
    case "not-enforced":
      return t("preview.denial.notEnforced", undefined, "Access prompts need the host gate in enforce mode.");
    case "ineligible":
      return t("preview.denial.ineligible", undefined, "This view can't ask for access by itself.");
    case "busy":
      return t("preview.denial.busy", undefined, "Another access question is open. Answer it, then ask again.");
    case "throttled":
      return t("preview.denial.throttled", undefined, "Too many access questions are pending. They expire within about two minutes.");
    case "recently-answered":
      return t("preview.denial.recentlyAnswered", undefined, "This folder was answered in the last two minutes.");
    case "allowed-elsewhere":
      return t("preview.denial.allowedElsewhere", undefined, "Allow once admitted another file in this folder. Allow always covers several files.");
    case "declined":
      return t("preview.denial.declined", undefined, "Access was not allowed.");
    case "unanswered":
      return t("preview.denial.unanswered", undefined, "The access question expired without an answer.");
    case "ungrantable":
      return t("preview.denial.ungrantable", undefined, "This folder can't be granted.");
    case "grant-failed":
      return t("preview.denial.grantFailed", undefined, "The answer was given but couldn't be saved.");
    case "allowed-but-refused":
      return t("preview.denial.allowedButRefused", undefined, "Access was allowed, but the file still couldn't be read.");
    case "unavailable":
      return t("preview.denial.unavailable", undefined, "Couldn't ask for access right now.");
  }
}
