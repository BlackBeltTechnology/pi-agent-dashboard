/**
 * Gateway Setup step 3 — choose the zrok reserved name.
 *
 * Before this, the dialog shipped a `Forget reserved URL` button and NOTHING
 * that sets one: the only way to run on a chosen name was to hand-edit
 * `~/.pi/dashboard/config.json` and restart. A Forget with no Remember was the
 * whole defect in miniature.
 *
 * Validation happens at SET time, while the user is still looking at the input,
 * rather than during a later connect flow detached from the field that caused
 * it. The typed outcome is rendered as its specific reason — `taken`,
 * `invalid` and `write-failed` are three different things to do something
 * about. See change: add-zrok-custom-reserved-name (D1).
 */
import type { ReservedNameResult } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { useCallback, useState } from "react";
import { setReservedName } from "../../lib/gateway/gateway-api.js";
import {
  needsReplaceConfirm,
  RESERVED_NAME_MAX,
  type ReservedNameStepState,
  reservedNameStepState,
  reservedNameUrl,
} from "../../lib/gateway/reserved-name.js";
import { useI18n } from "../../lib/i18n/i18n.js";

/**
 * The step's inline message and its severity tone.
 *
 * Extracted so the component stays a render function: `taken` and
 * `write-failed` are errors (something the operator must resolve), `invalid` is
 * advisory (they are still typing), everything else is neutral.
 */
function messageFor(state: ReservedNameStepState): { message: string | null; tone: string } {
  switch (state.kind) {
    case "taken":
    case "write-failed":
      return { message: state.message, tone: "var(--severity-error-fg)" };
    case "invalid":
      return { message: state.message, tone: "var(--severity-warning-fg)" };
    default:
      return { message: null, tone: "var(--text-secondary)" };
  }
}

export function GatewayReservedName({
  stored,
  onStoredChange,
  disabled,
}: {
  stored?: string;
  onStoredChange?: (name: string | undefined) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(stored ?? "");
  const [outcome, setOutcome] = useState<ReservedNameResult | undefined>();
  const [submitted, setSubmitted] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const state = reservedNameStepState({ stored, draft, outcome, submitted, confirming });

  const commit = useCallback(
    async (name: string | null) => {
      setBusy(true);
      try {
        const result = await setReservedName(name);
        setOutcome(result);
        setSubmitted(true);
        setConfirming(false);
        if (result.status === "ok") onStoredChange?.(name === null ? undefined : result.name);
      } catch (e) {
        setOutcome({
          status: "taken",
          name: name ?? "",
          message: e instanceof Error ? e.message : t("gateway.reserved.err", undefined, "Request failed"),
        });
        setSubmitted(true);
      } finally {
        setBusy(false);
      }
    },
    [onStoredChange, t],
  );

  // Validate on BLUR, not per keystroke: each submission attempts a real
  // reservation against the operator's zrok account, so per-keystroke would
  // reserve every prefix the user types on their way to the name they want.
  const onBlur = useCallback(() => {
    const trimmed = draft.trim();
    if (trimmed === (stored ?? "")) return;
    if (trimmed.length === 0) return;
    if (needsReplaceConfirm(stored, trimmed)) {
      setConfirming(true);
      return;
    }
    if (reservedNameStepState({ stored, draft, submitted: false }).kind === "typing-valid") void commit(trimmed);
  }, [draft, stored, commit]);

  const { message, tone } = messageFor(state);

  return (
    <div className="space-y-2" data-testid="gateway-reserved-name">
      <label htmlFor="gateway-reserved-input" className="block text-[12.5px] font-medium text-[var(--text-primary)]">
        {t("gateway.reserved.label", undefined, "Reserved URL name")}
      </label>
      <p className="text-[11.5px] text-[var(--text-secondary)]">
        {t(
          "gateway.reserved.hint",
          undefined,
          "Pick the name your dashboard is reachable at. The zrok namespace is shared across all accounts, so short names are often already gone.",
        )}
      </p>

      <div className="flex items-center gap-2">
        <input
          id="gateway-reserved-input"
          data-testid="gateway-reserved-input"
          type="text"
          value={draft}
          maxLength={RESERVED_NAME_MAX}
          disabled={disabled || busy}
          placeholder={t("gateway.reserved.placeholder", undefined, "robson-home-mac")}
          onChange={(e) => {
            setDraft(e.target.value);
            setSubmitted(false);
          }}
          onBlur={onBlur}
          aria-invalid={state.kind === "invalid" || state.kind === "taken"}
          aria-describedby="gateway-reserved-msg"
          className="flex-1 rounded border border-[var(--border-primary)] bg-[var(--bg-tertiary)] px-2 py-1.5 text-[12.5px] text-[var(--text-primary)]"
        />
        {stored && (
          <button
            type="button"
            data-testid="gateway-reserved-release"
            disabled={disabled || busy}
            onClick={() => {
              if (
                globalThis.confirm?.(
                  t(
                    "gateway.reserved.confirmRelease",
                    { url: reservedNameUrl(stored) },
                    `Release ${reservedNameUrl(stored)}? The name returns to zrok's global pool and anyone may claim it. Anyone you shared that URL with will no longer reach this dashboard.`,
                  ),
                )
              ) {
                void commit(null);
              }
            }}
            className="rounded border border-[var(--border-primary)] px-2.5 py-1.5 text-[12px] text-[var(--text-secondary)] hover:text-[var(--severity-error-fg)]"
          >
            {t("gateway.reserved.release", undefined, "Release")}
          </button>
        )}
      </div>

      {/* Replacing DESTROYS a URL the user may have shared, so the copy names
          the exact URL rather than "the old name". */}
      {state.kind === "replace-confirm" && (
        <div
          data-testid="gateway-reserved-replace-confirm"
          className="rounded border border-[var(--severity-warning-border)] bg-[var(--severity-warning-bg)] p-2 text-[11.5px] text-[var(--severity-warning-fg)]"
        >
          <p>
            {t(
              "gateway.reserved.replaceWarn",
              { old: reservedNameUrl(state.current), next: state.next },
              `Replacing this name releases ${reservedNameUrl(state.current)} immediately. It returns to zrok's global pool and anyone may claim it. The new name “${state.next}” is only reserved if it is available.`,
            )}
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              data-testid="gateway-reserved-replace-confirm-yes"
              disabled={busy}
              onClick={() => void commit(state.next)}
              className="rounded bg-[var(--accent-solid)] px-2.5 py-1 text-[11.5px] font-semibold text-white"
            >
              {t("gateway.reserved.replaceConfirm", undefined, "Replace")}
            </button>
            <button
              type="button"
              data-testid="gateway-reserved-replace-cancel"
              onClick={() => {
                setConfirming(false);
                setDraft(state.current);
              }}
              className="rounded border border-[var(--border-primary)] px-2.5 py-1 text-[11.5px] text-[var(--text-secondary)]"
            >
              {t("common.cancel", undefined, "Cancel")}
            </button>
          </div>
        </div>
      )}

      <p id="gateway-reserved-msg" data-testid="gateway-reserved-msg" className="text-[11.5px]" style={{ color: tone }}>
        {message ??
          (state.kind === "reserved"
            ? t("gateway.reserved.ok", { url: reservedNameUrl(state.name) }, `Reserved — ${reservedNameUrl(state.name)}`)
            : "")}
      </p>

      {/* The endpoint stored a name the RUNNING tunnel does not serve yet.
          Saying so is the entire point: a stored-vs-served divergence with no
          indication is the defect this change removes. */}
      {state.kind === "reserved" && state.tunnelStopped && (
        <p data-testid="gateway-reserved-tunnel-stopped" className="text-[11.5px] text-[var(--severity-warning-fg)]">
          {t(
            "gateway.reserved.tunnelStopped",
            undefined,
            "The tunnel was stopped to release the old name. Reconnect to serve the new one.",
          )}
        </p>
      )}

      {state.kind === "reserved" && state.liveUrlUnchanged && (
        <p
          data-testid="gateway-reserved-live-unchanged"
          className="text-[11.5px] text-[var(--severity-warning-fg)]"
        >
          {t(
            "gateway.reserved.liveUnchanged",
            { url: state.liveUrlUnchanged },
            `The running tunnel still serves ${state.liveUrlUnchanged} until you reconnect.`,
          )}
        </p>
      )}
    </div>
  );
}

/**
 * Degraded banner — the safety net for the window set-time validation cannot
 * cover: a name released or hijacked BETWEEN being set and being connected.
 *
 * Warning severity, not error: the tunnel works, just not at the requested
 * name. Derived from the status payload's reconciliation, so a watchdog recycle
 * re-renders the same banner rather than raising a fresh notification per
 * cycle (D2).
 */
export function GatewayDegradedBanner({
  degraded,
}: {
  degraded?: { configuredName: string; effectiveName?: string };
}) {
  const { t } = useI18n();
  if (!degraded) return null;
  return (
    <div
      role="status"
      data-testid="gateway-degraded-banner"
      className="rounded border border-[var(--severity-warning-border)] bg-[var(--severity-warning-bg)] p-2 text-[11.5px] text-[var(--severity-warning-fg)]"
    >
      {t(
        "gateway.degraded",
        { name: degraded.configuredName, effective: degraded.effectiveName ?? "" },
        `Connected, but not at “${degraded.configuredName}”. ${
          degraded.effectiveName
            ? `This tunnel is serving “${degraded.effectiveName}” instead.`
            : "This tunnel is serving a different URL."
        } The reserved name may have been released or claimed by another account — set it again to find out why.`,
      )}
    </div>
  );
}
