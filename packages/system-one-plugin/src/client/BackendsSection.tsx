/**
 * Backend catalog (the "Backends" settings group): one kit item per backend —
 * egress pill, kind line, managed status pill (a word, never colour alone) with
 * Start/Stop, effective capabilities (unknown shown as "unknown"), write-only
 * key entry inside the item — plus an inline "Add backend" form whose id/URL
 * errors are visible and linked to the field. Remove is a danger action named
 * after the backend. Start/Stop and key entry act immediately — they are not
 * Save Bar sources (spec: system-one-settings-ui; design D13).
 * See change: add-system-one-registry; retro-ux-plugin-settings-wave-2.
 */
import {
  SelectField,
  SettingsCopyButton,
  SettingsFacts,
  SettingsGroup,
  SettingsItem,
  SettingsNotice,
  SettingsStatusPill,
  type SettingsStatusTone,
  TextField,
  useT,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import type { Backend } from "@blackbelt-technology/pi-system-one";
import type React from "react";
import { useState } from "react";
import { ApiError, api, type BackendView, type Draft, type KeyStatus, type ManagedStatus } from "./api.js";
import { EgressBadge } from "./EgressBadge.js";
import { BTN, BTN_DANGER } from "./settings-ui.js";

function kindLine(b: Backend): string {
  if (b.kind === "managed") return `managed ${b.engine}${b.checkpoint ? ` · ${b.checkpoint}` : ""}${b.port ? ` · port ${b.port}` : ""}`;
  if (b.kind === "http") return `http · ${b.model} · ${b.url}`;
  return `chat role ${b.role}`;
}

const STATE_TONE: Record<string, SettingsStatusTone> = {
  ready: "success",
  starting: "info",
  installing: "info",
  failed: "error",
  stopped: "neutral",
  unavailable: "warning",
  "unsupported-platform": "info",
};

function StatusLine({ st }: { st: ManagedStatus }): React.ReactElement {
  const t = useT();
  const label: Record<string, string> = {
    ready: t("stReady", undefined, "Ready"),
    starting: t("stStarting", undefined, "Starting"),
    installing: t("stInstalling", undefined, "Installing engine"),
    failed: t("stFailed", undefined, "Failed"),
    stopped: t("stStopped", undefined, "Stopped"),
    unavailable: t("stUnavailable", undefined, "Unavailable: uv not on PATH"),
    "unsupported-platform": t("stUnsupported", undefined, "Unsupported on Windows"),
  };
  const meta = [
    st.state === "starting" ? t("stStartingNote", undefined, "first run downloads the model") : null,
    st.reason,
    st.pid ? `PID ${st.pid}` : null,
    st.rssKb ? `${Math.round(st.rssKb / 1024)} MB` : null,
    st.uptimeMs ? t("uptime", { min: Math.round(st.uptimeMs / 60000) }, `up ${Math.round(st.uptimeMs / 60000)} min`) : null,
    st.lastHealthAt ? t("healthAt", { at: new Date(st.lastHealthAt).toLocaleTimeString() }, `health ${new Date(st.lastHealthAt).toLocaleTimeString()}`) : null,
  ].filter(Boolean);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" data-testid="managed-status">
      <SettingsStatusPill tone={STATE_TONE[st.state] ?? "neutral"} status={st.state}>
        {label[st.state] ?? st.state}
      </SettingsStatusPill>
      {meta.length > 0 && <span className="text-[var(--text-secondary)]">{meta.join(" · ")}</span>}
    </div>
  );
}

function KeyEntry({ keyRef, status, onSaved }: { keyRef: string; status: KeyStatus | undefined; onSaved: () => void }): React.ReactElement {
  const t = useT();
  const [value, setValue] = useState("");
  const [err, setErr] = useState<{ code: string } | null>(null);
  if (status?.source === "env")
    return (
      <div className="flex flex-col gap-1 border-t border-[var(--border-subtle)] pt-2 text-xs" data-testid={`key-${keyRef}`}>
        <span>
          <code>{keyRef}</code> {t("keySetEnv", undefined, "set · from environment variable")}
        </span>
        <span className="text-[var(--text-secondary)]">
          {t("keyEnvHint", undefined, "To change it, edit your shell environment and restart the dashboard.")}
        </span>
      </div>
    );
  return (
    <form
      className="flex flex-col gap-2 border-t border-[var(--border-subtle)] pt-2"
      data-testid={`key-${keyRef}`}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!value) return;
        try {
          await api.setKey(keyRef, value);
          setValue("");
          setErr(null);
          onSaved();
        } catch (x) {
          setErr({ code: x instanceof ApiError ? x.code : "unknown" });
        }
      }}
    >
      <span className="flex flex-wrap items-center gap-1.5 text-xs">
        <code>{keyRef}</code>
        <SettingsStatusPill tone={status?.set ? "success" : "neutral"} testId="key-state">
          {status?.set ? t("keySet", undefined, "set") : t("keyNotSet", undefined, "not set")}
        </SettingsStatusPill>
        {status?.set ? <span>{t("keyInFile", undefined, "stored in ~/.pi/agent/system-one/auth.json")}</span> : null}
      </span>
      <TextField
        label={status?.set ? t("replaceKey", undefined, "Replace key") : t("apiKey", undefined, "API key")}
        type="password"
        mono
        value={value}
        onChange={setValue}
        hint={t("keyHint", undefined, "Saved immediately, not with the Save bar. The key is never shown again.")}
        error={err ? t("keySaveFailed", undefined, "The key could not be saved. Check it and try again.") : null}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className={BTN} disabled={!value}>
          {status?.set ? t("replaceKey", undefined, "Replace key") : t("saveKey", undefined, "Save key")}
        </button>
        {err ? <SettingsCopyButton text={err.code} label={t("copyDetails", undefined, "Copy details")} /> : null}
      </div>
    </form>
  );
}

const BACKEND_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function AddBackend({ draft, onAdd }: { draft: Draft; onAdd: (id: string, b: Backend) => void }): React.ReactElement {
  const t = useT();
  const [kind, setKind] = useState<"managed" | "http" | "llm">("managed");
  const [id, setId] = useState("");
  const [engine, setEngine] = useState("von");
  const [url, setUrl] = useState("");
  const [model, setModel] = useState("");
  const [role, setRole] = useState("@fast");
  const idFormatOk = BACKEND_ID.test(id);
  const idTaken = idFormatOk && Object.hasOwn(draft.backends, id);
  const idOk = idFormatOk && !idTaken;
  let urlOk = true;
  try {
    urlOk = kind !== "http" || ["http:", "https:"].includes(new URL(url).protocol);
  } catch {
    urlOk = false;
  }
  const idError = !id
    ? null
    : !idFormatOk
      ? t("idInvalid", undefined, "Start with a letter or digit, then use letters, digits, dots, dashes or underscores (up to 64 characters).")
      : idTaken
        ? t("idTaken", undefined, "This id is already used by another backend.")
        : null;
  const urlError = kind === "http" && url && !urlOk ? t("urlInvalid", undefined, "Only http and https addresses are allowed.") : null;
  const build = (): Backend | null => {
    if (kind === "managed") {
      const [eng, ckpt] = engine.split(":") as ["von" | "laya", string | undefined];
      return { kind, engine: eng, ...(ckpt ? { checkpoint: ckpt } : {}) };
    }
    if (kind === "http") return { kind, url, model };
    return { kind, role };
  };
  return (
    <SettingsGroup title={t("addBackend", undefined, "Add backend")} defaultOpen={false} testId="add-backend">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          const b = build();
          if (b && idOk && urlOk) {
            onAdd(id, b);
            setId("");
          }
        }}
      >
        <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
          <legend className="text-xs font-semibold text-[var(--text-primary)]">{t("kind", undefined, "Kind")}</legend>
          {(
            [
              ["managed", t("kindManaged", undefined, "Managed engine (the dashboard runs Von or Laya on this machine)")],
              ["http", t("kindHttp", undefined, "HTTP endpoint (a System-1 server you run, local or remote)")],
              ["llm", t("kindLlm", undefined, "Chat model role (slow fallback through a role such as @fast)")],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="flex cursor-pointer items-center gap-2 text-xs text-[var(--text-primary)]">
              <input type="radio" name="s1-kind" value={k} checked={kind === k} onChange={() => setKind(k)} />
              {label}
            </label>
          ))}
        </fieldset>
        <TextField label={t("backendId", undefined, "Backend id")} mono value={id} onChange={setId} hint={null} error={idError} />
        {kind === "managed" && (
          <SelectField
            label={t("engine", undefined, "Engine")}
            hint={null}
            value={engine}
            onChange={setEngine}
            options={[
              { value: "von", label: "von (von-1.2)" },
              { value: "laya", label: "laya (laya)" },
              { value: "laya:laya-multilingual", label: "laya (laya-multilingual)" },
              { value: "laya:laya-typed-decisions", label: "laya (laya-typed-decisions)" },
            ]}
          />
        )}
        {kind === "http" && (
          <>
            <TextField
              label={t("url", undefined, "URL")}
              mono
              value={url}
              onChange={setUrl}
              hint={t("httpHint", undefined, "The URL's host decides on-machine vs off-machine. Unknown models get unknown capabilities.")}
              error={urlError}
            />
            <TextField label={t("model", undefined, "Model")} mono value={model} onChange={setModel} hint={null} />
          </>
        )}
        {kind === "llm" && <TextField label={t("role", undefined, "Role")} mono value={role} onChange={setRole} hint={null} />}
        <div>
          <button type="submit" className={BTN} disabled={!idOk || !urlOk}>
            {t("addBackend", undefined, "Add backend")}
          </button>
        </div>
      </form>
    </SettingsGroup>
  );
}

export interface BackendsSectionProps {
  draft: Draft;
  views: Record<string, BackendView>;
  keys: Record<string, KeyStatus>;
  onDraft: (d: Draft) => void;
  onRefresh: () => void;
}

export function BackendsSection({ draft, views, keys, onDraft, onRefresh }: BackendsSectionProps): React.ReactElement {
  const t = useT();
  const [busy, setBusy] = useState<string | null>(null);
  const runtime = Object.values(views).find((v) => v.managed?.state === "unavailable" || v.managed?.state === "unsupported-platform")?.managed
    ?.state;
  const managedAct = async (id: string, action: "start" | "stop") => {
    setBusy(id);
    try {
      await api.managed(id, action);
    } finally {
      setBusy(null);
      onRefresh();
    }
  };
  const cap = <T,>(v: T | null | undefined, fmt: (x: T) => string) =>
    v == null ? <i className="text-[var(--text-secondary)]">{t("unknown", undefined, "unknown")}</i> : fmt(v);
  return (
    <SettingsGroup title={<span id="s1-h-backends">{t("backends", undefined, "Backends")}</span>} defaultOpen>
      {runtime === "unavailable" && (
        <SettingsNotice tone="warning" role="status">
          {t("uvMissing", undefined, "Managed backends need uv. Install it (https://docs.astral.sh/uv/), then reload this page.")}
        </SettingsNotice>
      )}
      {runtime === "unsupported-platform" && (
        <SettingsNotice tone="info" role="status">
          {t(
            "windowsNote",
            undefined,
            "Managed backends are not supported on Windows yet. Run Von or Laya yourself and add it as an HTTP endpoint. Prefer an environment variable for API keys on Windows.",
          )}
        </SettingsNotice>
      )}
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {Object.entries(draft.backends).map(([id, b]) => {
          const v = views[id];
          const st = v?.managed ?? null;
          const running = st?.state === "ready" || st?.state === "starting" || st?.state === "installing";
          const blocked = st?.state === "unavailable" || st?.state === "unsupported-platform";
          return (
            <li key={id}>
              <SettingsItem
                testId={`backend-${id}`}
                title={id}
                subtitle={<code className="break-all font-mono">{kindLine(b)}</code>}
                status={<EgressBadge view={v} />}
                actions={
                  <>
                    {b.kind === "managed" && v && (
                      <button
                        type="button"
                        className={BTN}
                        disabled={busy === id || blocked}
                        aria-label={running ? t("stopBackend", { id }, `Stop ${id}`) : t("startBackend", { id }, `Start ${id}`)}
                        onClick={() => managedAct(id, running ? "stop" : "start")}
                      >
                        {running ? t("stop", undefined, "Stop") : t("start", undefined, "Start")}
                      </button>
                    )}
                    <button
                      type="button"
                      className={BTN_DANGER}
                      aria-label={t("removeBackend", { id }, `Remove ${id}`)}
                      onClick={() => {
                        const backends = { ...draft.backends };
                        delete backends[id];
                        const presets = Object.fromEntries(
                          Object.entries(draft.presets).map(([n, p]) => [
                            n,
                            {
                              ...p,
                              chain: p.chain.filter((x) => x !== id),
                              ...(p.consumers
                                ? { consumers: Object.fromEntries(Object.entries(p.consumers).map(([c, o]) => [c, { chain: o.chain.filter((x) => x !== id) }])) }
                                : {}),
                            },
                          ]),
                        );
                        onDraft({ ...draft, backends, presets });
                      }}
                    >
                      {t("remove", undefined, "Remove")}
                    </button>
                  </>
                }
              >
                {st && <StatusLine st={st} />}
                {v && (
                  <SettingsFacts
                    rows={[
                      [t("capContext", undefined, "context"), cap(v.capabilities.maxContextTokens, (n: number) => t("tokens", { n: n.toLocaleString() }, `${n.toLocaleString()} tokens`))],
                      [t("capOptions", undefined, "options"), cap(v.capabilities.maxOptions, String)],
                      [
                        t("capLanguage", undefined, "language"),
                        cap<string | string[]>(v.languageLabel ?? v.capabilities.languages, (x) => (Array.isArray(x) ? x.join(", ") : x)),
                      ],
                      ...(v.priceUsdPerMTok != null
                        ? ([[t("capPrice", undefined, "price"), t("priceEstimated", { p: v.priceUsdPerMTok }, `$${v.priceUsdPerMTok} / M tokens (estimated)`)]] as const)
                        : []),
                    ]}
                  />
                )}
                {v?.keyRef && <KeyEntry keyRef={v.keyRef} status={keys[v.keyRef]} onSaved={onRefresh} />}
              </SettingsItem>
            </li>
          );
        })}
      </ul>
      <AddBackend draft={draft} onAdd={(id, b) => onDraft({ ...draft, backends: { ...draft.backends, [id]: b } })} />
    </SettingsGroup>
  );
}
