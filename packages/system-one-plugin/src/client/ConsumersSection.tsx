/**
 * Consumers from the self-registration directory. Each row: declaration
 * (policy, requires, fixtures, calibration), chain source (preset or
 * override — a new override is seeded without incompatible backends), the
 * fail-open + chat-model warning, and the Test panel.
 * See change: add-system-one-registry.
 */
import { SettingsFacts, SettingsGroup, SettingsItem, SettingsNotice, SettingsStatusPill, useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import type { CalibrationRecord } from "@blackbelt-technology/pi-system-one";
import type React from "react";
import type { BackendView, ConsumerRow, Draft } from "./api.js";
import { ChainEditor } from "./ChainEditor.js";
import { overrideChain, presetChain, seedOverride, withOverride } from "./model.js";
import { SUBHEAD } from "./settings-ui.js";
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
    <SettingsGroup title={<span id="s1-h-consumers">{t("consumers", undefined, "Consumers")}</span>} defaultOpen>
      <p className="m-0 text-xs text-[var(--text-secondary)]">
        {t("consumersHint", undefined, "Features that asked a question at least once. Each can override the preset chain and be measured with Test.")}
      </p>
      {consumers.map((c) => (
        <ConsumerItem key={c.id} c={c} draft={draft} views={views} calibration={calibration} revision={revision} onDraft={onDraft} onRefresh={onRefresh} />
      ))}
    </SettingsGroup>
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
    const modeWord = !c.test.enabled
      ? t("testUnavailableShort", undefined, "Test unavailable")
      : enforcing
        ? t("modeEnforceShort", undefined, "Enforce")
        : t("modeShadowShort", undefined, "Shadow");
    return (
      <SettingsItem
        collapsible
        defaultOpen={false}
        testId={`consumer-${c.id}`}
        title={<span className="font-mono">{c.id}</span>}
        status={
          <>
            <SettingsStatusPill tone="neutral" icon={null}>
              {c.failurePolicy}
            </SettingsStatusPill>
            {llmWarn && <SettingsStatusPill tone="warning">{t("slowFallback", undefined, "Slow fallback")}</SettingsStatusPill>}
            <SettingsStatusPill tone={enforcing && c.test.enabled ? "info" : "neutral"} icon={null}>
              {ov ? t("overrideChainLabel", undefined, "override chain") : t("presetChainLabel", undefined, "preset chain")} · {modeWord}
            </SettingsStatusPill>
          </>
        }
      >
        <SettingsFacts
          rows={[
            [t("failurePolicy", undefined, "Failure policy"), c.failurePolicy],
            [t("requires", undefined, "Requires"), req || t("none", undefined, "none")],
            [t("fixtures", undefined, "Fixtures"), <span key="f" className="break-all font-mono">{c.fixtures ?? t("none", undefined, "none")}</span>],
            [
              t("calibration", undefined, "Calibration"),
              cal.length
                ? cal.map(([k, r]) => `${r.mode} · ${k.split("::")[0]} (${r.model})`).join(" · ")
                : t("notMeasured", undefined, "Not measured on any backend. Answers are advisory (shadow)."),
            ],
          ]}
        />
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className={SUBHEAD}>{t("chain", undefined, "Chain")}</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--text-primary)]">
            <label className="flex cursor-pointer items-center gap-1.5">
              <input type="radio" name={`ov-${c.id}`} checked={ov === null} onChange={() => onDraft(withOverride(draft, c.id, null))} />
              {t("usePreset", { preset: draft.activePreset }, `Use preset (${draft.activePreset})`)}
            </label>
            <label className="flex cursor-pointer items-center gap-1.5">
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
            <p className="m-0 text-xs text-[var(--text-secondary)]">{chain.join(" → ") || t("emptyChain", undefined, "empty chain")}</p>
          )}
          {llmWarn && (
            <div role="note" data-testid={`llm-warning-${c.id}`}>
              <SettingsNotice tone="warning">
                {t(
                  "llmWarning",
                  undefined,
                  "This consumer is fail-open and its chain includes a chat model. A chat role can take up to 15 s per question; remove it if this runs on a hot path.",
                )}
              </SettingsNotice>
            </div>
          )}
        </fieldset>
        <section className="flex flex-col gap-2" aria-label={t("testFor", { id: c.id }, `Test ${c.id}`)}>
          <h4 className={SUBHEAD}>{t("test", undefined, "Test")}</h4>
          <TestPanel consumer={c} draft={draft} views={views} revision={revision} onSaved={onRefresh} />
        </section>
      </SettingsItem>
    );
}
