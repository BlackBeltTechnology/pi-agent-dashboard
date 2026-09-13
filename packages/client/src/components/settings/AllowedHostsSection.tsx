/**
 * Settings ▸ Security ▸ Allowed hostnames — the operator surface of the
 * DNS-rebinding Host gate (design D8, mockups/security-allowed-hosts.html).
 *
 * Four parts, in order: the report/enforce mode control (segmented shape of
 * `GatewayProviderSection`; the consequence is stated inline, never through a
 * `window.confirm`), the read-only *Currently admitted* list, the
 * *Additional hostnames* editor, and *Recent refusals* with one-click Allow.
 *
 * Contracts:
 * - Admission is NEVER re-derived client-side: `admitted` + `recent` render
 *   from `GET /api/host-gate`; this module must not import a derive helper.
 * - The section issues NO write of its own: mode + hostnames edit the panel
 *   draft through the callbacks, and the panel Save persists them (a side
 *   `PUT` would be clobbered by the next Save, which writes `allowedHosts`
 *   whole).
 * - The textarea validates on blur with the SAME `isValidBareHostname` the
 *   gate parses with (shared from `packages/shared`), stating the exact fix
 *   (GOV.UK error pattern).
 * - A refusal whose hostname is in the editor's current DRAFT value is hidden
 *   at render, on every fetch.
 *
 * See change: add-host-allowlist-admission.
 */

import type {
  HostGateAdmittedRow,
  HostGateAdmittedSource,
  HostGateMode,
  HostGateResponse,
} from "@blackbelt-technology/pi-dashboard-shared/host-admission.js";
import { isValidBareHostname } from "@blackbelt-technology/pi-dashboard-shared/host-admission.js";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { getApiBase } from "../../lib/api/api-context.js";
import { useI18n } from "../../lib/i18n/i18n.js";

const HOST_GATE_ENDPOINT = "/api/host-gate";
/** Refusal-ring poll interval; "hidden rows" re-apply on every fetch (D8). */
const REFRESH_MS = 20_000;

const MODES: HostGateMode[] = ["report", "enforce"];

/** Fixed source order (design D1) — recognition over recall (NN/g #6). */
const SOURCE_ORDER: HostGateAdmittedSource[] = [
  "loopback",
  "ip-address",
  "bind-address",
  "local",
  "public-base-url",
  "cors-origin",
  "live-tunnel",
  "allowed-host",
];

type SourceGroup = "always" | "ip" | "gateway" | "additional";

const SOURCE_GROUP: Record<HostGateAdmittedSource, SourceGroup> = {
  loopback: "always",
  "bind-address": "always",
  local: "always",
  "ip-address": "ip",
  "public-base-url": "gateway",
  "cors-origin": "gateway",
  "live-tunnel": "gateway",
  "allowed-host": "additional",
};

const GROUP_ORDER: SourceGroup[] = ["always", "ip", "gateway", "additional"];

const GROUP_LABEL_KEY: Record<SourceGroup, string> = {
  always: "settings.hostGate.group.always",
  ip: "settings.hostGate.group.ip",
  gateway: "settings.hostGate.group.gateway",
  additional: "settings.hostGate.group.additional",
};

const GROUP_LABEL_FALLBACK: Record<SourceGroup, string> = {
  always: "Always",
  ip: "IP addresses",
  gateway: "From gateway URLs",
  additional: "Additional",
};

/** Settings page that owns a derived source; `undefined` = pattern / not editable. */
const SOURCE_PAGE: Partial<Record<HostGateAdmittedSource, string>> = {
  "bind-address": "/settings/server",
  "public-base-url": "/settings/gateway",
  "cors-origin": "/settings/gateway",
};

/** The pill copy per source (spec wording; the wire token is the key). */
const SOURCE_LABEL: Record<HostGateAdmittedSource, string> = {
  loopback: "loopback",
  "ip-address": "IP address",
  "bind-address": "bind address",
  local: ".local",
  "public-base-url": "public base URL",
  "cors-origin": "CORS origin",
  "live-tunnel": "live tunnel",
  "allowed-host": "allowed host",
};

interface Props {
  /** Panel draft `hostGate.mode`. */
  mode: HostGateMode;
  /** Panel draft `allowedHosts`. */
  allowedHosts: string[];
  onModeChange: (mode: HostGateMode) => void;
  onAllowedHostsChange: (hosts: string[]) => void;
  /** Route navigation for the derived-row source links. */
  onNavigate: (path: string) => void;
}

/**
 * The first textarea entry the gate could not admit, with the bare hostname
 * to enter instead when one can be derived (mockup's exact-fix rule).
 */
function findInvalidEntry(value: string): { entry: string; fix: string | null } | null {
  for (const raw of value.split("\n")) {
    const entry = raw.trim();
    if (!entry || isValidBareHostname(entry)) continue;
    if (/[:/]/.test(entry)) {
      // Scheme / port / path: strip them the way the mockup does, and only
      // offer the suggestion when the remainder is itself admittable.
      const fix = entry.replace(/^[A-Za-z][A-Za-z0-9+.-]*:\/\//, "").replace(/[:/].*$/, "");
      return { entry, fix: isValidBareHostname(fix) ? fix : null };
    }
    return { entry, fix: null };
  }
  return null;
}

export function AllowedHostsSection({
  mode,
  allowedHosts,
  onModeChange,
  onAllowedHostsChange,
  onNavigate,
}: Props) {
  const { t } = useI18n();
  const extraId = useId();
  const helpId = useId();
  const errId = useId();

  const [gate, setGate] = useState<HostGateResponse | null>(null);
  const [gateFailed, setGateFailed] = useState(false);
  const [extraError, setExtraError] = useState<string | null>(null);
  // Local textarea text. The panel draft filters empty entries, so binding the
  // textarea straight to `allowedHosts` would eat the trailing newline the
  // operator just typed (Enter). Re-sync only when the draft changes from
  // OUTSIDE (the Allow button), comparing parsed forms so a mid-edit trailing
  // newline survives. (CodeRabbit review.)
  const [extraText, setExtraText] = useState(() => allowedHosts.join("\n"));
  const joinedDraft = allowedHosts.join("\n");
  const parsedExtra = extraText
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .join("\n");
  useEffect(() => {
    if (joinedDraft !== parsedExtra) setExtraText(joinedDraft);
  }, [joinedDraft, parsedExtra]);

  const fetchGate = useCallback(async () => {
    try {
      const res = await fetch(`${getApiBase()}${HOST_GATE_ENDPOINT}`);
      if (!res.ok) {
        setGateFailed(true);
        return;
      }
      setGate((await res.json()) as HostGateResponse);
      setGateFailed(false);
    } catch {
      setGateFailed(true);
    }
  }, []);

  useEffect(() => {
    void fetchGate();
    const id = setInterval(() => void fetchGate(), REFRESH_MS);
    return () => clearInterval(id);
  }, [fetchGate]);

  const sourceLabel = useCallback(
    (source: HostGateAdmittedSource): string =>
      t(`settings.hostGate.source.${source}`, undefined, SOURCE_LABEL[source]),
    [t],
  );

  /** Sorted in the fixed D1 source order, then grouped for the group labels. */
  const grouped = useMemo(() => {
    const rows = [...(gate?.admitted ?? [])].sort(
      (a: HostGateAdmittedRow, b: HostGateAdmittedRow) =>
        SOURCE_ORDER.indexOf(a.source) - SOURCE_ORDER.indexOf(b.source),
    );
    return GROUP_ORDER.map((group) => ({
      group,
      rows: rows.filter((r) => SOURCE_GROUP[r.source] === group),
    })).filter((g) => g.rows.length > 0);
  }, [gate]);

  /** Hostnames in the editor's current value, compared case-insensitively. */
  const draftSet = useMemo(() => new Set(allowedHosts.map((h) => h.toLowerCase())), [allowedHosts]);
  const visibleRecent = useMemo(
    () => (gate?.recent ?? []).filter((r) => !draftSet.has(r.host.toLowerCase())),
    [gate, draftSet],
  );

  // While the env var overrides the mode, the control shows the SERVER's mode
  // and refuses edits — the file would be inert until the var goes away.
  const envOverridden = gate?.envOverridden === true;
  const displayedMode = envOverridden ? (gate?.mode ?? mode) : mode;

  const validateExtra = (value: string) => {
    const bad = findInvalidEntry(value);
    if (!bad) {
      setExtraError(null);
      return;
    }
    setExtraError(
      bad.fix !== null
        ? t(
            "settings.hostGate.errNotBare",
            { entry: bad.entry, fix: bad.fix },
            '"{entry}" is not a bare hostname. Enter {fix} instead.',
          )
        : t(
            "settings.hostGate.errCannotUse",
            { entry: bad.entry },
            "{entry} cannot be used as an allowed host; enter a bare hostname (letters, digits, hyphens, dots).",
          ),
    );
  };

  const loadFailed = t("settings.hostGate.loadFailed", undefined, `Failed to load ${HOST_GATE_ENDPOINT}.`);

  return (
    <section data-testid="allowed-hosts-section">
      <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3 pb-1 border-b border-[var(--border-secondary)]">
        {t("settings.hostGate.title", undefined, "Allowed hostnames")}
      </h2>
      <div className="space-y-3">
        <p className="max-w-[56ch] text-xs text-[var(--text-secondary)]">
          {t(
            "settings.hostGate.intro",
            undefined,
            "The dashboard answers only to requests whose Host header names one of these. This stops a DNS-rebinding page from reaching it through your own browser.",
          )}
        </p>

        {/* 1. Mode — segmented shape of GatewayProviderSection; the consequence
            is stated inline, with no confirm dialog (Gateway/AGENTS.md rule). */}
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
            {t("settings.hostGate.mode", undefined, "Mode")}
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            <div
              className="flex flex-wrap gap-1.5"
              role="radiogroup"
              aria-label={t("settings.hostGate.aria.mode", undefined, "Host gate mode")}
            >
              {MODES.map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={displayedMode === m}
                  disabled={envOverridden}
                  data-testid={`host-gate-mode-${m}`}
                  onClick={() => onModeChange(m)}
                  className={`rounded-lg border px-3 py-1.5 text-[12.5px] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                    displayedMode === m
                      ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--text-primary)]"
                      : "border-[var(--border-primary)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  {m === "report"
                    ? t("settings.hostGate.mode.report", undefined, "Report only")
                    : t("settings.hostGate.mode.enforce", undefined, "Enforce")}
                </button>
              ))}
            </div>
            <p
              className={`text-xs ${
                displayedMode === "enforce"
                  ? "text-[var(--severity-success-fg)]"
                  : "text-[var(--severity-warning-fg)]"
              }`}
            >
              {displayedMode === "enforce"
                ? t(
                    "settings.hostGate.consequence.enforce",
                    undefined,
                    "Unlisted hosts get 403. Everything under Currently admitted keeps working.",
                  )
                : t(
                    "settings.hostGate.consequence.report",
                    undefined,
                    "Unlisted hosts are logged and still served. Check Recent refusals below, then switch to Enforce.",
                  )}
            </p>
          </div>
          {envOverridden && (
            <p className="mt-2 text-[11px] text-[var(--text-secondary)]">
              {t(
                "settings.hostGate.envOverride",
                undefined,
                "Set by the environment variable PI_DASHBOARD_HOST_GATE; unset it to change the mode here.",
              )}
            </p>
          )}
        </div>

        {/* 2. Currently admitted — read-only, derived server-side; rows link to
            their source page instead of offering a remove (D2: one home per name). */}
        <div>
          <p className="text-xs font-medium text-[var(--text-secondary)] mb-1">
            {t("settings.hostGate.admitted", undefined, "Currently admitted")}{" "}
            <span className="text-[var(--text-tertiary)]">
              ({t("settings.hostGate.admittedHint", undefined, "derived; edit at the source")})
            </span>
          </p>
          {gateFailed ? (
            <p className="text-xs text-[var(--severity-error-fg)]">{loadFailed}</p>
          ) : (
            grouped.map(({ group, rows }) => (
              <div key={group} data-testid="host-gate-admitted" className="mb-1">
                <p className="px-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
                  {t(GROUP_LABEL_KEY[group], undefined, GROUP_LABEL_FALLBACK[group])}
                </p>
                <ul className="rounded border border-[var(--border-secondary)] divide-y divide-[var(--border-secondary)]">
                  {rows.map((row) => {
                    const page = SOURCE_PAGE[row.source];
                    return (
                      <li
                        key={`${row.source}:${row.host}`}
                        data-testid="host-gate-admitted-row"
                        className="flex items-center gap-2 px-2.5 py-1.5"
                      >
                        <code className="flex-1 truncate font-mono text-[11.5px] text-[var(--text-secondary)]">
                          {row.host}
                        </code>
                        <span
                          className={`rounded border px-1.5 py-px text-[9.5px] ${
                            row.source === "live-tunnel"
                              ? "border-[var(--severity-info-border)] bg-[var(--severity-info-bg)] text-[var(--severity-info-fg)]"
                              : "border-[var(--severity-neutral-border)] bg-[var(--severity-neutral-bg)] text-[var(--severity-neutral-fg)]"
                          }`}
                        >
                          {sourceLabel(row.source)}
                        </span>
                        {page && (
                          <button
                            type="button"
                            onClick={() => onNavigate(page)}
                            className="rounded px-1 text-[10.5px] text-[var(--text-secondary)] underline hover:text-[var(--text-primary)]"
                          >
                            {page === "/settings/gateway"
                              ? t("settings.hostGate.editGateway", undefined, "Gateway ▸")
                              : t("settings.hostGate.editServer", undefined, "Server ▸")}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
        </div>

        {/* 3. Additional hostnames — the Allowed Users field contract; validates
            on blur with the gate's own regex, stating the exact fix. */}
        <div>
          <label htmlFor={extraId} className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
            {t("settings.hostGate.extra", undefined, "Additional hostnames")}{" "}
            <span className="text-[var(--text-tertiary)]">
              ({t("settings.hostGate.extraHint", undefined, "one per line, bare hostname, no scheme or port")})
            </span>
          </label>
          <textarea
            id={extraId}
            data-testid="host-gate-extra"
            rows={3}
            spellCheck={false}
            aria-invalid={extraError ? "true" : undefined}
            aria-describedby={extraError ? `${helpId} ${errId}` : helpId}
            className={`w-full bg-[var(--bg-secondary)] border rounded px-2 py-1.5 text-sm text-[var(--text-primary)] font-mono resize-y ${
              extraError ? "border-[var(--severity-error-border)]" : "border-[var(--border-secondary)]"
            }`}
            placeholder={"dash.home.arpa\nproxy-int.corp"}
            value={extraText}
            onChange={(e) => {
              const raw = e.target.value;
              setExtraText(raw);
              setExtraError(null); // re-validated on the next blur
              onAllowedHostsChange(raw.split("\n").map((s) => s.trim()).filter(Boolean));
            }}
            onBlur={(e) => validateExtra(e.target.value)}
          />
          <p id={helpId} className="text-[11px] text-[var(--text-tertiary)]">
            {t(
              "settings.hostGate.extraHelp",
              undefined,
              "For names not covered above, such as a reverse-proxy name. A gateway URL's host never needs to be repeated here.",
            )}
          </p>
          {extraError && (
            <p id={errId} data-testid="host-gate-extra-error" className="text-xs text-[var(--severity-error-fg)]">
              {extraError}
            </p>
          )}
        </div>

        {/* 4. Recent refusals — the refusal ring; Allow appends to the draft
            allow-list (persisted by the panel Save, never a side write). */}
        <div>
          <p className="text-xs font-medium text-[var(--text-secondary)] mb-1">
            {t("settings.hostGate.recent", undefined, "Recent refusals")}{" "}
            <span className="text-[var(--text-tertiary)]">
              ({t("settings.hostGate.recentHint", undefined, "since server start")})
            </span>
          </p>
          {gateFailed ? (
            <p className="text-xs text-[var(--severity-error-fg)]">{loadFailed}</p>
          ) : gate && visibleRecent.length === 0 ? (
            <p data-testid="host-gate-recent-empty" className="text-xs text-[var(--text-secondary)]">
              {t("settings.hostGate.recentEmpty", undefined, "No refusals since start.")}
            </p>
          ) : (
            gate && (
              <ul
                data-testid="host-gate-recent"
                className="rounded border border-[var(--border-secondary)] divide-y divide-[var(--border-secondary)]"
              >
                {visibleRecent.map((entry) => (
                  <li
                    key={entry.host}
                    data-testid="host-gate-recent-row"
                    className="flex items-center gap-2 px-2.5 py-1.5"
                  >
                    <code className="flex-1 truncate font-mono text-[11.5px] text-[var(--text-secondary)]">
                      {entry.host}
                    </code>
                    <span className="whitespace-nowrap text-[10px] text-[var(--text-secondary)]">
                      {t(
                        "settings.hostGate.refusalMeta",
                        {
                          count: entry.count,
                          time: new Date(entry.lastSeen).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
                        },
                        "{count}× · last seen {time}",
                      )}
                    </span>
                    <span
                      className={`whitespace-nowrap rounded border px-1.5 py-px text-[9.5px] ${
                        entry.outcome === "refused"
                          ? "border-[var(--severity-error-border)] bg-[var(--severity-error-bg)] text-[var(--severity-error-fg)]"
                          : "border-[var(--severity-warning-border)] bg-[var(--severity-warning-bg)] text-[var(--severity-warning-fg)]"
                      }`}
                    >
                      {entry.outcome}
                    </span>
                    <button
                      type="button"
                      aria-label={t("settings.hostGate.allow", { host: entry.host }, "Allow {host}")}
                      onClick={() => {
                        if (!draftSet.has(entry.host.toLowerCase())) {
                          onAllowedHostsChange([...allowedHosts, entry.host]);
                        }
                      }}
                      className="rounded border border-[var(--border-primary)] px-3 py-1.5 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]"
                    >
                      {t("settings.hostGate.allowAction", undefined, "Allow")}
                    </button>
                  </li>
                ))}
              </ul>
            )
          )}
          <p className="text-[11px] text-[var(--text-tertiary)]">
            {t(
              "settings.hostGate.recentHelp",
              undefined,
              "Allow adds the name to Additional hostnames. Names you do not recognise are the reason this gate exists; leave them.",
            )}
          </p>
        </div>
      </div>
    </section>
  );
}
