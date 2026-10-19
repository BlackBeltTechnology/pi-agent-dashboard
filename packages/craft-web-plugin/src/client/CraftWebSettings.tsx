/**
 * craft-web settings-section (Settings → Plugins → Craft Web Editors), lazy via the manifest `module`.
 * Per claimed app: enable switch + version channel (draft → host Save Bar → `plugin_config_write`, full
 * config so unknown keys round-trip), status pill, installed / latest versions, and an immediate
 * Download / Update action (disabled while the draft is dirty: prepare uses the SAVED channel).
 * See change: track-latest-craft-web-version (D4).
 */
import {
  SelectField,
  SettingsFacts,
  SettingsGroup,
  SettingsNotice,
  SettingsStatusPill,
  type SettingsStatusTone,
  ToggleField,
  useSettingsDraftSource,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import { usePluginConfig, usePluginSend } from "@blackbelt-technology/dashboard-plugin-runtime/context";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchCraftStatus, prepareCraftApp, type StatusOutcome } from "./craft-api.js";
import { CLAIMED_WEB_APP_IDS, CRAFT_WEB_APPS } from "./craft-apps-table.js";
import { type MsgKey, type Translate, useCraftT } from "./messages.js";
import { type CraftWebAppStatus, PREPARABLE } from "./status-types.js";
import { BTN_PRIMARY } from "./ui.js";

type Channel = "pinned" | "latest";
interface AppConfig {
  enabled?: boolean;
  version?: Channel;
}
interface CraftWebConfig {
  apps?: Record<string, AppConfig | undefined>;
  [key: string]: unknown;
}

/** Effective per-app values: an absent key equals its schema default (enabled, pinned). */
const effective = (a: AppConfig | undefined) => `${a?.enabled !== false}|${a?.version === "latest" ? "latest" : "pinned"}`;

/** True when any app's effective enable/channel differs. */
function appsDiffer(a: CraftWebConfig["apps"], b: CraftWebConfig["apps"]): boolean {
  const ids = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
  return [...ids].some((id) => effective(a?.[id]) !== effective(b?.[id]));
}

const REASON_KEY: Record<string, MsgKey> = {
  offline: "reasonOffline",
  "checksum-mismatch": "reasonChecksum",
  "extract-failed": "reasonExtract",
};
const reasonText = (t: Translate, reason: string) => t(REASON_KEY[reason] ?? "reasonUnknown");

/** Pill word + tone for one app status row. */
function statusPill(t: Translate, row: CraftWebAppStatus): [string, SettingsStatusTone] {
  const s = row.status;
  if (s === "ok") return [t("statusInstalled"), "success"];
  if (s === "not-prepared" || s === "shim-outdated") {
    return row.installedVersion ? [t("statusUpdate"), "info"] : [t("statusNotDownloaded"), "neutral"];
  }
  if (s === "disabled") return [t("statusDisabled"), "neutral"];
  if (s === "restart-required") return [t("statusRestart"), "warning"];
  if (REASON_KEY[s]) return [t("statusFailed", { reason: reasonText(t, s) }), "error"];
  return [t("statusUnavailable"), "neutral"];
}

/** Status once per mount and on every `reload()` (after prepare, after a saved config change). */
function useCraftStatus(config: unknown) {
  const [outcome, setOutcome] = useState<StatusOutcome | null>(null);
  const [key, setKey] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `config` and `key` are refetch triggers
  useEffect(() => {
    let alive = true;
    void fetchCraftStatus().then((o) => alive && setOutcome(o));
    return () => {
      alive = false;
    };
  }, [config, key]);
  return { outcome, reload: useCallback(() => setKey((k) => k + 1), []) };
}

/** Download / Update / Preparing label of the action button. */
function actionLabel(t: Translate, label: string, row: CraftWebAppStatus | undefined, running: boolean): string {
  if (running) return t("preparing", { app: label });
  if (row?.installedVersion && row.version) return t("updateTo", { version: row.version });
  return t("prepare", { app: label });
}

/** Installed version, plus the known latest in the latest channel. */
function VersionFacts({ id, t, row }: { id: string; t: Translate; row: CraftWebAppStatus }) {
  const rows: [string, ReactNode][] = [
    [t("settingsInstalled"), <span data-testid={`craft-web-${id}-installed`}>{row.installedVersion ?? t("statusNotDownloaded")}</span>],
  ];
  if (row.channel === "latest") {
    rows.push([t("settingsLatestKnown"), <span data-testid={`craft-web-${id}-latest`}>{row.latestVersion ?? t("settingsNotChecked")}</span>]);
  }
  return <SettingsFacts rows={rows} />;
}

function AppGroup({
  id,
  t,
  app,
  row,
  dirty,
  onChange,
  reload,
}: {
  id: string;
  t: Translate;
  app: AppConfig;
  row: CraftWebAppStatus | undefined;
  dirty: boolean;
  onChange: (patch: AppConfig) => void;
  reload: () => void;
}) {
  const label = CRAFT_WEB_APPS[id]?.label ?? id;
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pill = row ? statusPill(t, row) : null;
  const canPrepare = row !== undefined && PREPARABLE.has(row.status);

  const onPrepare = async () => {
    setRunning(true);
    setError(null);
    const res = await prepareCraftApp(id);
    setRunning(false);
    if (!res.ok) setError(t("prepareFailed", { app: label, reason: reasonText(t, res.reason) }));
    reload();
  };

  return (
    <SettingsGroup
      title={label}
      testId={`craft-web-${id}`}
      meta={
        pill ? (
          <SettingsStatusPill tone={pill[1]} testId={`craft-web-${id}-status`} status={row?.status}>
            {pill[0]}
          </SettingsStatusPill>
        ) : null
      }
    >
      <ToggleField
        label={t("settingsEnable", { app: label })}
        hint={t("settingsEnableHint", { app: label })}
        value={app.enabled !== false}
        onChange={(v) => onChange({ enabled: v })}
        testIds={{ control: `craft-web-${id}-enabled` }}
      />
      <SelectField
        label={t("settingsVersion")}
        hint={t("settingsVersionHint", { env: `${id.toUpperCase()}_WEB_VERSION` })}
        value={app.version === "latest" ? "latest" : "pinned"}
        options={[
          { value: "pinned", label: t("settingsPinned") },
          { value: "latest", label: t("settingsLatest") },
        ]}
        onChange={(v) => onChange({ version: v === "latest" ? "latest" : "pinned" })}
        testIds={{ control: `craft-web-${id}-version` }}
      />
      {row ? <VersionFacts id={id} t={t} row={row} /> : null}
      {canPrepare ? (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" data-testid={`craft-web-${id}-prepare`} className={BTN_PRIMARY} disabled={dirty || running} onClick={() => void onPrepare()}>
            {actionLabel(t, label, row, running)}
          </button>
          {dirty ? <span className="text-[12px] text-[var(--text-secondary)]">{t("saveFirst")}</span> : null}
        </div>
      ) : null}
      {error ? (
        <SettingsNotice tone="error" testId={`craft-web-${id}-error`}>
          {error}
        </SettingsNotice>
      ) : null}
    </SettingsGroup>
  );
}

export function CraftWebSettings() {
  const t = useCraftT();
  const config = usePluginConfig<CraftWebConfig>();
  const send = usePluginSend();
  const { outcome, reload } = useCraftStatus(config);

  // Spread the FULL loaded config so unknown keys round-trip a save.
  const base = useMemo<CraftWebConfig>(() => ({ ...(config ?? {}), apps: { ...(config?.apps ?? {}) } }), [config]);
  const [draft, setDraft] = useState<CraftWebConfig>(base);
  useEffect(() => setDraft(base), [base]);
  const isDirty = appsDiffer(draft.apps, base.apps);

  const draftRef = useRef(draft);
  draftRef.current = draft;
  const baseRef = useRef(base);
  baseRef.current = base;
  const commit = useCallback(async () => {
    await send({ type: "plugin_config_write", id: "craft-web", config: draftRef.current });
  }, [send]);
  const reset = useCallback(() => setDraft(baseRef.current), []);
  useSettingsDraftSource({ id: "plugin:craft-web", isDirty, commit, reset });

  const setApp = (id: string, patch: AppConfig) =>
    setDraft((d) => ({ ...d, apps: { ...(d.apps ?? {}), [id]: { ...(d.apps?.[id] ?? {}), ...patch } } }));

  const statusApps = outcome?.kind === "status" ? outcome.status.apps : null;
  const ids = statusApps ? Object.keys(statusApps).filter((id) => CRAFT_WEB_APPS[id]) : CLAIMED_WEB_APP_IDS;
  const notice =
    outcome?.kind === "restart-required" ? t("settingsStatusRestart") : outcome?.kind === "unreachable" ? t("settingsStatusUnreachable") : null;

  return (
    <section data-testid="craft-web-settings" className="space-y-3 text-xs text-[var(--text-secondary)]">
      {notice ? (
        <SettingsNotice tone={outcome?.kind === "restart-required" ? "warning" : "error"} testId="craft-web-status-notice" onRetry={reload} retryLabel={t("retry")}>
          {notice}
        </SettingsNotice>
      ) : null}
      {ids.map((id) => (
        <AppGroup
          key={id}
          id={id}
          t={t}
          app={draft.apps?.[id] ?? {}}
          row={statusApps?.[id]}
          dirty={isDirty}
          onChange={(patch) => setApp(id, patch)}
          reload={reload}
        />
      ))}
    </section>
  );
}
