/**
 * MemorySubcard — the `session-card-memory` claim component (design D6).
 *
 * Fetches the ONE per-session response on mount and derives every visual
 * state from it (pipeline-state.ts):
 *
 *   no-activity   absent/torn pending file — a normal state, distinct from
 *                 workers-off and from not-installed (the gate hides that)
 *   workers-off   `memory: false` — states workers are off and compaction
 *                 still runs; renders NO meter
 *   healthy       one row of worker indicators + exact lag + approximate
 *                 proximity
 *   degraded      per-worker cooldown advisory (model + remaining time) and
 *                 manual-mode pending-batch advisory (count + flush hint)
 *
 * Accessibility: every worker carries a textual identifier and an accessible
 * name describing its STATE — never colour alone (F7). The proximity meter is
 * an explicitly approximate, unscaled fill: no numbers, no percentage, no
 * threshold marks, never an alert (F5). The exact cursor lag renders alongside
 * so the two readouts are visually distinguishable. The detail-view affordance
 * is present in EVERY state, independent of the proximity value (F10).
 *
 * See change: add-blackhole-session-pipeline.
 */
import { useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import React, { useEffect, useState } from "react";
import { openPipelineDetail } from "./detail-navigation.js";
import { getSessionPipeline, type SessionPipelineResponse } from "./pipeline-api.js";
import { deriveSubcardState, type SubcardViewModel } from "./pipeline-state.js";

export interface MemorySubcardProps {
  session: DashboardSession;
  // Supplied by the host slot layer per the slot props contract; unused here.
  pluginContext?: unknown;
}

const STATE_KEYS: Record<string, string> = {
  recorded: "stateRecorded",
  not_due: "stateNotDue",
  empty: "stateEmpty",
  skipped: "stateSkipped",
  initial: "stateInitial",
  error: "stateError",
};

export function MemorySubcard({ session }: MemorySubcardProps): React.ReactElement | null {
  const t = useT();
  const [response, setResponse] = useState<SessionPipelineResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    // Mount-time snapshot: idle/ended sessions never refresh (accepted
    // trade-off, design.md Risks). Abort on unmount; never set after abort.
    const controller = new AbortController();
    setResponse(null);
    setFailed(false);
    getSessionPipeline(session.id, "", controller.signal)
      .then((r) => {
        if (!controller.signal.aborted) setResponse(r);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [session.id]);

  if (failed) return null; // transport failure hides the subcard content quietly
  if (!response) return null; // pre-fetch: nothing to show yet

  const vm: SubcardViewModel = deriveSubcardState(response, {
    contextTokens: session.contextTokens ?? null,
    compactAfterTokens: response.config.compactAfterTokens,
  });

  return (
    <div className="bh-mem" data-testid="bh-memory-subcard">
      {vm.workersOff ? (
        <p className="bh-mem__note" data-testid="bh-memory-workers-off">
          {t("workersOff", undefined, "Memory workers are off — compaction still runs.")}
        </p>
      ) : vm.noActivity ? (
        <p className="bh-mem__note" data-testid="bh-memory-no-activity">
          {t("noActivity", undefined, "No memory activity yet.")}
        </p>
      ) : (
        <div className="bh-mem__row" data-testid="bh-memory-workers">
          {vm.workers.map((w) => {
            const stateKey = w.cursorState ? STATE_KEYS[w.cursorState] : undefined;
            const stateText = w.cursorState
              ? t(stateKey ?? "stateOther", undefined, w.cursorState)
              : t("stateUnknown", undefined, "no cursor");
            const a11y = w.degraded
              ? t(
                  "workerCoolingA11y",
                  { worker: w.id, model: w.coolingModel ?? "", minutes: String(w.cooldownRemainingMin ?? 0) },
                  `${w.id}: on fallback model ${w.coolingModel}, cooling for ${w.cooldownRemainingMin} min`,
                )
              : t("workerStateA11y", { worker: w.id, state: stateText }, `${w.id}: ${stateText}`);
            return (
              <span
                key={w.id}
                className={`bh-mem__worker${w.degraded ? " bh-mem__worker--degraded" : ""}`}
                data-testid={`bh-worker-${w.id}`}
                aria-label={a11y}
                title={a11y}
              >
                <span className="bh-mem__worker-name">{w.id}</span>
                <span className="bh-mem__worker-state">{w.degraded ? "⏳" : "●"}</span>
              </span>
            );
          })}

          {vm.lag?.kind === "exact" && (
            <span
              className="bh-mem__lag"
              data-testid="bh-memory-lag"
              aria-label={t("lagA11y", { lag: String(vm.lag.lag) }, `cursor lag: ${vm.lag.lag} entries`)}
            >
              {t("lagLabel", undefined, "Lag")}: {vm.lag.lag}
            </span>
          )}
          {vm.lag?.kind === "stale" && (
            <span
              className="bh-mem__lag bh-mem__lag--stale"
              data-testid="bh-memory-lag-stale"
              aria-label={t("lagStaleA11y", undefined, "cursor is ahead of the recorded history")}
            >
              {t("lagStale", undefined, "Cursor ahead of history")}
            </span>
          )}

          {vm.proximityFraction !== null && (
            <span
              className="bh-mem__proximity"
              data-testid="bh-memory-proximity"
              aria-label={t("proximityA11y", undefined, "compaction proximity, approximate")}
            >
              <details className="bh-mem__proximity-explain">
                <summary>{t("proximityLabel", undefined, "Compaction proximity ≈")}</summary>
                <p data-testid="bh-proximity-explain">
                  {t(
                    "proximityExplain",
                    undefined,
                    "Approximate: blackhole counts a different quantity. This estimate uses the dashboard's own token accounting — the two are not convertible.",
                  )}
                </p>
              </details>
              <span className="bh-mem__proximity-track" aria-hidden="true">
                <span
                  className="bh-mem__proximity-fill"
                  style={{ width: `${Math.min(100, Math.max(0, Math.floor(vm.proximityFraction * 4)) * 25)}%` }}
                />
              </span>
            </span>
          )}
        </div>
      )}

      {!vm.workersOff && vm.pendingBatches > 0 && (
        <p className="bh-mem__advisory" data-testid="bh-memory-pending-advisory">
          {t(
            "pendingAdvisory",
            { count: String(vm.pendingBatches) },
            `${vm.pendingBatches} batches pending — flush with /blackhole.`,
          )}
        </p>
      )}

      {!vm.workersOff &&
        vm.workers
          .filter((w) => w.degraded)
          .map((w) => (
            <p
              key={w.id}
              className="bh-mem__advisory"
              data-testid={`bh-memory-cooldown-${w.id}`}
            >
              {t(
                "cooldownAdvisory",
                {
                  model: w.coolingModel ?? "",
                  minutes: String(w.cooldownRemainingMin ?? 0),
                },
                `${w.coolingModel} cooling — about ${w.cooldownRemainingMin} min remaining.`,
              )}
            </p>
          ))}

      {/* F10: reachable in EVERY state — detail affordance, not proximity-dependent. */}
      <button
        type="button"
        className="bh-mem__detail"
        data-testid="bh-memory-detail"
        onClick={() => openPipelineDetail(session.id)}
      >
        {t("detailButton", undefined, "Details")}
      </button>
    </div>
  );
}
