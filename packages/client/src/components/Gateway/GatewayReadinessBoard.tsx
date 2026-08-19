/**
 * Gateway readiness board — what is installed, enrolled and connected.
 *
 * Replaces a hardcoded static chip list that looked identical whether a
 * provider was installed or absent. Every row's state carries a TEXT label;
 * the dot is decoration, never the information (WCAG 1.4.1).
 *
 * Below 560px a row collapses to a single 52px line. The board renders inside
 * a dialog that already spends ~200px on title, tab strip and footer, so cards
 * at ~186px/row would outgrow the viewport. Touch targets are not reduced —
 * the saving comes entirely from removing lines (D11).
 *
 * See change: add-zrok-custom-reserved-name (D6/D7/D11).
 */
import type { ProviderReadiness } from "@blackbelt-technology/pi-dashboard-shared/tunnel-provider.js";
import { READINESS_POLL_INTERVAL_MS } from "@blackbelt-technology/pi-dashboard-shared/tunnel-provider.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { getProviderReadiness } from "../../lib/gateway/gateway-api.js";
import {
  INITIAL_POLL_STATE,
  onClose,
  onOpen,
  onTickError,
  onTickResult,
  onTickStart,
  READINESS_LABEL,
  readinessSeverity,
  secondsSinceCheck,
  shouldTick,
} from "../../lib/gateway/readiness-poll.js";
import { useI18n } from "../../lib/i18n/i18n.js";

const SEVERITY_COLOR = {
  success: "var(--severity-success-fg)",
  warning: "var(--severity-warning-fg)",
  neutral: "var(--text-secondary)",
} as const;

export function GatewayReadinessBoard({
  open,
  primary,
  onSelectProvider,
}: {
  open: boolean;
  primary?: string;
  onSelectProvider?: (id: string) => void;
}) {
  const { t } = useI18n();
  const [state, setState] = useState(INITIAL_POLL_STATE);
  const [now, setNow] = useState(() => Date.now());
  // Read inside the interval callback so the scheduler never closes over a
  // stale `inFlight` — the whole point of overlap suppression.
  const stateRef = useRef(state);
  stateRef.current = state;

  const tick = useCallback(async () => {
    if (!shouldTick(stateRef.current)) return;
    setState((s) => onTickStart(s));
    try {
      const providers = await getProviderReadiness();
      setState((s) => onTickResult(s, providers, Date.now()));
    } catch {
      setState((s) => onTickError(s));
    }
  }, []);

  useEffect(() => {
    if (!open) {
      setState((s) => onClose(s));
      return;
    }
    setState((s) => onOpen(s));
    // One tick IMMEDIATELY, not after one interval of blank board.
    void tick();
    const id = setInterval(() => void tick(), READINESS_POLL_INTERVAL_MS);
    const stamp = setInterval(() => setNow(Date.now()), 1000);
    // Cleanup is the entire guarantee that nothing polls while closed.
    return () => {
      clearInterval(id);
      clearInterval(stamp);
      setState((s) => onClose(s));
    };
  }, [open, tick]);

  const age = secondsSinceCheck(state, now);

  return (
    <div data-testid="gateway-readiness-board">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
          {t("gateway.readiness.title", undefined, "Providers")}
        </p>
        <div className="flex items-center gap-2">
          <span data-testid="gateway-readiness-age" className="text-[10.5px] text-[var(--text-secondary)]">
            {age === null
              ? t("gateway.readiness.checking", undefined, "Checking…")
              : t("gateway.readiness.checkedAgo", { n: String(age) }, `Checked ${age}s ago`)}
          </span>
          <button
            type="button"
            data-testid="gateway-readiness-refresh"
            disabled={state.inFlight}
            onClick={() => void tick()}
            className="rounded border border-[var(--border-primary)] px-2 py-1 text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50"
          >
            {t("gateway.readiness.refresh", undefined, "Refresh")}
          </button>
        </div>
      </div>

      <ul className="flex flex-col gap-1">
        {state.providers.map((p) => (
          <ReadinessRow
            key={p.provider}
            readiness={p}
            isPrimary={p.provider === primary}
            onSelect={onSelectProvider}
          />
        ))}
      </ul>
    </div>
  );
}

function ReadinessRow({
  readiness,
  isPrimary,
  onSelect,
}: {
  readiness: ProviderReadiness;
  isPrimary: boolean;
  onSelect?: (id: string) => void;
}) {
  const { t } = useI18n();
  const severity = readinessSeverity(readiness.state);
  const label = READINESS_LABEL[readiness.state];

  return (
    <li>
      <button
        type="button"
        data-testid={`gateway-readiness-${readiness.provider}`}
        data-state={readiness.state}
        onClick={() => onSelect?.(readiness.provider)}
        // 52px keeps the row a full touch target while fitting every provider
        // on one screen at 375px.
        className="flex h-[52px] w-full items-center gap-2 rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 text-left hover:bg-[var(--bg-tertiary)]"
      >
        <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ background: SEVERITY_COLOR[severity] }} />
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-[var(--text-primary)]">{readiness.provider}</span>
        {/* The TEXT is the information; the dot above is decoration. */}
        <span
          data-testid={`gateway-readiness-${readiness.provider}-label`}
          className="shrink-0 text-[11.5px]"
          style={{ color: SEVERITY_COLOR[severity] }}
        >
          {label}
        </span>
        {readiness.stale && (
          <span
            data-testid={`gateway-readiness-${readiness.provider}-stale`}
            title={readiness.reason}
            className="shrink-0 text-[10.5px] text-[var(--text-secondary)]"
          >
            {t("gateway.readiness.stale", undefined, "stale")}
          </span>
        )}
        {isPrimary && (
          <span className="shrink-0 rounded bg-[var(--accent-soft)] px-1.5 py-0.5 text-[10.5px] text-[var(--text-primary)]">
            {t("gateway.readiness.primary", undefined, "Primary")}
          </span>
        )}
        <span aria-hidden="true" className="shrink-0 text-[var(--text-secondary)]">
          ›
        </span>
      </button>
    </li>
  );
}
