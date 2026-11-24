/**
 * "Advanced: organisation sign-in" — collapsed by default. Only for companies whose Google Workspace admin blocks
 * pi-dashboard.dev or requires its own Google Cloud client: the clients list (label, project, client id, domains,
 * accounts, the redirect URI a Web client must register) and "Add organisation sign-in" (name, company domain,
 * client file) with the guided Google Cloud setup (manual wizard + automatic setup) folded inside.
 * See change: add-google-connect.
 */
import { SettingsNotice, SettingsStatusPill, TextField, useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import { useId, useRef, useState } from "react";
import { type Audience, type SetupRunView, WIZARD_STEP_OF } from "../shared/auto-setup.js";
import { normalizeDomain, validateClientJson } from "../shared/client-json.js";
import { AutoSetupSection } from "./AutoSetup.js";
import { errorText } from "./connect-errors.js";
import { Disclosure } from "./Disclosure.js";
import { SetupWizard } from "./SetupWizard.js";
import type { ClientSummary, GoogleState } from "./types.js";
import { api, btn, chip, errorText as errorCls, muted, selectCls } from "./ui.js";
import { errorStep, type WizardStep } from "./wizard.js";

const JSON_ERROR_EN: Record<string, [key: string, en: string]> = {
  not_json: ["errNotJson", "That file is not valid JSON. Choose the client_secret_*.json you downloaded."],
  not_installed: ["errNotInstalled", "No Desktop or Web client in this file. Create an OAuth client of type Desktop app or Web application and download its JSON."],
  ambiguous_client: ["errAmbiguousClient", "This file has both a Desktop and a Web client. Download the JSON of one client."],
  bad_client_id: ["errBadClientId", "The client id does not end in .apps.googleusercontent.com."],
  missing_secret: ["errMissingSecret", "The file has no client secret. Download it again from the client page."],
};

function ClientRow({ c, state, onChanged }: { c: ClientSummary; state: GoogleState; onChanged: () => void }) {
  const t = useT();
  const ids = useId();
  const [domains, setDomains] = useState(c.domains.join(", "));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inUse = c.accounts > 0;
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (err) {
      setError((err as { code?: string }).code ?? (err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const saveDomains = () => {
    const list = domains
      .split(/[,\s]+/)
      .filter(Boolean)
      .map((d) => normalizeDomain(d) ?? d);
    return act(() => api(`/clients/${encodeURIComponent(c.id)}`, { method: "PATCH", body: JSON.stringify({ domains: list }) }));
  };
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-[var(--border-secondary)] p-3" data-testid="google-client-row" data-client={c.id}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1">
          <span className="block break-words text-sm font-semibold text-[var(--text-primary)]">{c.label}</span>
          <span className="block break-all font-mono text-[11px] text-[var(--text-secondary)]">{c.clientId}</span>
          {c.projectId && <span className={`${muted} block`}>{t("projectOf", { id: c.projectId }, `project ${c.projectId}`)}</span>}
        </span>
        {c.domains.map((d) => (
          <span key={d} className={chip}>
            {d}
          </span>
        ))}
        <SettingsStatusPill tone="neutral">{t("clientAccounts", { n: c.accounts }, `${c.accounts} ${c.accounts === 1 ? "account" : "accounts"}`)}</SettingsStatusPill>
      </div>
      {c.type === "web" && state.webRedirectUri && (
        <div className="flex flex-col gap-1" data-testid="google-client-redirect-block">
          <span className={muted}>{t("redirectLead", undefined, "Register this redirect URI on the Web client in Google Cloud:")}</span>
          <code className="break-all rounded bg-[var(--bg-tertiary)] px-2 py-1 font-mono text-[12px] text-[var(--text-primary)]" data-testid="google-client-redirect">
            {state.webRedirectUri}
          </code>
        </div>
      )}
      {c.type === "web" && !state.webRedirectUri && (
        <span className={muted} data-testid="google-client-redirect-unknown">
          {t("redirectUnknown", undefined, "The dashboard's public address is not set, so the redirect URI to register is unknown.")}
        </span>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <input
          className={selectCls}
          aria-label={t("domainsFor", { label: c.label }, `Domains for ${c.label}`)}
          placeholder="example.com"
          value={domains}
          onChange={(e) => setDomains(e.target.value)}
        />
        <button type="button" className={btn} disabled={busy} aria-label={t("saveDomainsFor", { label: c.label }, `Save domains for ${c.label}`)} onClick={() => void saveDomains()}>
          {t("save", undefined, "Save")}
        </button>
        <button
          type="button"
          className={btn}
          data-testid="google-client-remove"
          disabled={busy || inUse}
          aria-label={t("removeClient", { label: c.label }, `Remove ${c.label}`)}
          aria-describedby={inUse ? `${ids}-inuse` : undefined}
          onClick={() => void act(() => api(`/clients/${encodeURIComponent(c.id)}`, { method: "DELETE" }))}
        >
          {t("remove", undefined, "Remove")}
        </button>
        {inUse && (
          <span id={`${ids}-inuse`} className={muted}>
            {t("clientInUse", undefined, "Accounts use this sign-in: disconnect them first.")}
          </span>
        )}
      </div>
      {error && (
        <div role="alert" className={errorCls} data-testid="google-client-error">
          {domainError(t, error)}
        </div>
      )}
    </div>
  );
}

function domainError(t: ReturnType<typeof useT>, code: string): string {
  if (code === "domain_taken") return t("errDomainTaken", undefined, "Another organisation sign-in already uses this domain.");
  if (code === "invalid_domain") return t("errInvalidDomain", undefined, "Enter a company domain such as example.com.");
  if (code === "client_in_use") return t("clientInUse", undefined, "Accounts use this sign-in: disconnect them first.");
  return errorText(t, code);
}

interface AddFormProps {
  state: GoogleState;
  prefillDomain?: string;
  onAdded: () => void;
  onCancel: () => void;
  onAudience: (a: Audience) => void;
  onRefresh: () => void;
}

function AddForm({ state, prefillDomain, onAdded, onCancel, onAudience, onRefresh }: AddFormProps) {
  const t = useT();
  const [label, setLabel] = useState("");
  const [domain, setDomain] = useState(prefillDomain ?? "");
  const [owner, setOwner] = useState("");
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [domainErr, setDomainErr] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [handoff, setHandoff] = useState<SetupRunView | null>(null);
  const [wizardFocus, setWizardFocus] = useState<WizardStep | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const pick = async (f: File) => {
    const text = await f.text();
    const parsed = validateClientJson(text);
    if (!parsed.ok) {
      const [key, en] = JSON_ERROR_EN[parsed.error] ?? ["errNotJson", ""];
      setFile(null);
      setFileError(t(key, undefined, en));
      setWizardFocus(errorStep(parsed.error));
      return;
    }
    setFileError(null);
    setWizardFocus(null);
    setFile({ name: f.name, text });
  };

  const submit = async () => {
    setDomainErr(null);
    setFormError(null);
    const dom = domain.trim() ? normalizeDomain(domain) : undefined;
    if (domain.trim() && !dom) {
      setDomainErr(domainError(t, "invalid_domain"));
      return;
    }
    if (!file) {
      setFileError(t("errNoFile", undefined, "Choose the client_secret_*.json file first."));
      return;
    }
    setBusy(true);
    try {
      await api("/clients", {
        method: "PUT",
        body: JSON.stringify({ json: JSON.parse(file.text), ...(label.trim() ? { label: label.trim() } : {}), ...(dom ? { domains: [dom] } : {}), ...(owner ? { ownerAccount: owner } : {}) }),
      });
      onAdded();
    } catch (err) {
      const code = (err as { code?: string }).code ?? (err as Error).message;
      if (code === "domain_taken" || code === "invalid_domain") setDomainErr(domainError(t, code));
      else setFormError(domainError(t, code));
    } finally {
      setBusy(false);
    }
  };

  const wizardKey = handoff ? `handoff-${handoff.runId}` : `manual-${wizardFocus ?? 0}`;
  const highlight: WizardStep | null = handoff?.handoff?.wizardStep ?? wizardFocus ?? (handoff ? WIZARD_STEP_OF[handoff.step] : null);

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-[var(--border-secondary)] p-3" data-testid="google-add-client">
      <div className="text-sm font-semibold text-[var(--text-primary)]">{t("addOrgTitle", undefined, "Add organisation sign-in")}</div>
      <TextField
        label={t("orgName", undefined, "Name")}
        value={label}
        onChange={setLabel}
        hint={t("orgNameHint", undefined, "Shown on accounts that use it.")}
        testIds={{ control: "google-org-name" }}
      />
      <TextField
        label={t("orgDomain", undefined, "Company email domain")}
        value={domain}
        onChange={(v) => {
          setDomain(v);
          setDomainErr(null);
        }}
        error={domainErr}
        hint={t("orgDomainHint", undefined, "Accounts with this domain sign in with this organisation's client.")}
        testIds={{ control: "google-org-domain", error: "google-org-domain-error" }}
      />
      <div className="flex flex-col gap-1">
        <span className="text-xs font-semibold text-[var(--text-primary)]" id="google-org-file-label">
          {t("orgFile", undefined, "OAuth client file from your Google Cloud admin")}
        </span>
        <div className="flex items-center gap-2">
          <input
            ref={input}
            type="file"
            className="sr-only"
            tabIndex={-1}
            accept="application/json,.json"
            data-testid="google-client-upload"
            aria-labelledby="google-org-file-label"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void pick(f);
            }}
          />
          <button type="button" className={btn} onClick={() => input.current?.click()}>
            {t("chooseFile", undefined, "Choose file…")}
          </button>
          {file && <span className="break-all font-mono text-[11px] text-[var(--text-secondary)]">{file.name}</span>}
        </div>
        {fileError && (
          <div role="alert" className={errorCls} data-testid="google-upload-error">
            {fileError}
          </div>
        )}
      </div>
      <Disclosure
        variant="bare"
        defaultOpen={!!state.autoSetup?.runId}
        toggleTestId="google-guided-toggle"
        bodyTestId="google-guided"
        header={<span className="font-semibold">{t("guidedTitle", undefined, "Don't have the file? Guided Google Cloud setup")}</span>}
      >
        <AutoSetupSection
          autoSetup={state.autoSetup}
          setup={{ ownerAccount: owner || undefined }}
          onAudience={onAudience}
          onOwnerEmail={setOwner}
          onHandoff={setHandoff}
          onRefresh={onRefresh}
        />
        <SetupWizard key={wizardKey} highlight={highlight} initial={{ projectId: handoff?.projectId ?? handoff?.created.projectId, owner: handoff?.ownerEmail ?? owner }} onOwner={setOwner} />
      </Disclosure>
      {formError && (
        <SettingsNotice tone="error" role="alert" testId="google-add-client-error">
          {formError}
        </SettingsNotice>
      )}
      <div className="flex gap-2">
        <button type="button" className={btn} data-testid="google-add-client-submit" disabled={busy} onClick={() => void submit()}>
          {t("add", undefined, "Add")}
        </button>
        <button type="button" className={btn} onClick={onCancel}>
          {t("cancel", undefined, "Cancel")}
        </button>
      </div>
    </div>
  );
}

export interface OrgSignInProps {
  state: GoogleState;
  open: boolean;
  onToggle: (open: boolean) => void;
  /** Open the add form (from a "Set up organisation sign-in" action), with the domain prefilled. */
  addOpen: boolean;
  onAddOpen: (open: boolean) => void;
  prefillDomain?: string;
  onChanged: () => void;
  onAudience: (a: Audience) => void;
}

export function OrgSignIn({ state, open, onToggle, addOpen, onAddOpen, prefillDomain, onChanged, onAudience }: OrgSignInProps) {
  const t = useT();
  const count = state.clients.length;
  const meta = count ? t("orgCount", { n: count }, `${count} ${count === 1 ? "organisation" : "organisations"}`) : t("notUsed", undefined, "Not used");
  return (
    <Disclosure
      open={open}
      onToggle={onToggle}
      testId="google-advanced"
      toggleTestId="google-advanced-toggle"
      bodyTestId="google-advanced-body"
      header={
        <>
          <span className="flex-1 text-sm font-semibold">{t("advancedTitle", undefined, "Advanced: organisation sign-in")}</span>
          <span className="text-[12px] font-semibold text-[var(--text-secondary)]">{meta}</span>
        </>
      }
    >
      <p className={`${muted} m-0`}>
        {t("advancedIntro", undefined, "Only needed if your company's Google Workspace admin blocks pi-dashboard.dev or requires its own Google Cloud sign-in. Personal Google accounts never need this.")}
      </p>
      <div className="flex items-center gap-2" data-testid="google-builtin-row">
        <span className="text-xs font-semibold text-[var(--text-primary)]">pi-dashboard.dev</span>
        <SettingsStatusPill tone={state.builtin.available ? "success" : "neutral"}>
          {state.builtin.available ? t("builtinAvailable", undefined, "Available") : t("builtinUnavailable", undefined, "Not available here")}
        </SettingsStatusPill>
      </div>
      {state.clients.map((c) => (
        <ClientRow key={c.id} c={c} state={state} onChanged={onChanged} />
      ))}
      {addOpen ? (
        <AddForm
          state={state}
          prefillDomain={prefillDomain}
          onAdded={() => {
            onAddOpen(false);
            onChanged();
          }}
          onCancel={() => onAddOpen(false)}
          onAudience={onAudience}
          onRefresh={onChanged}
        />
      ) : (
        <div>
          <button type="button" className={btn} data-testid="google-add-client-open" onClick={() => onAddOpen(true)}>
            {t("addOrg", undefined, "Add organisation sign-in")}
          </button>
        </div>
      )}
    </Disclosure>
  );
}
