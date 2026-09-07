/**
 * PipelineDetailView — the `content-view` claim component (design D6).
 *
 * Renders the same per-session response as the MEMORY subcard, with
 * PROVENANCE: worker cursors attributed to the pending file, resolved-model
 * and cooldown info attributed to the cooldown file, proximity attributed to
 * the dashboard's own token accounting with the non-convertibility caveat.
 * Values that exist only in the running session (observation/reflection
 * counts, `consolidationInFlight`, last errors) are never rendered; the
 * transcript pointer states where observations and reflections appear.
 *
 * Activation is explicit navigation only (detail-navigation.ts); the return
 * affordance restores the chat view. Session-scoped: reached from the
 * session's own surface; the global settings page renders no per-session
 * state.
 *
 * See change: add-blackhole-session-pipeline.
 */
import { useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import React, { useEffect, useState } from "react";
import { closePipelineDetail } from "./detail-navigation.js";
import { getSessionPipeline, WORKER_IDS, type SessionPipelineResponse } from "./pipeline-api.js";

export interface PipelineDetailViewProps {
  session: DashboardSession;
  routeParams: Record<string, string>;
  /** Provided by the host slot layer — the canonical return path. */
  onClose: () => void;
  pluginContext?: unknown;
}

export function PipelineDetailView({
  session,
  onClose,
}: PipelineDetailViewProps): React.ReactElement {
  const t = useT();
  const [response, setResponse] = useState<SessionPipelineResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
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

  const back = (): void => {
    closePipelineDetail();
    onClose();
  };

  return (
    <div className="bh-detail" data-testid="bh-detail-view">
      <div className="bh-detail__header">
        <button
          type="button"
          className="bh-detail__back"
          data-testid="bh-detail-back"
          onClick={back}
        >
          {t("backToChat", undefined, "← Back to chat")}
        </button>
        <h2>{t("detailTitle", undefined, "Memory pipeline detail")}</h2>
      </div>

      {failed ? (
        <p data-testid="bh-detail-error">{t("pipelineLoadError", undefined, "Pipeline state unavailable.")}</p>
      ) : !response ? (
        <p data-testid="bh-detail-loading">{t("loading", undefined, "Loading…")}</p>
      ) : (
        <>
          <table className="bh-detail__table" data-testid="bh-detail-workers">
            <caption>
              {t(
                "cursorsSource",
                undefined,
                "Worker cursors — source: pi-blackhole/<session id>-pending.json",
              )}
            </caption>
            <thead>
              <tr>
                <th scope="col">{t("workerColumn", undefined, "Worker")}</th>
                <th scope="col">{t("cursorColumn", undefined, "Cursor")}</th>
                <th scope="col">{t("resolvedColumn", undefined, "Resolved model")}</th>
              </tr>
            </thead>
            <tbody>
              {WORKER_IDS.map((id) => {
                const cursor = response.cursors[id];
                const worker = response.workers[id];
                return (
                  <tr key={id} data-testid={`bh-detail-worker-${id}`}>
                    <th scope="row">{id}</th>
                    <td>
                      {cursor?.state ?? t("stateUnknown", undefined, "no cursor")}
                      {typeof cursor?.entry === "number"
                        ? ` (${cursor.entry})`
                        : cursor?.entryId
                          ? ` (${cursor.entryId})`
                          : ""}
                    </td>
                    <td>
                      {worker?.model ?? "—"}
                      {worker?.cooldown && (
                        <span data-testid={`bh-detail-cooldown-${id}`}>
                          {" "}
                          {t(
                            "cooldownReason",
                            { model: worker.model ?? "", reason: worker.cooldown.reason },
                            `cooled: ${worker.cooldown.reason}`,
                          )}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="bh-detail__source" data-testid="bh-detail-cooldown-source">
            {t(
              "cooldownSource",
              undefined,
              "Resolved models and cooldown reasons — source: pi-blackhole/pi-blackhole-cooldown.json",
            )}
          </p>

          {response.config.compactAfterTokens !== null && (
            <section className="bh-detail__proximity" data-testid="bh-detail-proximity">
              <h3>{t("proximityLabel", undefined, "Compaction proximity ≈")}</h3>
              <p data-testid="bh-detail-proximity-caveat">
                {t(
                  "proximitySource",
                  undefined,
                  "Estimated from the dashboard's own token accounting against compactAfterTokens. blackhole's counter measures a different quantity and is not persisted — the two are not convertible.",
                )}
              </p>
            </section>
          )}

          <p className="bh-detail__transcript" data-testid="bh-detail-transcript-note">
            {t(
              "transcriptNote",
              undefined,
              "Observation and reflection counts exist only while the session runs — observations and reflections appear in the session transcript.",
            )}
          </p>
        </>
      )}
    </div>
  );
}
