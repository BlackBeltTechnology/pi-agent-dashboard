/**
 * Consumers from the self-registration directory. Each row: declaration
 * (policy, requires, fixtures, calibration), chain source (preset or
 * override — a new override is seeded without incompatible backends), the
 * fail-open + chat-model warning, and the Test panel.
 * See change: add-system-one-registry.
 */
import { useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import type { CalibrationRecord } from "@blackbelt-technology/pi-system-one";
import type React from "react";
import type { BackendView, ConsumerRow, Draft } from "./api.js";
import { ChainEditor } from "./ChainEditor.js";
import { overrideChain, presetChain, seedOverride, withOverride } from "./model.js";
import { TestPanel } from "./TestPanel.js";

export interface ConsumersSectionProps {
  consumers: ConsumerRow[];
  draft: Draft;
  views: Record<string, BackendView>;
  calibration: Record<string, CalibrationRecord>;
  revision: string;
  onDraft: (d: Draft) => void;
  onRefresh: () => void;
}

export function ConsumersSection({ consumers, draft, views, calibration, revision, onDraft, onRefresh }: ConsumersSectionProps): React.ReactElement {
  const t = useT();
  return (
    <section
      className="flex flex-col gap-2 rounded-xl border border-[var(--border-secondary)] bg-[var(--bg-secondary)] px-4 py-3 shadow-[inset_0_1px_0_var(--elevation-rim),0_4px_8px_var(--shadow-card)]"
      aria-labelledby="s1-h-consumers"
    >
      <h3 id="s1-h-consumers" className="m-0 text-sm font-semibold text-[var(--text-primary)]">
        {t("consumers", undefined, "Consumers")}
      </h3>
      <p className="m-0 text-[12px] text-[var(--text-secondary)]">
        {t("consumersHint", undefined, "Features that asked a question at least once. Each can override the preset chain and be measured with Test.")}
      </p>
      {consumers.map((c) => (
        <ConsumerItem key={c.id} c={c} draft={draft} views={views} calibration={calibration} revision={revision} onDraft={onDraft} onRefresh={onRefresh} />
      ))}
    </section>
  );
}

type ConsumerItemProps = Omit<ConsumersSectionProps, "consumers"> & { c: ConsumerRow };

/** One consumer row: declaration, chain source (override seeded without incompatible backends), llm warning, Test. */
function ConsumerItem({ c, draft, views, calibration, revision, onDraft, onRefresh }: ConsumerItemProps): React.ReactElement {
  const t = useT();
    const ov = overrideChain(draft, c.id);
    const chain = ov ?? presetChain(draft);
    const llmWarn = c.failurePolicy === "fail-open" && ov !== null && ov.some((id) => draft.backends[id]?.kind === "llm");
    const cal = Object.entries(calibration).filter(([k]) => k.endsWith(`::${c.id}`));
    const enforcing = cal.some(([, r]) => r.mode === "enforce");
    const req = Object.entries(c.requires ?? {})
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(",") : v}`)
      .join(", ");
    return (
      <details className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-tertiary)]" data-testid={`consumer-${c.id}`}>
        <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2">
          <span className="font-mono text-[13px] font-semibold text-[var(--text-primary)]">{c.id}</span>
          <span className="rounded-full border border-[var(--border-secondary)] bg-[var(--bg-surface)] px-2 text-[11px] font-semibold text-[var(--text-secondary)]">
            {c.failurePolicy}
          </span>
          {llmWarn && (
            <span className="rounded-full border border-[var(--severity-warning-border)] bg-[var(--severity-warning-bg)] px-2 text-[11px] font-semibold text-[var(--severity-warning-fg)]">
              {t("slowFallback", undefined, "⚠ slow fallback")}
            </span>
          )}
          <span className="ml-auto text-[12px] text-[var(--text-secondary)]">
            {ov ? t("overrideChainLabel", undefined, "override chain") : t("presetChainLabel", undefined, "preset chain")} ·{" "}
            {c.test.enabled ? (enforcing ? "enforce" : "shadow") : t("testUnavailableShort", undefined, "Test unavailable")}
          </span>
        </summary>
        <div className="flex flex-col gap-3 border-t border-[var(--border-subtle)] p-3">
          <dl className="m-0 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 text-[12px]">
            <dt className="text-[var(--text-secondary)]">{t("failurePolicy", undefined, "Failure policy")}</dt>
            <dd className="m-0">{c.failurePolicy}</dd>
            <dt className="text-[var(--text-secondary)]">{t("requires", undefined, "Requires")}</dt>
            <dd className="m-0">{req || t("none", undefined, "none")}</dd>
            <dt className="text-[var(--text-secondary)]">{t("fixtures", undefined, "Fixtures")}</dt>
            <dd className="m-0 break-all font-mono">{c.fixtures ?? t("none", undefined, "none")}</dd>
            <dt className="text-[var(--text-secondary)]">{t("calibration", undefined, "Calibration")}</dt>
            <dd className="m-0">
              {cal.length
                ? cal.map(([k, r]) => `${r.mode} · ${k.split("::")[0]} (${r.model})`).join(" · ")
                : t("notMeasured", undefined, "Not measured on any backend. Answers are advisory (shadow).")}
            </dd>
          </dl>
          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
            <legend className="text-[13px] font-semibold text-[var(--text-primary)]">{t("chain", undefined, "Chain")}</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" name={`ov-${c.id}`} checked={ov === null} onChange={() => onDraft(withOverride(draft, c.id, null))} />
                {t("usePreset", { preset: draft.activePreset }, `Use preset (${draft.activePreset})`)}
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name={`ov-${c.id}`}
                  checked={ov !== null}
                  data-testid={`override-${c.id}`}
                  onChange={() => onDraft(withOverride(draft, c.id, seedOverride(presetChain(draft), c, views)))}
                />
                {t("overrideForConsumer", undefined, "Override for this consumer")}
              </label>
            </div>
            {ov !== null ? (
              <ChainEditor
                idPrefix={`s1-ov-${c.id.replace(/[^a-z0-9]/g, "-")}`}
                chain={chain}
                draft={draft}
                views={views}
                consumer={c}
                onChange={(next) => onDraft(withOverride(draft, c.id, next))}
              />
            ) : (
              <p className="m-0 text-[12px] text-[var(--text-secondary)]">{chain.join(" → ") || t("emptyChain", undefined, "empty chain")}</p>
            )}
            {llmWarn && (
              <div role="note" data-testid={`llm-warning-${c.id}`} className="rounded-md border border-[var(--severity-warning-border)] bg-[var(--severity-warning-bg)] px-3 py-2 text-[13px] text-[var(--severity-warning-fg)]">
                {t(
                  "llmWarning",
                  undefined,
                  "This consumer is fail-open and its chain includes a chat model. A chat role can take up to 15 s per question; remove it if this runs on a hot path.",
                )}
              </div>
            )}
          </fieldset>
          <section className="flex flex-col gap-2" aria-label={t("testFor", { id: c.id }, `Test ${c.id}`)}>
            <h4 className="m-0 text-[13px] font-semibold text-[var(--text-primary)]">{t("test", undefined, "Test")}</h4>
            <TestPanel consumer={c} draft={draft} views={views} revision={revision} onSaved={onRefresh} />
          </section>
        </div>
      </details>
    );
}
