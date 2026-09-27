/**
 * Per-consumer Test: pick one backend (off-machine disabled while the switch
 * is off; managed not `ready` disabled with its reason), run the fixtures,
 * show accuracy / AUC / p50 / p90 / input chars / estimated cost, then save a
 * calibration record. Saving `enforce` requires a confirmation naming the
 * backend and model; thresholds are read-only (design D13). Calibration saves
 * act immediately (not a Save Bar source).
 * See change: add-system-one-registry.
 */
import { useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import type React from "react";
import { useRef, useState } from "react";
import { ApiError, api, type BackendView, type ConsumerRow, type Draft, type EvalReport } from "./api.js";
import { ConfirmDialog } from "./ConfirmDialog.js";

const btn =
  "rounded-md border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-3 py-1.5 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-surface)] disabled:opacity-50 disabled:cursor-not-allowed";

export interface TestPanelProps {
  consumer: ConsumerRow;
  draft: Draft;
  views: Record<string, BackendView>;
  revision: string;
  onSaved: () => void;
}

export function TestPanel({ consumer, draft, views, revision, onSaved }: TestPanelProps): React.ReactElement {
  const t = useT();
  const [backend, setBackend] = useState("");
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<EvalReport | null>(null);
  const [mode, setMode] = useState<"shadow" | "enforce">("shadow");
  const [confirming, setConfirming] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  if (!consumer.test.enabled)
    return (
      <div role="status" className="rounded-md border border-[var(--severity-warning-border)] bg-[var(--severity-warning-bg)] px-3 py-2 text-[13px] text-[var(--severity-warning-fg)]">
        {t("testUnavailable", { reason: consumer.test.reason ?? "" }, `Test unavailable: ${consumer.test.reason ?? ""}`)}
        {consumer.fixtures ? ` (${consumer.fixtures})` : ""}
      </div>
    );

  const disabledReason = (id: string): string | null => {
    const v = views[id];
    if (!v) return t("notSaved", undefined, "not saved");
    if (v.offMachine && !draft.allowOffMachine) return t("offMachineDisabled", undefined, "off-machine, disabled");
    if (v.managed && v.managed.state !== "ready") return t("notRunning", undefined, "not running");
    return null;
  };
  const ids = Object.keys(draft.backends);
  const current = backend && !disabledReason(backend) ? backend : (ids.find((id) => !disabledReason(id)) ?? "");
  const cases = Math.min(consumer.test.cases, 500);

  const run = async () => {
    const ac = new AbortController();
    abort.current = ac;
    setRunning(true);
    setReport(null);
    setMsg(null);
    try {
      setReport(await api.runEval(consumer.id, current, ac.signal));
    } catch (e) {
      if (!ac.signal.aborted) setMsg(e instanceof ApiError ? e.code : "error");
      else setMsg(t("testCancelled", undefined, "Test cancelled"));
    } finally {
      setRunning(false);
    }
  };
  const save = async (confirm: boolean) => {
    if (!report?.model) return;
    try {
      await api.saveCalibration({
        backendId: report.backendId,
        consumerId: consumer.id,
        mode,
        thresholds: report.thresholds,
        model: report.model,
        baseRevision: revision,
        ...(confirm ? { confirm: true } : {}),
      });
      setMsg(t("calibrationSaved", { mode }, `Calibration saved as ${mode}`));
      onSaved();
    } catch (e) {
      setMsg(e instanceof ApiError && e.code === "stale-revision" ? t("staleCalibration", undefined, "The config changed on disk. Reload the page, then save again.") : "error");
    }
  };
  const pct = (x: number) => x.toFixed(2);
  const ms = (x: number | null) => (x == null ? "–" : `${Math.round(x)} ms`);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-[14rem] flex-col gap-1 text-[12px] font-semibold text-[var(--text-secondary)]">
          {t("backendToTest", undefined, "Backend to test")}
          <select
            className="rounded border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-3 py-1.5 text-sm text-[var(--text-primary)]"
            value={current}
            disabled={running}
            onChange={(e) => setBackend(e.target.value)}
            data-testid={`test-backend-${consumer.id}`}
          >
            {ids.map((id) => {
              const why = disabledReason(id);
              return (
                <option key={id} value={id} disabled={!!why}>
                  {why ? `${id} (${why})` : id}
                </option>
              );
            })}
          </select>
        </label>
        {running ? (
          <button type="button" className={btn} onClick={() => abort.current?.abort()}>
            {t("cancel", undefined, "Cancel")}
          </button>
        ) : (
          <button type="button" className={btn} disabled={!current} onClick={run} data-testid={`run-test-${consumer.id}`}>
            {t("runTest", { n: cases }, `Run Test (${cases} cases)`)}
          </button>
        )}
      </div>
      <p className="m-0 min-h-5 text-[12px] text-[var(--text-secondary)]" aria-live="polite">
        {running ? t("testRunning", { n: cases, id: current }, `Running ${cases} cases on ${current}…`) : msg}
      </p>
      {report && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12px]" data-testid={`results-${consumer.id}`}>
              <caption className="pb-1 text-left font-semibold text-[var(--text-secondary)]">
                {t("resultsCaption", { id: report.backendId, model: report.model ?? "–" }, `Results · ${report.backendId} answered as ${report.model ?? "–"}`)}
              </caption>
              <thead>
                <tr className="text-[var(--text-secondary)]">
                  <th scope="col" className="border-b border-[var(--border-subtle)] px-2 py-1 text-left">{t("colQuestion", undefined, "Question")}</th>
                  <th scope="col" className="border-b border-[var(--border-subtle)] px-2 py-1 text-right">{t("colAccuracy", undefined, "Accuracy")}</th>
                  <th scope="col" className="border-b border-[var(--border-subtle)] px-2 py-1 text-right">AUC</th>
                  <th scope="col" className="border-b border-[var(--border-subtle)] px-2 py-1 text-right">p50</th>
                  <th scope="col" className="border-b border-[var(--border-subtle)] px-2 py-1 text-right">p90</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(report.questions).map(([qid, q]) => (
                  <tr key={qid}>
                    <td className="border-b border-[var(--border-subtle)] px-2 py-1">
                      {qid} ({q.type})
                    </td>
                    <td className="border-b border-[var(--border-subtle)] px-2 py-1 text-right">{pct(q.accuracy)}</td>
                    <td className="border-b border-[var(--border-subtle)] px-2 py-1 text-right">{q.auc == null ? "–" : pct(q.auc)}</td>
                    <td className="border-b border-[var(--border-subtle)] px-2 py-1 text-right">{ms(report.latencyMs.p50)}</td>
                    <td className="border-b border-[var(--border-subtle)] px-2 py-1 text-right">{ms(report.latencyMs.p90)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={5} className="px-2 py-1 font-semibold">
                    {t(
                      "resultsFoot",
                      {
                        cases: report.cases,
                        failures: report.failures,
                        chars: report.inputChars.toLocaleString(),
                        cost: report.estimatedCostUsd == null ? "–" : `$${report.estimatedCostUsd.toFixed(4)}`,
                      },
                      `${report.cases} cases · ${report.failures} failed · ${report.inputChars.toLocaleString()} input chars · estimated cost ${report.estimatedCostUsd == null ? "–" : `$${report.estimatedCostUsd.toFixed(4)}`}`,
                    )}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
            <legend className="text-[12px] font-semibold text-[var(--text-secondary)]">
              {t("saveCalibrationFor", { key: `${report.backendId}::${consumer.id}` }, `Save calibration for ${report.backendId}::${consumer.id}`)}
            </legend>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" name={`mode-${consumer.id}`} checked={mode === "shadow"} onChange={() => setMode("shadow")} />
                {t("modeShadow", undefined, "Shadow: log answers, act on none")}
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" name={`mode-${consumer.id}`} checked={mode === "enforce"} onChange={() => setMode("enforce")} />
                {t("modeEnforce", undefined, "Enforce: the feature acts on answers")}
              </label>
              <button
                type="button"
                className={btn}
                disabled={!report.model}
                data-testid={`save-calibration-${consumer.id}`}
                onClick={() => (mode === "enforce" ? setConfirming(true) : save(false))}
              >
                {t("saveCalibration", undefined, "Save calibration")}
              </button>
            </div>
            <p className="m-0 text-[12px] text-[var(--text-secondary)]">
              {Object.keys(report.thresholds).length
                ? t(
                    "thresholdsFromRun",
                    { list: Object.entries(report.thresholds).map(([k, v]) => `${k} ≥ ${v.toFixed(2)}`).join(", ") },
                    `Thresholds from this run: ${Object.entries(report.thresholds).map(([k, v]) => `${k} ≥ ${v.toFixed(2)}`).join(", ")}. Saved immediately.`,
                  )
                : t("noThresholds", undefined, "No thresholds from this run. Saved immediately.")}
            </p>
          </fieldset>
        </>
      )}
      {confirming && report?.model && (
        <ConfirmDialog
          title={t("enforceTitle", { id: report.backendId, consumer: consumer.id }, `Enforce ${report.backendId} for ${consumer.id}?`)}
          body={
            <>
              <p className="m-0">
                {t(
                  "enforceBody",
                  { consumer: consumer.id, id: report.backendId, model: report.model },
                  `${consumer.id} will act on answers from ${report.backendId}, model ${report.model}.`,
                )}
              </p>
              <p className="m-0">
                {t("enforceNote", undefined, "Enforcement stops on its own if the backend starts answering with a different model version.")}
              </p>
            </>
          }
          confirmLabel={t("enforce", undefined, "Enforce")}
          cancelLabel={t("cancel", undefined, "Cancel")}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            save(true).catch(() => setMsg("error"));
          }}
        />
      )}
    </div>
  );
}
