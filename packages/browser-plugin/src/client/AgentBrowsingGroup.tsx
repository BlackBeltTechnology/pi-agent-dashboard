/**
 * "Agent browsing" settings group (change: add-dedicated-agent-browser, task
 * 7.1 / spec `browser-plugin-settings` "Agent browsing settings group").
 *
 * Controls the policy `browser_connect` applies: default browser (dedicated /
 * one of my Chrome profiles / headless), what to do when it is unavailable,
 * idle disconnect, connections per profile, live view and the global allowed
 * domains. Every change is one partial `PUT /api/browser/settings` issued by
 * the parent (`onChange`).
 *
 * The dedicated choice is disabled while `status.dedicated.available` is false;
 * the real-profile choice while the host cannot open Chrome or no profile has
 * the extension. While the relay is disabled the whole group is read-only with
 * the reason (the server refuses every write then).
 */
import { useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import type React from "react";
import { useEffect, useId, useState } from "react";
import type {
  AgentBrowsingSettings,
  BrowserRouteProfile,
  BrowserSettingsPatch,
  RelayConfig,
} from "./browser-api.js";
import { GROUP, HELP, INPUT, Notice, Pill, Seg } from "./settings-ui.js";

const DEFAULT_SETTINGS: AgentBrowsingSettings = {
  defaultBrowser: "@dedicated",
  onUnavailable: "ask",
  idleDisconnectMinutes: 30,
  allowMultipleInstancesPerProfile: false,
  openLiveViewOnConnect: true,
  allowedDomains: [],
};

/** Effective values: defaults < plugin config < `status.settings` < not-yet-echoed local writes. */
export function resolveAgentSettings(
  config: RelayConfig,
  fromStatus: Partial<AgentBrowsingSettings> | undefined,
  overrides: Partial<AgentBrowsingSettings>,
): AgentBrowsingSettings {
  const fromConfig: Partial<AgentBrowsingSettings> = {
    defaultBrowser: config.defaultBrowser,
    realProfile: config.realProfile,
    onUnavailable: config.onUnavailable,
    idleDisconnectMinutes: config.idleDisconnectMinutes,
    allowMultipleInstancesPerProfile: config.allowMultipleInstancesPerProfile,
    openLiveViewOnConnect: config.openLiveViewOnConnect,
    allowedDomains: config.allowedDomains,
  };
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const layer of [fromConfig, fromStatus ?? {}, overrides]) {
    for (const [key, value] of Object.entries(layer)) {
      if (value !== undefined) out[key] = value;
    }
  }
  return out as unknown as AgentBrowsingSettings;
}

/** Parse the comma-separated domains editor into a clean list. */
function parseDomains(draft: string): string[] {
  return draft
    .split(",")
    .map((d) => d.trim())
    .filter((d) => d.length > 0);
}

type Choice = "dedicated" | "real" | "headless";

export interface AgentBrowsingGroupProps {
  settings: AgentBrowsingSettings;
  /** Relay `enabled`; false = read-only with the reason. */
  enabled: boolean;
  canOpenChrome: boolean;
  dedicatedAvailable: boolean;
  /** Profiles with `installed: true` (incl. synthetic live rows). */
  installedProfiles: readonly BrowserRouteProfile[];
  /** The last write was rejected (alert shown; the parent restored the stored value). */
  error: boolean;
  onChange: (patch: BrowserSettingsPatch) => void;
}

export function AgentBrowsingGroup({
  settings,
  enabled,
  canOpenChrome,
  dedicatedAvailable,
  installedProfiles,
  error,
  onChange,
}: AgentBrowsingGroupProps): React.ReactElement {
  const t = useT();
  const ids = useId();
  const readOnly = !enabled;

  const choice: Choice =
    settings.defaultBrowser === "@dedicated" ? "dedicated" : settings.defaultBrowser === "@headless" ? "headless" : "real";

  const installedDirs = installedProfiles.map((p) => p.profileDirectory);
  const pickerValue =
    [settings.realProfile, choice === "real" ? settings.defaultBrowser : undefined].find(
      (dir) => dir !== undefined && installedDirs.includes(dir),
    ) ?? installedDirs[0];

  const realDisabled = readOnly || !canOpenChrome || installedProfiles.length === 0;
  const dedicatedDisabled = readOnly || !dedicatedAvailable;

  const [domainsDraft, setDomainsDraft] = useState(settings.allowedDomains.join(", "));
  const savedDomains = settings.allowedDomains.join(", ");
  useEffect(() => setDomainsDraft(savedDomains), [savedDomains]);

  const pickProfile = (dir: string) => onChange({ defaultBrowser: dir, realProfile: dir });

  return (
    <section data-testid="browser-agent-browsing" aria-labelledby={`${ids}-h`} className={GROUP}>
      <h3 id={`${ids}-h`} className="text-[13px] font-semibold text-[var(--text-primary)]">
        {t("agentBrowsingTitle", undefined, "Agent browsing")}
      </h3>

      {readOnly && (
        <p data-testid="browser-agent-browsing-disabled" className={HELP}>
          {t("relayDisabled", undefined, "Browser relay disabled")}
        </p>
      )}
      {error && (
        <Notice tone="warn" role="alert" testId="browser-agent-browsing-error">
          {t("agentBrowsingError", undefined, "The setting could not be saved. The previous value was restored.")}
        </Notice>
      )}

      <Row label={t("defaultBrowserLabel", undefined, "Default browser")} labelId={`${ids}-default`}>
        <fieldset aria-labelledby={`${ids}-default`} className="space-y-2 min-w-0">
          <ChoiceCard
            id={`${ids}-ded`}
            name={`${ids}-default-choice`}
            testId="browser-default-dedicated"
            checked={choice === "dedicated"}
            disabled={dedicatedDisabled}
            onSelect={() => onChange({ defaultBrowser: "@dedicated" })}
            title={
              <>
                {t("defaultDedicatedTitle", undefined, "Dedicated agent profile")}{" "}
                <Pill tone="info">{t("recommended", undefined, "Recommended")}</Pill>
              </>
            }
            help={t(
              "defaultDedicatedHelp",
              undefined,
              "A separate Chrome window only the agent uses. You sign in once; works on login pages.",
            )}
          />
          <ChoiceCard
            id={`${ids}-real`}
            name={`${ids}-default-choice`}
            testId="browser-default-real"
            checked={choice === "real"}
            disabled={realDisabled}
            onSelect={() => pickerValue && pickProfile(pickerValue)}
            title={t("defaultRealTitle", undefined, "One of my Chrome profiles")}
            help={t(
              "defaultRealHelp",
              undefined,
              "Uses your real logins. Pages with a password manager field disconnect the agent.",
            )}
          >
            <select
              data-testid="browser-real-profile-select"
              aria-label={t("realProfilePicker", undefined, "Chrome profile for the agent")}
              className={`${INPUT} mt-2 max-w-xs`}
              disabled={realDisabled}
              value={pickerValue ?? ""}
              onChange={(e) => pickProfile(e.target.value)}
            >
              {installedProfiles.map((p) => (
                <option key={p.profileDirectory} value={p.profileDirectory}>
                  {`${p.email ?? p.label} (${p.profileDirectory})`}
                </option>
              ))}
            </select>
          </ChoiceCard>
          <ChoiceCard
            id={`${ids}-headless`}
            name={`${ids}-default-choice`}
            testId="browser-default-headless"
            checked={choice === "headless"}
            disabled={readOnly}
            onSelect={() => onChange({ defaultBrowser: "@headless" })}
            title={t("defaultHeadlessTitle", undefined, "Headless, no logins")}
            help={t("defaultHeadlessHelp", undefined, "Fast and isolated. For public pages and tests only.")}
          />
        </fieldset>
      </Row>

      <Row label={t("onUnavailableLabel", undefined, "If it is unavailable")} labelId={`${ids}-fb`}>
        <Seg
          labelledBy={`${ids}-fb`}
          value={settings.onUnavailable}
          disabled={readOnly}
          onChange={(onUnavailable) => onChange({ onUnavailable })}
          options={[
            { value: "ask", label: t("onUnavailableAsk", undefined, "Ask me"), testId: "browser-on-unavailable-ask" },
            { value: "next", label: t("onUnavailableNext", undefined, "Try the next browser"), testId: "browser-on-unavailable-next" },
            { value: "stop", label: t("onUnavailableStop", undefined, "Stop the task"), testId: "browser-on-unavailable-stop" },
          ]}
        />
        <p className={`${HELP} mt-1`}>
          {t(
            "onUnavailableHelp",
            undefined,
            "Order from your default: dedicated profile, then the chosen Chrome profile, then headless (a headless default stays headless). The session always says which browser it used; a task that needs logins stops instead of going headless.",
          )}
        </p>
      </Row>

      <Row label={t("idleLabel", undefined, "Disconnect when idle")} labelFor={`${ids}-idle`}>
        <select
          id={`${ids}-idle`}
          data-testid="browser-idle-select"
          className={`${INPUT} w-auto`}
          disabled={readOnly}
          value={String(settings.idleDisconnectMinutes)}
          onChange={(e) => onChange({ idleDisconnectMinutes: Number(e.target.value) as AgentBrowsingSettings["idleDisconnectMinutes"] })}
        >
          <option value="5">{t("idle5", undefined, "After 5 minutes")}</option>
          <option value="30">{t("idle30", undefined, "After 30 minutes")}</option>
          <option value="120">{t("idle120", undefined, "After 2 hours")}</option>
          <option value="0">{t("idleNever", undefined, "Never")}</option>
        </select>
        <p className={`${HELP} mt-1`}>
          {t("idleHelp", undefined, "Closes the agent's tabs and frees the browser when no session has used it.")}
        </p>
      </Row>

      <Row label={t("multiLabel", undefined, "Connections per Chrome profile")} labelId={`${ids}-multi`}>
        <Seg
          labelledBy={`${ids}-multi`}
          value={settings.allowMultipleInstancesPerProfile ? "several" : "one"}
          disabled={readOnly}
          onChange={(v) => onChange({ allowMultipleInstancesPerProfile: v === "several" })}
          options={[
            { value: "one", label: t("multiOne", undefined, "One at a time"), testId: "browser-multi-one" },
            { value: "several", label: t("multiSeveral", undefined, "Several sessions"), testId: "browser-multi-several" },
          ]}
        />
        <p className={`${HELP} mt-1`}>
          {t(
            "multiHelp",
            undefined,
            "With several, each session gets its own tab group. The dedicated profile always serves one session at a time.",
          )}
        </p>
      </Row>

      <Row label={t("liveViewLabel", undefined, "Live view")} labelId={`${ids}-live`}>
        <label className="flex items-start gap-2 text-xs text-[var(--text-secondary)]">
          <input
            type="checkbox"
            data-testid="browser-live-view"
            aria-labelledby={`${ids}-live`}
            className="mt-0.5"
            disabled={readOnly}
            checked={settings.openLiveViewOnConnect}
            onChange={(e) => onChange({ openLiveViewOnConnect: e.target.checked })}
          />
          <span>
            {t("liveViewOption", undefined, "Open the browser tab in the session's pane when the agent connects")}
          </span>
        </label>
      </Row>

      <Row label={t("globalDomainsLabel", undefined, "Allowed domains")} labelFor={`${ids}-domains`}>
        <input
          id={`${ids}-domains`}
          data-testid="browser-global-domains"
          className={INPUT}
          disabled={readOnly}
          placeholder={t("globalDomainsPlaceholder", undefined, "Any domain")}
          value={domainsDraft}
          onChange={(e) => setDomainsDraft(e.target.value)}
          onBlur={() => {
            const next = parseDomains(domainsDraft);
            if (next.join(", ") !== savedDomains) onChange({ allowedDomains: next });
          }}
        />
        <p className={`${HELP} mt-1`}>
          {t(
            "globalDomainsHelp",
            undefined,
            "Comma separated, for example google.com, github.com. Applies to every browser unless a profile sets its own. Guards address-bar navigation and new tabs only; scripts, link clicks and redirects can still leave the list.",
          )}
        </p>
      </Row>
    </section>
  );
}

function Row({
  label,
  labelId,
  labelFor,
  children,
}: {
  label: string;
  labelId?: string;
  labelFor?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="grid grid-cols-1 gap-1 md:grid-cols-[12rem_1fr] md:gap-x-4 items-start">
      {labelFor ? (
        <label htmlFor={labelFor} className="pt-1 text-[13px] text-[var(--text-primary)]">
          {label}
        </label>
      ) : (
        <div id={labelId} className="pt-1 text-[13px] text-[var(--text-primary)]">
          {label}
        </div>
      )}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function ChoiceCard({
  id,
  name,
  testId,
  checked,
  disabled,
  onSelect,
  title,
  help,
  children,
}: {
  id: string;
  name: string;
  testId: string;
  checked: boolean;
  disabled: boolean;
  onSelect: () => void;
  title: React.ReactNode;
  help: string;
  children?: React.ReactNode;
}): React.ReactElement {
  return (
    <div
      className={`rounded-lg border px-3 py-2.5 ${
        checked
          ? "border-[var(--accent-primary)] ring-1 ring-[var(--accent-primary)] bg-[var(--accent-soft)]"
          : "border-[var(--border-secondary)] bg-[var(--bg-tertiary)]"
      } ${disabled ? "opacity-60" : ""}`}
    >
      <div className="flex items-start gap-2">
        <input
          id={id}
          type="radio"
          name={name}
          data-testid={testId}
          aria-describedby={`${id}-help`}
          className="mt-0.5 accent-[var(--accent-primary)]"
          checked={checked}
          disabled={disabled}
          onChange={onSelect}
        />
        <div className="min-w-0 flex-1">
          <label htmlFor={id} className={`block ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}>
            <span className="block text-[13px] font-medium text-[var(--text-primary)]">{title}</span>
          </label>
          <div id={`${id}-help`} className={HELP}>
            {help}
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
