/**
 * Editor of one Domain certificates (ACME DNS-01) source — approved board
 * `openspec/changes/add-acme-dns01-certs/mockups/gateway-tls.html` (B1, B2, B7, B10).
 *
 * Own Save / Cancel (a multi-field form, unlike the section's switch). Save order:
 * `PUT /api/tls/acme/:id` (the entry) → `PUT /api/tls/acme/:id/credentials` (only when a
 * secret was typed). Secrets are WRITE-ONLY: the inputs are always empty, live only in
 * component state, are never put in a URL or browser storage, and are dropped on a
 * successful save, on Cancel and on unmount. A failed credentials write keeps the source
 * saved; the group shows the credentials gate plus the error (`acme-credential-errors`).
 *
 * Tokens + `connectivity-ui` recipes only. Copy talks about pairing a device.
 *
 * See change: add-acme-dns01-certs (design D5, D11).
 */
import { mdiCheckCircleOutline, mdiCircleOutline, mdiClose, mdiCloseCircleOutline, mdiDeleteOutline, mdiInformationOutline, mdiPlus } from "@mdi/js";
import { Icon } from "@mdi/react";
import { type KeyboardEvent, type ReactNode, useId, useState } from "react";
import { clearAcmeCredentialError, setAcmeCredentialError } from "../../lib/gateway/acme-credential-errors.js";
import { directoryKind, type EditorField, fieldOfServerMessage, idProblem, normalizeDomain } from "../../lib/gateway/acme-view.js";
import {
  type AcmeCredentials,
  type AcmeSourceEntry,
  deleteAcmeSource,
  putAcmeCredentials,
  putAcmeSource,
  type StoredAcmeEntry,
} from "../../lib/gateway/tls-api.js";
import { useI18n } from "../../lib/i18n/i18n.js";
import {
  BTN_ICON_GHOST,
  BTN_PRIMARY,
  BTN_SMALL,
  BTN_SMALL_DANGER,
  BTN_SMALL_GHOST,
  callout,
  errorMessage,
  HELP,
  INPUT,
  LABEL,
  META,
  severityPill,
} from "../connectivity/connectivity-ui.js";

const DEFAULT_ACME_DNS = "https://auth.acme-dns.io";
const SUBSCRIBER_AGREEMENT = "https://letsencrypt.org/repository/";
const MAX_DOMAINS = 20;

type SolverKind = "cloudflare" | "acme-dns";
type DirKind = "staging" | "production" | "custom";

interface Draft {
  id: string;
  email: string;
  domains: string[];
  domainInput: string;
  solver: SolverKind;
  zoneId: string;
  server: string;
  subdomain: string;
  fulldomain: string;
  dirKind: DirKind;
  customUrl: string;
  advertise: boolean;
  agreeTos: boolean;
}

interface Secrets {
  token: string;
  user: string;
  key: string;
}
const NO_SECRETS: Secrets = { token: "", user: "", key: "" };

function draftFrom(initial: StoredAcmeEntry | undefined, directory: DirKind | undefined): Draft {
  const solver = initial?.solver;
  const kind = initial ? directoryKind(initial.directory) : (directory ?? "staging");
  return {
    id: initial?.id ?? "",
    email: initial?.email ?? "",
    domains: initial?.domains ?? [],
    domainInput: "",
    solver: solver?.type ?? "cloudflare",
    zoneId: solver?.type === "cloudflare" ? (solver.zoneId ?? "") : "",
    server: solver?.type === "acme-dns" ? solver.server : DEFAULT_ACME_DNS,
    subdomain: solver?.type === "acme-dns" ? solver.subdomain : "",
    fulldomain: solver?.type === "acme-dns" ? solver.fulldomain : "",
    dirKind: directory && initial ? directory : kind,
    customUrl: initial && kind === "custom" ? initial.directory : "",
    advertise: initial?.advertise === true,
    agreeTos: initial?.agreeTos === true,
  };
}

/** Write-only secret input: a status word (never the value) + an always-empty password field. */
export function SecretField({
  label,
  placeholder,
  value,
  onChange,
  configured,
  rejected,
  help,
  testId,
  action,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  configured: boolean;
  rejected?: boolean;
  help?: string;
  testId: string;
  action?: ReactNode;
}) {
  const { t } = useI18n();
  const ids = useId();
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className={`${LABEL} mb-0`} htmlFor={`${ids}-in`}>
          {label}
        </label>
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold" data-testid={`${testId}-state`}>
          {rejected ? (
            <span className="inline-flex items-center gap-1 text-[var(--severity-error-fg)]">
              <Icon path={mdiCloseCircleOutline} size={0.5} aria-hidden="true" />
              {t("gateway.acme.secret.rejected", undefined, "Rejected by the DNS provider")}
            </span>
          ) : configured ? (
            <span className="inline-flex items-center gap-1 text-[var(--severity-success-fg)]">
              <Icon path={mdiCheckCircleOutline} size={0.5} aria-hidden="true" />
              {t("gateway.acme.secret.saved", undefined, "Saved in the credential vault")}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[var(--text-secondary)]">
              <Icon path={mdiCircleOutline} size={0.5} aria-hidden="true" />
              {t("gateway.acme.secret.notSet", undefined, "Not set")}
            </span>
          )}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <input
          id={`${ids}-in`}
          type="password"
          autoComplete="off"
          spellCheck={false}
          className={`${INPUT} min-w-0 flex-1 font-mono`}
          placeholder={configured ? t("gateway.acme.secret.replace", undefined, "Enter a new value to replace it") : placeholder}
          value={value}
          aria-describedby={help ? `${ids}-help` : undefined}
          data-testid={testId}
          onChange={(e) => onChange(e.target.value)}
        />
        {action}
      </div>
      {help && (
        <p id={`${ids}-help`} className={`mt-1 ${META}`}>
          {help}
        </p>
      )}
    </div>
  );
}

/** Credentials request body for the typed secrets of `solver`, or null when nothing was typed. */
export function credentialsBody(solver: SolverKind, s: Secrets): AcmeCredentials | null {
  if (solver === "cloudflare") return s.token ? { token: s.token } : null;
  return s.user || s.key ? { user: s.user, key: s.key } : null;
}

export type { Secrets };
export { NO_SECRETS };

function RadioCards<V extends string>({
  labelId,
  value,
  onChange,
  cards,
  testIdPrefix,
}: {
  labelId: string;
  value: V;
  onChange: (v: V) => void;
  cards: Array<{ value: V; title: string; badge?: ReactNode; text: string }>;
  testIdPrefix: string;
}) {
  const move = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = cards.findIndex((c) => c.value === value);
    const step = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = cards[(i + step + cards.length) % cards.length];
    onChange(next.value);
    (e.currentTarget.querySelector(`[data-value="${next.value}"]`) as HTMLElement | null)?.focus();
  };
  return (
    <div role="radiogroup" aria-labelledby={labelId} className="grid gap-2 sm:grid-cols-[repeat(auto-fit,minmax(180px,1fr))]" onKeyDown={move}>
      {cards.map((c) => {
        const selected = c.value === value;
        return (
          <button
            key={c.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            data-value={c.value}
            data-testid={`${testIdPrefix}-${c.value}`}
            onClick={() => onChange(c.value)}
            className={`focus-ring flex min-h-[44px] cursor-pointer items-start gap-2 rounded-lg border p-2.5 text-left text-xs sm:min-h-[36px] ${
              selected ? "border-[var(--tint-blue-border)] bg-[var(--tint-blue-bg)]" : "border-[var(--border-subtle)] bg-[var(--bg-tertiary)]"
            }`}
          >
            <span
              aria-hidden="true"
              className={`mt-0.5 h-3.5 w-3.5 flex-none rounded-full border-2 ${
                selected ? "border-[var(--accent-solid)] bg-[var(--accent-solid)]" : "border-[var(--border-strong)]"
              }`}
            />
            <span className="min-w-0">
              <span className="flex flex-wrap items-center gap-1.5 font-semibold text-[var(--text-primary)]">
                {c.title} {c.badge}
              </span>
              <span className={`mt-0.5 block ${HELP}`}>{c.text}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} role="alert" className="mt-1 flex items-start gap-1 text-xs text-[var(--severity-error-fg)]">
      <Icon path={mdiCloseCircleOutline} size={0.55} className="mt-px flex-none" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

interface Props {
  mode: "new" | "edit";
  /** The stored entry being edited (`GET /api/config` projection; carries `solver.configured`). */
  initial?: StoredAcmeEntry;
  /** Preselect a directory (the "Switch to production" shortcut). */
  initialDirectory?: "staging" | "production";
  /** Ids of the sources that already exist (a new id must be unique). */
  takenIds: string[];
  /** The entry was saved (credentials may have failed: that error is in the credential-error store). */
  onSaved: () => void;
  onCancel: () => void;
  onRemoved?: () => void;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one form view over the draft; field rules live in `lib/gateway/acme-view.ts`
export function GatewayAcmeEditor({ mode, initial, initialDirectory, takenIds, onSaved, onCancel, onRemoved }: Props) {
  const { t } = useI18n();
  const ids = useId();
  const [draft, setDraft] = useState<Draft>(() => draftFrom(initial, initialDirectory));
  const [secrets, setSecrets] = useState<Secrets>(NO_SECRETS);
  const [domainError, setDomainError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Partial<Record<Exclude<EditorField, null> | "form", string>>>({});
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const isNew = mode === "new";
  const configured = initial?.solver.type === draft.solver && initial.solver.configured === true;
  const initialKind = initial ? directoryKind(initial.directory) : null;
  const switching = initialKind === "staging" && draft.dirKind === "production";

  const idError = errors.id;
  const emailError = errors.email;
  const domainFieldError = domainError ?? errors.domain;

  const checkDomainInput = (raw: string): string | null =>
    raw.trim() === "" || normalizeDomain(raw) !== null
      ? null
      : t("gateway.acme.err.domain", undefined, "Not a hostname. A wildcard may only replace the first label, as in *.lab.example.com.");

  const addDomain = (): string[] | null => {
    const raw = draft.domainInput;
    if (raw.trim() === "") return draft.domains;
    const d = normalizeDomain(raw);
    if (!d) {
      setDomainError(checkDomainInput(raw));
      return null;
    }
    if (draft.domains.includes(d)) {
      set({ domainInput: "" });
      return draft.domains;
    }
    if (draft.domains.length >= MAX_DOMAINS) {
      setDomainError(t("gateway.acme.err.tooManyDomains", { max: MAX_DOMAINS }, "At most {max} names per source."));
      return null;
    }
    const next = [...draft.domains, d];
    set({ domains: next, domainInput: "" });
    setDomainError(null);
    return next;
  };

  const idMessage = (): string | null => {
    const problem = idProblem(draft.id.trim(), takenIds);
    if (!problem) return null;
    if (problem === "reserved") return t("gateway.acme.err.idReserved", undefined, "“tailscale” is reserved for the Tailscale source.");
    if (problem === "taken") return t("gateway.acme.err.idTaken", undefined, "Another source already uses this name.");
    if (problem === "empty") return t("gateway.acme.err.idEmpty", undefined, "Enter a name for this source.");
    return t("gateway.acme.err.idFormat", undefined, "Use lowercase letters, digits and dashes, up to 32 characters, starting with a letter or digit.");
  };

  const buildEntry = (domains: string[]): AcmeSourceEntry => {
    const directory = draft.dirKind === "custom" ? draft.customUrl.trim() : draft.dirKind;
    const solver: AcmeSourceEntry["solver"] =
      draft.solver === "cloudflare"
        ? { type: "cloudflare", ...(draft.zoneId.trim() ? { zoneId: draft.zoneId.trim() } : {}) }
        : { type: "acme-dns", server: draft.server.trim(), subdomain: draft.subdomain.trim(), fulldomain: draft.fulldomain.trim() };
    return {
      type: "acme",
      id: draft.id.trim(),
      domains,
      email: draft.email.trim(),
      agreeTos: true,
      directory,
      ...(draft.dirKind === "custom" ? { advertise: draft.advertise } : {}),
      solver,
    };
  };

  /** Second save step: only when a secret was typed. A failure keeps the source saved; the group shows it. */
  const writeCredentials = async (sourceId: string) => {
    const body = credentialsBody(draft.solver, secrets);
    if (!body) return;
    try {
      await putAcmeCredentials(sourceId, body);
      clearAcmeCredentialError(sourceId);
    } catch (e) {
      setAcmeCredentialError(sourceId, errorMessage(e, t("gateway.acme.err.credentialsFailed", undefined, "Could not save the credentials")));
    }
  };

  const save = async () => {
    if (!draft.agreeTos || busy) return;
    const domains = addDomain();
    if (domains === null) return;
    const idMsg = isNew ? idMessage() : null;
    if (idMsg) {
      setErrors({ id: idMsg });
      return;
    }
    setErrors({});
    setBusy(true);
    const entry = buildEntry(domains);
    try {
      await putAcmeSource(entry);
    } catch (e) {
      const message = errorMessage(e, t("gateway.acme.err.saveFailed", undefined, "Could not save this domain certificate source"));
      setErrors({ [fieldOfServerMessage(message) ?? "form"]: message });
      setBusy(false);
      return;
    }
    await writeCredentials(entry.id);
    setSecrets(NO_SECRETS);
    setBusy(false);
    onSaved();
  };

  const cancel = () => {
    setSecrets(NO_SECRETS);
    onCancel();
  };

  const remove = async () => {
    if (!initial) return;
    setBusy(true);
    try {
      await deleteAcmeSource(initial.id);
      clearAcmeCredentialError(initial.id);
      setSecrets(NO_SECRETS);
      onRemoved?.();
    } catch (e) {
      setErrors({ form: errorMessage(e, t("gateway.acme.err.removeFailed", undefined, "Could not remove this source")) });
      setConfirmRemove(false);
    } finally {
      setBusy(false);
    }
  };

  const solverHelp = t(
    "gateway.acme.cloudflare.help",
    undefined,
    "Create a token with Zone → DNS → Edit for the one zone that holds these names, plus Zone → Zone → Read unless you enter the zone id below. Stored in the dashboard's credential vault and never shown again.",
  );
  const tosMissing = !draft.agreeTos;
  const firstDomain = draft.domains[0];

  return (
    <div className="space-y-3 rounded-lg border border-[var(--border-subtle)] p-3" data-testid="gateway-acme-editor">
      <b className="text-xs text-[var(--text-primary)]">
        {isNew ? t("gateway.acme.editor.new", undefined, "New domain certificate") : t("gateway.acme.editor.edit", { id: initial?.id ?? "" }, "Domain certificates · edit")}
      </b>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={LABEL} htmlFor={`${ids}-id`}>
            {t("gateway.acme.field.id", undefined, "Source name")}
          </label>
          <input
            id={`${ids}-id`}
            className={`${INPUT} font-mono`}
            value={draft.id}
            readOnly={!isNew}
            aria-readonly={!isNew || undefined}
            aria-invalid={idError ? "true" : undefined}
            aria-describedby={idError ? `${ids}-id-e` : `${ids}-id-h`}
            data-testid="gateway-acme-id"
            onChange={(e) => {
              set({ id: e.target.value });
              setErrors((x) => ({ ...x, id: undefined }));
            }}
          />
          {idError ? (
            <FieldError id={`${ids}-id-e`}>{idError}</FieldError>
          ) : (
            <p id={`${ids}-id-h`} className={`mt-1 ${META}`}>
              {isNew
                ? t("gateway.acme.field.idHintNew", undefined, "Tells sources apart. Letters, digits, dashes. Can't be changed later.")
                : t("gateway.acme.field.idHintSaved", undefined, "Can't be changed. Remove the source and add a new one to rename it.")}
            </p>
          )}
        </div>
        <div>
          <label className={LABEL} htmlFor={`${ids}-email`}>
            {t("gateway.acme.field.email", undefined, "Contact email")}
          </label>
          <input
            id={`${ids}-email`}
            type="email"
            className={INPUT}
            value={draft.email}
            aria-invalid={emailError ? "true" : undefined}
            aria-describedby={emailError ? `${ids}-email-e` : `${ids}-email-h`}
            data-testid="gateway-acme-email"
            onChange={(e) => {
              set({ email: e.target.value });
              setErrors((x) => ({ ...x, email: undefined }));
            }}
          />
          {emailError ? (
            <FieldError id={`${ids}-email-e`}>{emailError}</FieldError>
          ) : (
            <p id={`${ids}-email-h`} className={`mt-1 ${META}`}>
              {t("gateway.acme.field.emailHint", undefined, "The CA may send expiry and policy notices here.")}
            </p>
          )}
        </div>
      </div>

      <div>
        <p className={LABEL}>{t("gateway.acme.field.domains", undefined, "Domains")}</p>
        {draft.domains.length > 0 && (
          <ul className="space-y-1" data-testid="gateway-acme-domains">
            {draft.domains.map((d) => (
              <li key={d} className="flex items-center gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] px-2 py-0.5">
                <span className="min-w-0 flex-1 break-all font-mono text-xs text-[var(--text-primary)]">{d}</span>
                <button
                  type="button"
                  className={BTN_ICON_GHOST}
                  aria-label={t("gateway.acme.field.removeDomain", { name: d }, "Remove {name}")}
                  onClick={() => set({ domains: draft.domains.filter((x) => x !== d) })}
                >
                  <Icon path={mdiClose} size={0.6} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor={`${ids}-dom`}>
            {t("gateway.acme.field.domainAdd", undefined, "Domain to add")}
          </label>
          <input
            id={`${ids}-dom`}
            className={`${INPUT} min-w-0 flex-1 font-mono`}
            placeholder="dash.example.com or *.lab.example.com"
            value={draft.domainInput}
            aria-invalid={domainFieldError ? "true" : undefined}
            aria-describedby={`${ids}-dom-h`}
            data-testid="gateway-acme-domain-input"
            onChange={(e) => {
              set({ domainInput: e.target.value });
              setDomainError(checkDomainInput(e.target.value));
              setErrors((x) => ({ ...x, domain: undefined }));
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addDomain();
              }
            }}
          />
          <button
            type="button"
            className={BTN_SMALL}
            disabled={draft.domainInput.trim() === "" || checkDomainInput(draft.domainInput) !== null}
            data-testid="gateway-acme-domain-add"
            onClick={() => addDomain()}
          >
            <Icon path={mdiPlus} size={0.5} aria-hidden="true" />
            {t("gateway.acme.field.add", undefined, "Add")}
          </button>
        </div>
        {domainFieldError ? (
          <FieldError id={`${ids}-dom-h`}>{domainFieldError}</FieldError>
        ) : (
          <p id={`${ids}-dom-h`} className={`mt-1 ${META}`}>
            {t(
              "gateway.acme.field.domainsHint",
              undefined,
              "Point each name's A record at this computer's private address. Wildcards are served but never listed as an address, and the main port does not accept them as a host name: add a subdomain to Allowed hosts to open the dashboard on it.",
            )}
          </p>
        )}
      </div>

      <div>
        <p className={LABEL} id={`${ids}-solver-l`}>
          {t("gateway.acme.solver.label", undefined, "How to prove you own the domains")}
        </p>
        <RadioCards<SolverKind>
          labelId={`${ids}-solver-l`}
          value={draft.solver}
          onChange={(solver) => set({ solver })}
          testIdPrefix="gateway-acme-solver"
          cards={[
            {
              value: "cloudflare",
              title: t("gateway.acme.solver.cloudflare", undefined, "Cloudflare"),
              text: t("gateway.acme.solver.cloudflareText", undefined, "The dashboard adds and removes the challenge TXT record through the Cloudflare API."),
            },
            {
              value: "acme-dns",
              title: t("gateway.acme.solver.acmeDns", undefined, "Any DNS host (acme-dns)"),
              text: t("gateway.acme.solver.acmeDnsText", undefined, "One CNAME at your DNS host hands the challenge to an acme-dns server."),
            },
          ]}
        />
      </div>

      {draft.solver === "cloudflare" ? (
        <>
          <SecretField
            label={t("gateway.acme.cloudflare.token", undefined, "Cloudflare API token")}
            placeholder={t("gateway.acme.cloudflare.tokenPlaceholder", undefined, "Paste token")}
            value={secrets.token}
            onChange={(token) => setSecrets({ ...secrets, token })}
            configured={configured}
            help={solverHelp}
            testId="gateway-acme-cloudflare-token"
          />
          <div>
            <label className={LABEL} htmlFor={`${ids}-zone`}>
              {t("gateway.acme.cloudflare.zone", undefined, "Zone id")}{" "}
              <span className="font-normal text-[var(--text-secondary)]">{t("gateway.acme.optional", undefined, "(optional)")}</span>
            </label>
            <input
              id={`${ids}-zone`}
              className={`${INPUT} font-mono`}
              placeholder={t("gateway.acme.cloudflare.zonePlaceholder", undefined, "32 hex characters, from the zone's Overview page")}
              value={draft.zoneId}
              data-testid="gateway-acme-zone"
              onChange={(e) => set({ zoneId: e.target.value })}
            />
          </div>
        </>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={LABEL} htmlFor={`${ids}-srv`}>
                {t("gateway.acme.acmeDns.server", undefined, "acme-dns server")}
              </label>
              <input id={`${ids}-srv`} className={`${INPUT} font-mono`} value={draft.server} data-testid="gateway-acme-server" onChange={(e) => set({ server: e.target.value })} />
            </div>
            <div>
              <label className={LABEL} htmlFor={`${ids}-sub`}>
                {t("gateway.acme.acmeDns.subdomain", undefined, "Subdomain")}
              </label>
              <input id={`${ids}-sub`} className={`${INPUT} font-mono`} value={draft.subdomain} data-testid="gateway-acme-subdomain" onChange={(e) => set({ subdomain: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <label className={LABEL} htmlFor={`${ids}-full`}>
                {t("gateway.acme.acmeDns.fulldomain", undefined, "Full domain")}
              </label>
              <input id={`${ids}-full`} className={`${INPUT} font-mono`} value={draft.fulldomain} data-testid="gateway-acme-fulldomain" onChange={(e) => set({ fulldomain: e.target.value })} />
            </div>
            <SecretField
              label={t("gateway.acme.acmeDns.user", undefined, "Username")}
              placeholder={t("gateway.acme.acmeDns.registerPlaceholder", undefined, "From the /register response")}
              value={secrets.user}
              onChange={(user) => setSecrets({ ...secrets, user })}
              configured={configured}
              testId="gateway-acme-dns-user"
            />
            <SecretField
              label={t("gateway.acme.acmeDns.key", undefined, "Password")}
              placeholder={t("gateway.acme.acmeDns.registerPlaceholder", undefined, "From the /register response")}
              value={secrets.key}
              onChange={(key) => setSecrets({ ...secrets, key })}
              configured={configured}
              testId="gateway-acme-dns-key"
            />
          </div>
          <p className={META}>
            {t(
              "gateway.acme.acmeDns.hint",
              { url: `${draft.server.trim() || DEFAULT_ACME_DNS}/register` },
              "Register once with curl -X POST {url} and paste the four values. Username and password are stored in the dashboard's credential vault.",
            )}
          </p>
        </>
      )}

      <div>
        <p className={LABEL} id={`${ids}-dir-l`}>
          {t("gateway.acme.dir.label", undefined, "Certificate authority")}
        </p>
        <RadioCards<DirKind>
          labelId={`${ids}-dir-l`}
          value={draft.dirKind}
          onChange={(dirKind) => set({ dirKind })}
          testIdPrefix="gateway-acme-dir"
          cards={[
            {
              value: "staging",
              title: t("gateway.acme.dir.staging", undefined, "Staging"),
              badge: <span className={severityPill("success")}>{t("gateway.acme.dir.startHere", undefined, "Start here")}</span>,
              text: t("gateway.acme.dir.stagingText", undefined, "Test certificates browsers don't trust. No rate-limit risk while you set up."),
            },
            {
              value: "production",
              title: t("gateway.acme.dir.production", undefined, "Production"),
              text: t("gateway.acme.dir.productionText", undefined, "Trusted certificates. Let's Encrypt limits repeated issuance for the same names."),
            },
            {
              value: "custom",
              title: t("gateway.acme.dir.custom", undefined, "Other CA"),
              text: t("gateway.acme.dir.customText", undefined, "Any RFC 8555 directory URL, such as a company CA."),
            },
          ]}
        />
        {draft.dirKind === "custom" && (
          <div className="mt-2 space-y-2">
            <div>
              <label className={LABEL} htmlFor={`${ids}-url`}>
                {t("gateway.acme.dir.url", undefined, "Directory URL")}
              </label>
              <input
                id={`${ids}-url`}
                className={`${INPUT} font-mono`}
                value={draft.customUrl}
                aria-invalid={errors.directory ? "true" : undefined}
                aria-describedby={errors.directory ? `${ids}-url-e` : undefined}
                data-testid="gateway-acme-directory-url"
                onChange={(e) => {
                  set({ customUrl: e.target.value });
                  setErrors((x) => ({ ...x, directory: undefined }));
                }}
              />
              {errors.directory && <FieldError id={`${ids}-url-e`}>{errors.directory}</FieldError>}
            </div>
            <label className="flex min-h-[32px] items-start gap-2 text-xs text-[var(--text-primary)]">
              <input
                type="checkbox"
                className="focus-ring mt-0.5"
                checked={draft.advertise}
                data-testid="gateway-acme-advertise"
                onChange={(e) => set({ advertise: e.target.checked })}
              />
              <span>
                {t("gateway.acme.dir.advertise", undefined, "Advertise these names to paired devices")}
                <span className={`block ${META}`}>
                  {t("gateway.acme.dir.advertiseHint", undefined, "Only if every device you pair already trusts this CA. Otherwise the certificate is served but the address isn't handed out.")}
                </span>
              </span>
            </label>
          </div>
        )}
      </div>

      {switching && (
        <div className={callout("warning")} role="note" data-testid="gateway-acme-switching">
          <Icon path={mdiInformationOutline} size={0.6} className="mt-px flex-none" aria-hidden="true" />
          <div className="min-w-0">
            <b>{t("gateway.acme.switching.title", undefined, "Switching to production issues new certificates for every name.")}</b>{" "}
            {t(
              "gateway.acme.switching.body",
              undefined,
              "The staging certificates keep being served until the new ones arrive. Then the names are advertised to paired devices and in the pairing QR.",
            )}
          </div>
        </div>
      )}

      <label className="flex min-h-[32px] items-start gap-2 text-xs text-[var(--text-primary)]">
        <input
          type="checkbox"
          className="focus-ring mt-0.5"
          checked={draft.agreeTos}
          data-testid="gateway-acme-tos"
          onChange={(e) => set({ agreeTos: e.target.checked })}
        />
        <span>
          {draft.dirKind === "custom" ? (
            t("gateway.acme.tos.custom", undefined, "I accept the CA's terms of service")
          ) : (
            <>
              {t("gateway.acme.tos.prefix", undefined, "I accept the")}{" "}
              <a href={SUBSCRIBER_AGREEMENT} target="_blank" rel="noopener noreferrer" className="underline">
                {t("gateway.acme.tos.link", undefined, "Let's Encrypt Subscriber Agreement")}
                <span className="sr-only"> {t("gateway.tls.newTab", undefined, "(opens in a new tab)")}</span>
              </a>
            </>
          )}
        </span>
      </label>

      {isNew && (
        <div className={callout("info")} role="note" data-testid="gateway-acme-ct-note">
          <Icon path={mdiInformationOutline} size={0.6} className="mt-px flex-none" aria-hidden="true" />
          <div className="min-w-0">
            <b>{t("gateway.acme.ct.title", undefined, "Certificate names are public.")}</b>{" "}
            {t(
              "gateway.acme.ct.body",
              { name: firstDomain ?? t("gateway.acme.ct.yourNames", undefined, "your domain names") },
              "Every certificate is written to public Certificate Transparency logs, so {name} becomes visible to anyone. The A record pointing it at this computer's private address is public too; only devices on your private network can connect.",
            )}
          </div>
        </div>
      )}

      {errors.form && (
        <p role="alert" data-testid="gateway-acme-form-error" className="text-xs text-[var(--severity-error-fg)]">
          {errors.form}
        </p>
      )}

      {confirmRemove && (
        <div className={callout("error")} role="alert" data-testid="gateway-acme-remove-confirm">
          <div className="min-w-0 space-y-1.5">
            <p>
              <b>{t("gateway.acme.remove.title", { id: initial?.id ?? "" }, "Remove {id}?")}</b>{" "}
              {t("gateway.acme.remove.body", undefined, "Its certificates stop being served and its saved credentials are deleted from the vault.")}
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={BTN_SMALL_DANGER} disabled={busy} data-testid="gateway-acme-remove-yes" onClick={() => void remove()}>
                {t("gateway.acme.remove.confirm", undefined, "Remove source")}
              </button>
              <button type="button" className={BTN_SMALL} onClick={() => setConfirmRemove(false)}>
                {t("gateway.acme.remove.keep", undefined, "Keep it")}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <span className={`mr-auto ${META}`} id={`${ids}-why`}>
          {tosMissing
            ? t("gateway.acme.save.needTerms", undefined, "Accept the terms to save.")
            : isNew
              ? t("gateway.acme.save.order", undefined, "Saving stores the settings, then the credentials, then starts a staging issuance.")
              : ""}
        </span>
        {!isNew && (
          <button type="button" className={BTN_SMALL_DANGER} disabled={busy} data-testid="gateway-acme-remove" onClick={() => setConfirmRemove(true)}>
            <Icon path={mdiDeleteOutline} size={0.5} aria-hidden="true" />
            {t("gateway.acme.remove.button", undefined, "Remove source")}
          </button>
        )}
        <button type="button" className={BTN_SMALL_GHOST} data-testid="gateway-acme-cancel" onClick={cancel}>
          {t("common.cancel", undefined, "Cancel")}
        </button>
        <button
          type="button"
          className={BTN_PRIMARY}
          disabled={tosMissing || busy}
          aria-describedby={tosMissing ? `${ids}-why` : undefined}
          data-testid="gateway-acme-save"
          onClick={() => void save()}
        >
          {t("gateway.acme.save.button", undefined, "Save")}
        </button>
      </div>
    </div>
  );
}
