/**
 * "Decision models (System 1)" settings section (spec: system-one-settings-ui;
 * approved mockup openspec/changes/archive/2026-09-27-add-system-one-registry/mockups/, design D13).
 *
 * The UI-managed keys (`allowOffMachine`, `backends`, `presets`,
 * `activePreset`) are a draft registered with the host Save Bar via
 * `useSettingsDraftSource` (id `plugin:system-one`). `commit` PUTs
 * `{ config, baseRevision }`; a 409 rejects (host keeps it dirty) and shows an
 * in-section conflict callout with Reload. Key entry, Start/Stop and
 * calibration saves act immediately. Egress classification comes from the
 * server. Theme-token classes only.
 * See change: add-system-one-registry.
 */
import { SettingsGroup, SettingsNotice, ToggleField, useSettingsDraftSource, useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api, type ConfigResponse, type ConsumerRow, type Draft, type KeyStatus } from "./api.js";
import { BackendsSection } from "./BackendsSection.js";
import { ChainEditor } from "./ChainEditor.js";
import { ConsumersSection } from "./ConsumersSection.js";
import { isUsable, presetChain, sameDraft, withoutPreset, withPresetChain } from "./model.js";
import { BTN, SUBHEAD } from "./settings-ui.js";

function toDraft(c: ConfigResponse["config"]): Draft {
  return { allowOffMachine: c.allowOffMachine, backends: c.backends, presets: c.presets, activePreset: c.activePreset };
}

export function SystemOneSettings(): React.ReactElement {
  const t = useT();
  const [data, setData] = useState<ConfigResponse | null>(null);
  const [baseline, setBaseline] = useState<Draft | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [keys, setKeys] = useState<Record<string, KeyStatus>>({});
  const [consumers, setConsumers] = useState<ConsumerRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  /**
   * The revision the draft is based on (sent as `baseRevision`). It moves only
   * when the draft is (re)based on the server copy, never on a background
   * refresh while edits are pending; otherwise a port the supervisor
   * persisted meanwhile would be overwritten instead of answered with 409.
   */
  const [baseRevision, setBaseRevision] = useState("absent");
  const dirtyRef = useRef(false);

  /** Refresh server state; rebases the draft when asked or when it is clean. */
  const load = useCallback(async (resetDraft: boolean) => {
    try {
      const [cfg, k, c] = await Promise.all([api.getConfig(), api.getKeys(), api.getConsumers()]);
      setData(cfg);
      setKeys(k.keys);
      setConsumers(c.consumers);
      if (resetDraft || !dirtyRef.current) {
        const d = toDraft(cfg.config);
        setBaseline(d);
        setDraft(d);
        setBaseRevision(cfg.revision);
        setConflict(false);
      }
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.code : "error");
    }
  }, []);

  useEffect(() => {
    load(true).catch(() => {});
  }, [load]);

  // Poll while a managed backend is installing/starting.
  const pending = !!data && Object.values(data.backends).some((v) => v.managed?.state === "starting" || v.managed?.state === "installing");
  useEffect(() => {
    if (!pending) return;
    const h = setInterval(() => {
      load(false).catch(() => {});
    }, 2000);
    return () => clearInterval(h);
  }, [pending, load]);

  const isDirty = !!draft && !sameDraft(draft, baseline);
  dirtyRef.current = isDirty;
  const commit = useCallback(async () => {
    if (!draft) return;
    try {
      await api.putConfig(draft, baseRevision);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setConflict(true);
      throw e;
    }
    await load(true);
  }, [draft, baseRevision, load]);

  useSettingsDraftSource({
    id: "plugin:system-one",
    isDirty,
    commit,
    reset: () => {
      load(true).catch(() => {});
    },
  });

  if (loadError && !data)
    return (
      <SettingsNotice
        tone="error"
        testId="system-one-load-error"
        onRetry={() => load(true).catch(() => {})}
        details={loadError}
      >
        {loadError === "E_PARSE"
          ? t("loadErrorParse", undefined, "Could not read system-one.json. The file may be damaged.")
          : t("loadErrorGeneric", undefined, "Could not load the System 1 settings. Check that the dashboard server is running, then try again.")}
      </SettingsNotice>
    );
  if (!data || !draft) return <div className="text-xs text-[var(--text-secondary)]">{t("loading", undefined, "Loading…")}</div>;

  const views = data.backends;
  const chain = presetChain(draft);
  const noUsable = !chain.some((id) => isUsable(id, draft, views));

  return (
    <section data-testid="system-one-settings" className="flex flex-col gap-3 pb-8 text-xs text-[var(--text-secondary)]">
      <header className="flex flex-col gap-1">
        <p className="m-0 max-w-[60ch] text-xs">
          {t(
            "lead",
            undefined,
            "Small, fast models that answer yes/no and pick-one questions for other dashboard features. Answers stay advisory until you measure a backend with Test and save it as enforce.",
          )}
        </p>
        <code className="font-mono text-[12px]">{data.path}</code>
      </header>

      {conflict && (
        <SettingsNotice
          tone="error"
          testId="system-one-conflict"
          actions={
            <button type="button" className={BTN} onClick={() => load(true).catch(() => {})} data-testid="system-one-reload">
              {t("reload", undefined, "Reload")}
            </button>
          }
        >
          {t(
            "conflict",
            undefined,
            "Not saved: system-one.json changed on disk after this page loaded (for example a managed backend saved its port). Reload to get the current file, then redo your edits.",
          )}
        </SettingsNotice>
      )}

      <SettingsGroup title={<span id="s1-h-privacy">{t("whereDataMayGo", undefined, "Where data may go")}</span>} defaultOpen>
        <ToggleField
          label={t("allowOffMachine", undefined, "Allow off-machine backends")}
          value={draft.allowOffMachine}
          onChange={(v) => setDraft({ ...draft, allowOffMachine: v })}
          testIds={{ control: "system-one-allow-off-machine" }}
          hint={
            draft.allowOffMachine
              ? t("offOn", undefined, "On. Session text may be sent to hosted backends (TypeSafe Jev) and to chat roles that resolve to cloud models.")
              : t("offOff", undefined, "Off. Session text is only sent to backends on this machine (127.0.0.1). Off-machine backends are skipped and cannot be tested.")
          }
        />
      </SettingsGroup>

      <SettingsGroup title={<span id="s1-h-preset">{t("preset", undefined, "Preset")}</span>} defaultOpen>
        <fieldset className="m-0 grid grid-cols-1 gap-2 border-0 p-0 sm:grid-cols-2">
          <legend className="sr-only">{t("activePreset", undefined, "Active preset")}</legend>
          {Object.entries(draft.presets).map(([name, p]) => (
            <div
              key={name}
              className={`flex items-start gap-2 rounded-lg border bg-[var(--bg-tertiary)] px-3 py-2 ${
                name === draft.activePreset ? "border-[var(--accent-solid)]" : "border-[var(--border-secondary)]"
              }`}
            >
              <label className="flex flex-1 cursor-pointer items-start gap-2">
                <input
                  type="radio"
                  name="s1-preset"
                  value={name}
                  checked={name === draft.activePreset}
                  onChange={() => setDraft({ ...draft, activePreset: name })}
                  data-testid={`preset-${name}`}
                  className="mt-1"
                />
                <span>
                  <span className="block text-xs font-semibold text-[var(--text-primary)]">{name}</span>
                  <span className="block text-xs">{p.chain.join(" → ") || t("emptyChain", undefined, "empty chain")}</span>
                </span>
              </label>
              <button
                type="button"
                className={BTN}
                disabled={name === draft.activePreset}
                title={name === draft.activePreset ? t("deletePresetActive", undefined, "Select another preset before deleting this one") : undefined}
                aria-label={t("deletePreset", { name }, `Delete preset ${name}`)}
                data-testid={`delete-preset-${name}`}
                onClick={() => setDraft(withoutPreset(draft, name))}
              >
                {t("remove", undefined, "Remove")}
              </button>
            </div>
          ))}
        </fieldset>
        {noUsable && (
          <SettingsNotice
            tone="warning"
            role="status"
            testId="system-one-no-usable"
            actions={
              <>
                {!draft.allowOffMachine && chain.some((id) => views[id]?.offMachine) && (
                  <button type="button" className={BTN} onClick={() => setDraft({ ...draft, allowOffMachine: true })}>
                    {t("allowOffMachine", undefined, "Allow off-machine backends")}
                  </button>
                )}
                {draft.activePreset !== "local-only" && Object.hasOwn(draft.presets, "local-only") && (
                  <button type="button" className={BTN} onClick={() => setDraft({ ...draft, activePreset: "local-only" })}>
                    {t("switchToLocal", undefined, "Switch to local-only")}
                  </button>
                )}
              </>
            }
          >
            {t(
              "noUsable",
              { preset: draft.activePreset },
              `No backend in "${draft.activePreset}" can be used right now. Every question will return no-backend.`,
            )}
          </SettingsNotice>
        )}
        <h4 className={`${SUBHEAD} mt-1`}>{t("defaultChainFor", { preset: draft.activePreset }, `Default chain for ${draft.activePreset}`)}</h4>
        <p className="m-0 text-xs">
          {t("chainHint", undefined, "Backends are tried top to bottom; the first that answers wins. Consumers without an override use this chain.")}
        </p>
        <ChainEditor idPrefix="s1-default" chain={chain} draft={draft} views={views} onChange={(next) => setDraft(withPresetChain(draft, next))} />
      </SettingsGroup>

      <BackendsSection draft={draft} views={views} keys={keys} onDraft={setDraft} onRefresh={() => load(false).catch(() => {})} />

      <ConsumersSection
        consumers={consumers}
        draft={draft}
        views={views}
        calibration={data.config.calibration}
        revision={data.revision}
        onDraft={setDraft}
        onRefresh={() => load(false).catch(() => {})}
      />
    </section>
  );
}
