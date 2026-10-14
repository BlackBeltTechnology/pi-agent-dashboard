/**
 * Settings → Vault (change: add-credential-vault; retro-ux-credential-vault).
 *
 * Hub-owned credentials: accounts, env bindings (variables), per-project grants, checkout
 * confirmations, plugin read approvals and a non-destructive import. The page never receives a
 * stored value: listings carry ids, labels, names and states.
 *
 * Structure: an APG tablist (Variables / Accounts / Import; automatic activation; the selected tab
 * is component state, not the URL). All three tabpanels stay mounted: an inactive one is `hidden`,
 * so a half-typed form survives a tab switch. States: loading skeleton, first-run guide, a stale
 * server callout (a 2xx non-JSON reply), network / transport messages, the corrupt callout that
 * disables every write, and `OperateRequiredCallout` for a 403 with remedies.
 *
 * Styling: theme tokens only — no raw hex, no raw px, no z-index.
 */
import { mdiAlertCircleOutline, mdiArrowRight, mdiCogOutline, mdiFileImportOutline, mdiFolderOutline, mdiKeyVariant, mdiPlus, mdiRefresh, mdiShieldCheckOutline } from "@mdi/js";
import { type KeyboardEvent, useCallback, useEffect, useId, useRef, useState } from "react";
import { getApiBase } from "../../../lib/api/api-context.js";
import { t as i18nT } from "../../../lib/i18n/i18n.js";
import { fetchVault, type ImportCandidate, listImportCandidates, type VaultOverview } from "../../../lib/vault/vault-api.js";
import { OperateRequiredCallout } from "./OperateRequiredCallout.js";
import { VaultAccountsPanel } from "./VaultAccountsPanel.js";
import { VaultImportPanel } from "./VaultImportPanel.js";
import { VaultVariablesTab } from "./VaultVariablesTab.js";
import { BUTTON_CLASS, Callout, GHOST_BUTTON_CLASS, HELP_CLASS, INSET_CLASS, PRIMARY_BUTTON_CLASS, VIcon } from "./vault-ui.js";

type TabId = "variables" | "accounts" | "import";
const TAB_ORDER: TabId[] = ["variables", "accounts", "import"];
/** Panel testids: `vault-panel-bindings|accounts|import` are protected (design D1). */
const PANEL_TESTID: Record<TabId, string> = { variables: "vault-panel-bindings", accounts: "vault-panel-accounts", import: "vault-panel-import" };

type Restart = { phase: "idle" } | { phase: "busy" } | { phase: "requested" } | { phase: "refused"; message: string };

/** Same action as the Settings header: POST /api/restart. A dropped socket means the restart is underway. */
function useServerRestart() {
  const [restart, setRestart] = useState<Restart>({ phase: "idle" });
  const restartServer = async () => {
    setRestart({ phase: "busy" });
    try {
      const res = await fetch(`${getApiBase()}/api/restart`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; success?: boolean; error?: string; message?: string };
      const refused = !res.ok || body.ok === false || body.success === false;
      setRestart(refused ? { phase: "refused", message: body.message ?? body.error ?? `HTTP ${res.status}` } : { phase: "requested" });
    } catch {
      setRestart({ phase: "requested" });
    }
  };
  return { restart, restartServer };
}

function StaleServerCallout({ restart, retrying, onRestart, onRetry }: { restart: Restart; retrying: boolean; onRestart: () => void; onRetry: () => void }) {
  return (
    <Callout tone="error" icon={mdiAlertCircleOutline} role="alert" testId="vault-error">
      <strong>{i18nT("vault.serverOutdated", undefined, "This dashboard server doesn't have the vault yet.")}</strong>{" "}
      {i18nT("vault.serverOutdatedHint", undefined, "The page is newer than the running server. Restart the server to load the vault.")}
      {restart.phase === "refused" && (
        <p className="mt-1" role="alert">
          {restart.message}
        </p>
      )}
      {restart.phase === "requested" && (
        <p className="mt-1" role="status" data-testid="vault-restarting">
          {i18nT("vault.restarting", undefined, "Server restarting… Try again in a few seconds.")}
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className={BUTTON_CLASS} disabled={restart.phase === "busy"} onClick={onRestart}>
          <VIcon path={mdiRefresh} size={0.6} />
          {i18nT("vault.restartServer", undefined, "Restart server")}
        </button>
        <button type="button" className={GHOST_BUTTON_CLASS} disabled={retrying} onClick={onRetry}>
          {i18nT("vault.tryAgain", undefined, "Try again")}
        </button>
      </div>
    </Callout>
  );
}

function FirstRunGuide({ keyFiles, onImport, onAdd }: { keyFiles: number; onImport: () => void; onAdd: () => void }) {
  return (
    <div className={`${INSET_CLASS} space-y-3`} data-testid="vault-empty">
      <div>
        <h3 className="m-0 text-sm font-semibold text-[var(--text-primary)]">{i18nT("vault.firstRun.title", undefined, "Set up your first key")}</h3>
        <p className={`${HELP_CLASS} mt-1`}>{i18nT("vault.firstRun.lead", undefined, "Three steps. Nothing reaches a session before step 3.")}</p>
      </div>
      <ol className="m-0 list-decimal space-y-2 pl-5 text-xs text-[var(--text-primary)]">
        <li>
          <div className="font-semibold">{i18nT("vault.firstRun.step1", undefined, "Add or import a key")}</div>
          <div className={HELP_CLASS}>{i18nT("vault.firstRun.step1Hint", undefined, "Paste a key or import one from a .env file you already have.")}</div>
        </li>
        <li>
          <div className="font-semibold">{i18nT("vault.firstRun.step2", undefined, "Expose it as a variable")}</div>
          <div className={HELP_CLASS}>{i18nT("vault.firstRun.step2Hint", undefined, "Choose the name sessions see, such as GEMINI_API_KEY.")}</div>
        </li>
        <li>
          <div className="font-semibold">{i18nT("vault.firstRun.step3", undefined, "Grant it to a project")}</div>
          <div className={HELP_CLASS}>{i18nT("vault.firstRun.step3Hint", undefined, "Pick a project from your open sessions.")}</div>
        </li>
      </ol>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          data-testid="vault-first-run-import"
          className={keyFiles > 0 ? PRIMARY_BUTTON_CLASS : BUTTON_CLASS}
          onClick={onImport}
        >
          <VIcon path={mdiFileImportOutline} size={0.6} />
          {i18nT("vault.firstRun.import", undefined, "Import keys")}
        </button>
        <button
          type="button"
          data-testid="vault-first-run-add"
          className={keyFiles > 0 ? BUTTON_CLASS : PRIMARY_BUTTON_CLASS}
          onClick={onAdd}
        >
          <VIcon path={mdiPlus} size={0.6} />
          {i18nT("vault.firstRun.add", undefined, "Add a key")}
        </button>
      </div>
      {keyFiles > 0 && (
        <p className={HELP_CLASS}>
          {keyFiles === 1
            ? i18nT("vault.firstRun.filesOne", undefined, "1 key file found on this dashboard.")
            : i18nT("vault.firstRun.filesMany", { count: keyFiles }, "{count} key files found on this dashboard.")}
        </p>
      )}
    </div>
  );
}

function tabForKey(key: string, current: TabId): TabId | undefined {
  const i = TAB_ORDER.indexOf(current);
  const n = TAB_ORDER.length;
  const moves: Record<string, number> = { ArrowRight: (i + 1) % n, ArrowLeft: (i + n - 1) % n, Home: 0, End: n - 1 };
  return key in moves ? TAB_ORDER[moves[key]] : undefined;
}

export function VaultSection() {
  const ids = useId();
  const [overview, setOverview] = useState<VaultOverview | null>(null);
  const [candidates, setCandidates] = useState<ImportCandidate[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** The server answered an /api route with HTML: it predates the vault. */
  const [stale, setStale] = useState(false);
  /** Remedies of an `operate_required` refusal; null when the load did not fail that way. */
  const [operateRemedies, setOperateRemedies] = useState<unknown[] | null>(null);
  const [retrying, setRetrying] = useState(false);
  const { restart, restartServer } = useServerRestart();
  const [tab, setTab] = useState<TabId>("variables");
  const [addRequest, setAddRequest] = useState(0);
  const retryInFlight = useRef(false);
  const tabRefs = useRef<Record<TabId, HTMLButtonElement | null>>({ variables: null, accounts: null, import: null });

  const reload = useCallback(async () => {
    const res = await fetchVault();
    if (res.ok && res.data) setOverview(res.data);
    const operate = res.code === "operate_required" && res.remedies ? res.remedies : null;
    const failed = !(res.ok && res.data);
    // An older server sends no `remedies` on operate_required: it falls through to the plain line.
    setOperateRemedies(failed ? operate : null);
    setStale(failed && res.code === "server_outdated");
    setLoadError(failed && !operate && res.code !== "server_outdated" ? (res.error ?? `HTTP ${res.status}`) : null);
  }, []);

  // Single-flight: one activation issues at most one request.
  const retry = useCallback(async () => {
    if (retryInFlight.current) return;
    retryInFlight.current = true;
    setRetrying(true);
    try {
      await reload();
    } finally {
      retryInFlight.current = false;
      setRetrying(false);
    }
  }, [reload]);

  useEffect(() => {
    void reload();
  }, [reload]);
  // The import candidates decide which first-run action is primary, so they load with the page.
  useEffect(() => {
    void listImportCandidates().then((res) => setCandidates(res.ok && Array.isArray(res.data) ? res.data : []));
  }, []);

  const selectTab = (next: TabId, focus = false) => {
    setTab(next);
    if (focus) tabRefs.current[next]?.focus();
  };
  const onTabKeyDown = (e: KeyboardEvent<HTMLButtonElement>, current: TabId) => {
    const target = tabForKey(e.key, current);
    if (!target) return;
    e.preventDefault();
    selectTab(target, true);
  };

  const ready = overview !== null && candidates !== null;
  const loading = !ready && !loadError && !stale && !operateRemedies;
  const corrupt = overview?.status.state === "corrupt";
  const firstRun = ready && !corrupt && overview.accounts.length === 0 && overview.bindings.length === 0;
  const keyFiles = (candidates ?? []).filter((c) => c.exists).length;

  const tabLabel: Record<TabId, { label: string; icon: string; count?: number }> = {
    variables: { label: i18nT("vault.tab.variables", undefined, "Variables"), icon: mdiCogOutline, count: overview?.bindings.length },
    accounts: { label: i18nT("vault.tab.accounts", undefined, "Accounts"), icon: mdiKeyVariant, count: overview?.accounts.length },
    import: { label: i18nT("vault.tab.import", undefined, "Import"), icon: mdiFileImportOutline },
  };

  const flow: Array<[string, string, string]> = [
    ["vault.flow.account", "Account", mdiKeyVariant],
    ["vault.flow.variable", "Variable", mdiCogOutline],
    ["vault.flow.grant", "Project grant", mdiFolderOutline],
    ["vault.flow.session", "Session env", mdiShieldCheckOutline],
  ];

  return (
    <div data-testid="vault-section" className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-[var(--text-primary)]">{i18nT("vault.title", undefined, "Credential vault")}</h2>
        <p className={`${HELP_CLASS} mt-1 max-w-[72ch]`}>
          {i18nT(
            "vault.description",
            undefined,
            "Keys live on this dashboard and are never shown again after you save them. A session gets a key only when its project is granted that key.",
          )}
        </p>
        <ol aria-label={i18nT("vault.flow.label", undefined, "How a key reaches a session")} className="m-0 mt-2 flex list-none flex-wrap items-center gap-1.5 p-0">
          {flow.map(([key, fallback, icon], i) => (
            <li key={key} className="flex items-center gap-1.5">
              {i > 0 && <VIcon path={mdiArrowRight} size={0.6} className="text-[var(--text-secondary)]" />}
              <span className="inline-flex items-center gap-1 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] px-2 py-1 text-xs font-semibold text-[var(--text-primary)]">
                <VIcon path={icon} size={0.6} />
                {i18nT(key, undefined, fallback)}
              </span>
            </li>
          ))}
        </ol>
        <p className={`${HELP_CLASS} mt-1.5`} data-testid="vault-scoping-note">
          {i18nT(
            "vault.scopingNote",
            undefined,
            "Grants decide which sessions get a key. They don't protect a key from other code running in that project.",
          )}
        </p>
      </div>

      {operateRemedies && <OperateRequiredCallout remedies={operateRemedies} busy={retrying} onRetry={retry} />}

      {stale && <StaleServerCallout restart={restart} retrying={retrying} onRestart={() => void restartServer()} onRetry={() => void retry()} />}

      {loadError && (
        <div data-testid="vault-error" role="alert" className="text-sm text-[var(--severity-error-fg)]">
          {i18nT("vault.loadFailed", { error: loadError }, "Couldn't load the vault: {error}")}
        </div>
      )}

      {corrupt && (
        <Callout tone="error" icon={mdiAlertCircleOutline} role="alert" testId="vault-corrupt">
          <strong>{i18nT("vault.corruptTitle", undefined, "The vault file is damaged, so changes are refused.")}</strong>{" "}
          {i18nT(
            "vault.corrupt",
            { backup: overview?.status.backup ?? "none" },
            "A byte-exact copy was kept at {backup}. Sessions keep the keys they already have for a limited time.",
          )}
        </Callout>
      )}

      {loading && (
        <div data-testid="vault-loading" aria-busy="true" aria-label={i18nT("vault.loading", undefined, "Loading the vault")} className="space-y-2">
          <div className="h-10 animate-pulse rounded-md bg-[var(--bg-tertiary)] motion-reduce:animate-none" />
          <div className="h-24 animate-pulse rounded-md bg-[var(--bg-tertiary)] motion-reduce:animate-none" />
        </div>
      )}

      {ready && (
        <>
          <div role="tablist" aria-label={i18nT("vault.tablistLabel", undefined, "Vault")} className="flex flex-wrap gap-1 border-b border-[var(--border-secondary)]">
            {TAB_ORDER.map((id) => {
              const { label, icon, count } = tabLabel[id];
              const active = tab === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  id={`${ids}-tab-${id}`}
                  data-testid={`vault-tab-${id}`}
                  ref={(el) => {
                    tabRefs.current[id] = el;
                  }}
                  aria-selected={active}
                  aria-controls={`${ids}-panel-${id}`}
                  tabIndex={active ? 0 : -1}
                  onClick={() => selectTab(id)}
                  onKeyDown={(e) => onTabKeyDown(e, id)}
                  className={`focus-ring -mb-px inline-flex min-h-[36px] items-center gap-1.5 border-b-2 px-3 text-sm font-semibold max-sm:min-h-[44px] ${active ? "border-[var(--accent-primary)] text-[var(--text-primary)]" : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"}`}
                >
                  <VIcon path={icon} size={0.65} />
                  {label}
                  {count !== undefined && (
                    <span className="rounded-full bg-[var(--bg-tertiary)] px-1.5 text-xs text-[var(--text-secondary)]">{count}</span>
                  )}
                </button>
              );
            })}
          </div>

          <div
            role="tabpanel"
            id={`${ids}-panel-variables`}
            aria-labelledby={`${ids}-tab-variables`}
            data-testid={PANEL_TESTID.variables}
            hidden={tab !== "variables"}
          >
            {firstRun ? (
              <FirstRunGuide
                keyFiles={keyFiles}
                onImport={() => selectTab("import", true)}
                onAdd={() => {
                  selectTab("accounts", true);
                  setAddRequest((n) => n + 1);
                }}
              />
            ) : (
              <VaultVariablesTab overview={overview} onChanged={reload} />
            )}
          </div>
          <div
            role="tabpanel"
            id={`${ids}-panel-accounts`}
            aria-labelledby={`${ids}-tab-accounts`}
            data-testid={PANEL_TESTID.accounts}
            hidden={tab !== "accounts"}
          >
            <VaultAccountsPanel overview={overview} onChanged={reload} addRequest={addRequest} />
          </div>
          <div
            role="tabpanel"
            id={`${ids}-panel-import`}
            aria-labelledby={`${ids}-tab-import`}
            data-testid={PANEL_TESTID.import}
            hidden={tab !== "import"}
          >
            <VaultImportPanel overview={overview} candidates={candidates} onChanged={reload} onGoToVariables={() => selectTab("variables", true)} />
          </div>
        </>
      )}
    </div>
  );
}
