/**
 * Backend catalog rows: egress badge, kind/model/url, effective capabilities
 * (unknown shown as "unknown"), managed status (shape + text, never colour
 * alone) with Start/Stop/Log, write-only key entry, and an inline "Add
 * backend" form. Start/Stop and key entry act immediately — they are not Save
 * Bar sources (spec: system-one-settings-ui; design D13).
 * See change: add-system-one-registry.
 */
import { useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import type { Backend } from "@blackbelt-technology/pi-system-one";
import type React from "react";
import { useState } from "react";
import { ApiError, api, type BackendView, type Draft, type KeyStatus, type ManagedStatus } from "./api.js";
import { EgressBadge } from "./EgressBadge.js";

const smBtn =
  "rounded-md border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-2 py-0.5 text-[12px] text-[var(--text-primary)] hover:bg-[var(--bg-surface)] disabled:opacity-50 disabled:cursor-not-allowed min-h-6 max-sm:min-h-11";
const input =
  "w-full rounded border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-3 py-1.5 text-sm text-[var(--text-primary)]";

function kindLine(b: Backend): string {
  if (b.kind === "managed") return `managed ${b.engine}${b.checkpoint ? ` · ${b.checkpoint}` : ""}${b.port ? ` · port ${b.port}` : ""}`;
  if (b.kind === "http") return `http · ${b.model} · ${b.url}`;
  return `chat role ${b.role}`;
}

function StatusLine({ st }: { st: ManagedStatus }): React.ReactElement {
  const t = useT();
  const shape: Record<string, string> = {
    ready: "w-2 h-2 rounded-full bg-[var(--severity-success-fg)]",
    starting: "w-2 h-2 rotate-45 bg-[var(--status-working)]",
    installing: "w-2 h-2 rotate-45 bg-[var(--status-working)]",
    failed: "w-2 h-2 bg-[var(--severity-error-fg)]",
    stopped: "w-2 h-2 rounded-full border-2 border-[var(--text-secondary)]",
  };
  const label: Record<string, string> = {
    ready: t("stReady", undefined, "Ready"),
    starting: t("stStarting", undefined, "Starting (first run downloads the model)"),
    installing: t("stInstalling", undefined, "Installing engine"),
    failed: t("stFailed", undefined, "Failed"),
    stopped: t("stStopped", undefined, "Stopped"),
    unavailable: t("stUnavailable", undefined, "Unavailable: uv not on PATH"),
    "unsupported-platform": t("stUnsupported", undefined, "Unsupported on Windows"),
  };
  const meta = [
    st.reason,
    st.pid ? `PID ${st.pid}` : null,
    st.rssKb ? `${Math.round(st.rssKb / 1024)} MB` : null,
    st.uptimeMs ? t("uptime", { min: Math.round(st.uptimeMs / 60000) }, `up ${Math.round(st.uptimeMs / 60000)} min`) : null,
    st.lastHealthAt ? t("healthAt", { at: new Date(st.lastHealthAt).toLocaleTimeString() }, `health ${new Date(st.lastHealthAt).toLocaleTimeString()}`) : null,
  ].filter(Boolean);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]" data-testid="managed-status">
      <span className="inline-flex items-center gap-1.5 font-semibold text-[var(--text-primary)]">
        <span className={`inline-block shrink-0 ${shape[st.state] ?? "w-2.5 h-0.5 bg-[var(--text-secondary)]"}`} aria-hidden="true" />
        {label[st.state] ?? st.state}
      </span>
      {meta.length > 0 && <span className="text-[var(--text-secondary)]">{meta.join(" · ")}</span>}
    </div>
  );
}

function KeyEntry({ keyRef, status, onSaved }: { keyRef: string; status: KeyStatus | undefined; onSaved: () => void }): React.ReactElement {
  const t = useT();
  const [value, setValue] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const fieldId = `s1-key-${keyRef}`;
  if (status?.source === "env")
    return (
      <div className="flex flex-col gap-1 border-t border-[var(--border-subtle)] pt-1.5 text-[12px]" data-testid={`key-${keyRef}`}>
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
      className="flex flex-wrap items-end gap-2 border-t border-[var(--border-subtle)] pt-1.5"
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
          setErr(x instanceof ApiError ? x.code : "error");
        }
      }}
    >
      <span className="basis-full text-[12px]">
        <code>{keyRef}</code>{" "}
        <strong data-testid="key-state">{status?.set ? t("keySet", undefined, "set") : t("keyNotSet", undefined, "not set")}</strong>
        {status?.set ? ` · ${t("keyInFile", undefined, "stored in ~/.pi/agent/system-one/auth.json")}` : ""}
      </span>
      <div className="flex min-w-[12rem] flex-1 flex-col gap-1">
        <label className="text-[12px] font-semibold text-[var(--text-secondary)]" htmlFor={fieldId}>
          {status?.set ? t("replaceKey", undefined, "Replace key") : t("apiKey", undefined, "API key")}
        </label>
        <input id={fieldId} className={input} type="password" autoComplete="off" spellCheck={false} value={value} onChange={(e) => setValue(e.target.value)} />
      </div>
      <button type="submit" className={smBtn} disabled={!value}>
        {status?.set ? t("replaceKey", undefined, "Replace key") : t("saveKey", undefined, "Save key")}
      </button>
      <span className="basis-full text-[12px] text-[var(--text-secondary)]">
        {err ?? t("keyHint", undefined, "Saved immediately, not with the Save bar. The key is never shown again.")}
      </span>
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
  const idOk = BACKEND_ID.test(id) && !Object.hasOwn(draft.backends, id);
  let urlOk = true;
  try {
    urlOk = kind !== "http" || ["http:", "https:"].includes(new URL(url).protocol);
  } catch {
    urlOk = false;
  }
  const build = (): Backend | null => {
    if (kind === "managed") {
      const [eng, ckpt] = engine.split(":") as ["von" | "laya", string | undefined];
      return { kind, engine: eng, ...(ckpt ? { checkpoint: ckpt } : {}) };
    }
    if (kind === "http") return { kind, url, model };
    return { kind, role };
  };
  return (
    <details className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-tertiary)]" data-testid="add-backend">
      <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-[var(--text-primary)]">{t("addBackend", undefined, "Add backend")}</summary>
      <form
        className="flex flex-col gap-2 border-t border-[var(--border-subtle)] p-3"
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
          <legend className="text-[12px] font-semibold text-[var(--text-secondary)]">{t("kind", undefined, "Kind")}</legend>
          {(
            [
              ["managed", t("kindManaged", undefined, "Managed engine (the dashboard runs Von or Laya on this machine)")],
              ["http", t("kindHttp", undefined, "HTTP endpoint (a System-1 server you run, local or remote)")],
              ["llm", t("kindLlm", undefined, "Chat model role (slow fallback through a role such as @fast)")],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="radio" name="s1-kind" value={k} checked={kind === k} onChange={() => setKind(k)} />
              {label}
            </label>
          ))}
        </fieldset>
        <label className="flex flex-col gap-1 text-[12px] font-semibold text-[var(--text-secondary)]">
          {t("backendId", undefined, "Backend id")}
          <input className={input} value={id} spellCheck={false} onChange={(e) => setId(e.target.value)} aria-invalid={!!id && !idOk} />
        </label>
        {kind === "managed" && (
          <label className="flex flex-col gap-1 text-[12px] font-semibold text-[var(--text-secondary)]">
            {t("engine", undefined, "Engine")}
            <select className={input} value={engine} onChange={(e) => setEngine(e.target.value)}>
              <option value="von">von (von-1.2)</option>
              <option value="laya">laya (laya)</option>
              <option value="laya:laya-multilingual">laya (laya-multilingual)</option>
              <option value="laya:laya-typed-decisions">laya (laya-typed-decisions)</option>
            </select>
          </label>
        )}
        {kind === "http" && (
          <>
            <label className="flex flex-col gap-1 text-[12px] font-semibold text-[var(--text-secondary)]">
              {t("url", undefined, "URL")}
              <input className={input} value={url} spellCheck={false} onChange={(e) => setUrl(e.target.value)} aria-invalid={!!url && !urlOk} />
            </label>
            <label className="flex flex-col gap-1 text-[12px] font-semibold text-[var(--text-secondary)]">
              {t("model", undefined, "Model")}
              <input className={input} value={model} spellCheck={false} onChange={(e) => setModel(e.target.value)} />
            </label>
            <p className="m-0 text-[12px] text-[var(--text-secondary)]">
              {t("httpHint", undefined, "Only http and https. The URL's host decides on-machine vs off-machine. Unknown models get unknown capabilities.")}
            </p>
          </>
        )}
        {kind === "llm" && (
          <label className="flex flex-col gap-1 text-[12px] font-semibold text-[var(--text-secondary)]">
            {t("role", undefined, "Role")}
            <input className={input} value={role} spellCheck={false} onChange={(e) => setRole(e.target.value)} />
          </label>
        )}
        <div>
          <button type="submit" className={smBtn} disabled={!idOk || !urlOk}>
            {t("addBackend", undefined, "Add backend")}
          </button>
        </div>
      </form>
    </details>
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
    v == null ? <dd className="m-0 italic text-[var(--text-secondary)]">{t("unknown", undefined, "unknown")}</dd> : <dd className="m-0">{fmt(v)}</dd>;
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-[var(--border-secondary)] bg-[var(--bg-secondary)] px-4 py-3 shadow-[inset_0_1px_0_var(--elevation-rim),0_4px_8px_var(--shadow-card)]" aria-labelledby="s1-h-backends">
      <h3 id="s1-h-backends" className="m-0 text-sm font-semibold text-[var(--text-primary)]">
        {t("backends", undefined, "Backends")}
      </h3>
      {runtime === "unavailable" && (
        <div role="status" className="rounded-md border border-[var(--severity-warning-border)] bg-[var(--severity-warning-bg)] px-3 py-2 text-[13px] text-[var(--severity-warning-fg)]">
          {t("uvMissing", undefined, "Managed backends need uv. Install it (https://docs.astral.sh/uv/), then reload this page.")}
        </div>
      )}
      {runtime === "unsupported-platform" && (
        <div role="status" className="rounded-md border border-[var(--severity-info-border)] bg-[var(--severity-info-bg)] px-3 py-2 text-[13px] text-[var(--severity-info-fg)]">
          {t(
            "windowsNote",
            undefined,
            "Managed backends are not supported on Windows yet. Run Von or Laya yourself and add it as an HTTP endpoint. Prefer an environment variable for API keys on Windows.",
          )}
        </div>
      )}
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {Object.entries(draft.backends).map(([id, b]) => {
          const v = views[id];
          const st = v?.managed ?? null;
          const running = st?.state === "ready" || st?.state === "starting" || st?.state === "installing";
          const blocked = st?.state === "unavailable" || st?.state === "unsupported-platform";
          return (
            <li key={id} data-testid={`backend-${id}`} className="flex flex-col gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-[var(--text-primary)]">{id}</span>
                <EgressBadge view={v} />
                <span className="ml-auto flex flex-wrap gap-1.5">
                  {b.kind === "managed" && v && (
                    <button
                      type="button"
                      className={smBtn}
                      disabled={busy === id || blocked}
                      aria-label={running ? t("stopBackend", { id }, `Stop ${id}`) : t("startBackend", { id }, `Start ${id}`)}
                      onClick={() => managedAct(id, running ? "stop" : "start")}
                    >
                      {running ? t("stop", undefined, "Stop") : t("start", undefined, "Start")}
                    </button>
                  )}
                  <button
                    type="button"
                    className={smBtn}
                    aria-label={t("removeBackend", { id }, `Remove backend ${id}`)}
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
                </span>
              </div>
              <p className="m-0 break-all font-mono text-[12px] text-[var(--text-secondary)]">{kindLine(b)}</p>
              {st && <StatusLine st={st} />}
              {v && (
                <dl className="m-0 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-[var(--text-secondary)]">
                  <div className="flex gap-1">
                    <dt>{t("capContext", undefined, "context")}</dt>
                    {cap(v.capabilities.maxContextTokens, (n: number) => t("tokens", { n: n.toLocaleString() }, `${n.toLocaleString()} tokens`))}
                  </div>
                  <div className="flex gap-1">
                    <dt>{t("capOptions", undefined, "options")}</dt>
                    {cap(v.capabilities.maxOptions, String)}
                  </div>
                  <div className="flex gap-1">
                    <dt>{t("capLanguage", undefined, "language")}</dt>
                    {cap<string | string[]>(v.languageLabel ?? v.capabilities.languages, (x) => (Array.isArray(x) ? x.join(", ") : x))}
                  </div>
                  {v.priceUsdPerMTok != null && (
                    <div className="flex gap-1">
                      <dt>{t("capPrice", undefined, "price")}</dt>
                      <dd className="m-0">{t("priceEstimated", { p: v.priceUsdPerMTok }, `$${v.priceUsdPerMTok} / M tokens (estimated)`)}</dd>
                    </div>
                  )}
                </dl>
              )}
              {v?.keyRef && <KeyEntry keyRef={v.keyRef} status={keys[v.keyRef]} onSaved={onRefresh} />}
            </li>
          );
        })}
      </ul>
      <AddBackend draft={draft} onAdd={(id, b) => onDraft({ ...draft, backends: { ...draft.backends, [id]: b } })} />
    </section>
  );
}
