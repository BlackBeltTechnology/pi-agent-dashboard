/**
 * "Domain certificates" (ACME DNS-01) source group of the Built-in HTTPS Certificates list —
 * approved board `openspec/changes/add-acme-dns01-certs/mockups/gateway-tls.html` (B1–B11).
 *
 * Registered with `registerTlsSourceGroup("acme", …)`. Rows are the prerequisite's shared
 * certificate row (`TlsCertRow`); this adds badges, stage steps, gate callouts under the name
 * they block (CNAME record + Copy + Check now + check time), "Renewal blocked", the Let's
 * Encrypt failed-validation note, the credentials gate with a write-only secret field, and the
 * editor (`GatewayAcmeEditor`). Renew now / Try again now / Check now all call
 * `POST /api/tls/issue` through the shell (`ctx.issue`).
 *
 * `GatewayAcmeAdd` is the "Add domain certificate" button + new-source editor the shell renders
 * after the groups (a first source has no group to hold it).
 *
 * Tokens + `connectivity-ui` recipes only. Copy talks about pairing a device, never signing in.
 *
 * See change: add-acme-dns01-certs (design D11).
 */
import type { TlsCertStatus, TlsGate } from "@blackbelt-technology/pi-dashboard-shared/tls-status.js";
import { mdiAlert, mdiAlertCircleOutline, mdiArrowRight, mdiCheck, mdiContentCopy, mdiPencil, mdiPlus, mdiRefresh, mdiWeb } from "@mdi/js";
import { Icon } from "@mdi/react";
import { type ReactNode, useEffect, useState } from "react";
import { clearAcmeCredentialError, setAcmeCredentialError, useAcmeCredentialError } from "../../lib/gateway/acme-credential-errors.js";
import {
  ACME_STAGES,
  challengeHost,
  checkedAgo,
  checkedAtOf,
  deriveAcmeGroupPill,
  findStored,
  gatesFor,
  inRenewalWindow,
  isAcmeStage,
  isCaInvalid,
  isoDate,
  isRejectedCredentials,
  isStaging,
  isWildcard,
  solverTypeOf,
} from "../../lib/gateway/acme-view.js";
import { getStoredAcmeSources, putAcmeCredentials, type StoredAcmeEntry } from "../../lib/gateway/tls-api.js";
import { isHeld, } from "../../lib/gateway/tls-view.js";
import { useI18n } from "../../lib/i18n/i18n.js";
import { copyText } from "../../lib/util/clipboard.js";
import { BTN_SECONDARY, BTN_SMALL, BTN_SMALL_GHOST, callout, errorMessage, META, severityPill } from "../connectivity/connectivity-ui.js";
import { credentialsBody, GatewayAcmeEditor, NO_SECRETS, SecretField, type Secrets } from "./GatewayAcmeEditor.js";
import { GroupFrame, registerTlsSourceGroup, TlsCertRow, type TlsGroupContext, type TlsRowDecor, type TlsSourceGroupProps } from "./tls-source-groups.js";

type Translate = ReturnType<typeof useI18n>["t"];

const STEP_LABELS: Record<(typeof ACME_STAGES)[number], [string, string]> = {
  order: ["gateway.acme.step.order", "Create order"],
  "dns-publish": ["gateway.acme.step.dnsPublish", "Publish TXT record"],
  propagation: ["gateway.acme.step.propagation", "Wait for DNS (≤ 3 min)"],
  validation: ["gateway.acme.step.validation", "CA checks the record"],
  finalize: ["gateway.acme.step.finalize", "Download certificate"],
};

/** Stage steps: done · current (`aria-current="step"`) · upcoming. Only for the five known stages. */
function StageSteps({ stage }: { stage: string }) {
  const { t } = useI18n();
  const current = ACME_STAGES.indexOf(stage as (typeof ACME_STAGES)[number]);
  return (
    <ol className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[var(--text-secondary)]" aria-label={t("gateway.acme.step.label", undefined, "Issuance progress")} data-testid="gateway-acme-steps">
      {ACME_STAGES.map((s, i) => (
        <li
          key={s}
          aria-current={i === current ? "step" : undefined}
          className={`inline-flex items-center gap-1 ${i === current ? "font-semibold text-[var(--text-primary)]" : ""}`}
        >
          <Icon path={i < current ? mdiCheck : i === current ? mdiRefresh : mdiPlus} size={0.45} spin={i === current} className={i > current ? "opacity-0" : ""} aria-hidden="true" />
          {t(STEP_LABELS[s][0], undefined, STEP_LABELS[s][1])}
        </li>
      ))}
    </ol>
  );
}

function Badges({ children }: { children: ReactNode }) {
  return <div className="mt-1.5 flex flex-wrap gap-1.5">{children}</div>;
}

/** The exact record to create, with a Copy button. */
function RecordLine({ name, fulldomain }: { name: string; fulldomain: string | null }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const target = fulldomain ?? t("gateway.acme.record.unknownTarget", undefined, "<your acme-dns full domain>");
  const line = `${challengeHost(name)}  CNAME  ${target}`;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      <code className="min-w-0 flex-[1_1_220px] break-all font-mono text-[11px]" data-testid="gateway-acme-record">
        {line}
      </code>
      <button
        type="button"
        className={BTN_SMALL}
        data-testid="gateway-acme-record-copy"
        onClick={() => {
          void copyText(line).then((ok) => {
            if (!ok) return;
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          });
        }}
      >
        <Icon path={copied ? mdiCheck : mdiContentCopy} size={0.5} aria-hidden="true" />
        {copied ? t("gateway.tls.copied", undefined, "Copied") : t("gateway.tls.copy", undefined, "Copy")}
      </button>
    </div>
  );
}

const reasonOf = (gate: TlsGate, t: Translate): string => {
  if (gate.id === "dns-cname") return t("gateway.acme.reason.cname", undefined, "the CNAME record is missing");
  if (gate.id === "dns-zone") return t("gateway.acme.reason.zone", undefined, "the DNS zone can't be found");
  if (gate.id === "credentials") {
    return isRejectedCredentials(gate)
      ? t("gateway.acme.reason.credentialsRejected", undefined, "the DNS provider rejected the credentials")
      : t("gateway.acme.reason.credentials", undefined, "the credentials are missing");
  }
  return gate.id;
};

/** A gate of one name: the record (CNAME), Check now and the check time; or the renewal-blocked wording. */
function NameGate({
  gate,
  cert,
  source,
  ctx,
  fulldomain,
  blocked,
}: {
  gate: TlsGate;
  cert: TlsCertStatus;
  source: TlsSourceGroupProps["source"];
  ctx: TlsGroupContext;
  fulldomain: string | null;
  /** The held certificate is due and cannot renew while this gate is unmet. */
  blocked: boolean;
}) {
  const { t } = useI18n();
  const checkedAt = checkedAtOf(source, cert.name);
  const busy = ctx.busyKey === `${source.id}\u0000${cert.name}`;
  const cname = gate.id === "dns-cname";
  const expiry = cert.notAfter !== undefined ? isoDate(cert.notAfter) : "";
  return (
    <div className={callout("warning")} role="note" data-testid={`gateway-acme-gate-${gate.id}`}>
      <Icon path={mdiAlert} size={0.6} className="mt-px flex-none" aria-hidden="true" />
      <div className="min-w-0 flex-1 space-y-1">
        {blocked ? (
          <p data-testid="gateway-acme-renewal-blocked">
            <b>{t("gateway.acme.blocked.title", { reason: reasonOf(gate, t) }, "Renewal blocked: {reason}.")}</b>{" "}
            {t("gateway.acme.blocked.expires", { date: expiry }, "The certificate expires on {date}.")}{" "}
            {cname && t("gateway.acme.blocked.recreate", undefined, "Recreate this record at your DNS host:")}
          </p>
        ) : cname ? (
          <p>
            <b>{t("gateway.acme.cname.title", undefined, "Create this record at your DNS host.")}</b>
          </p>
        ) : (
          <p>
            <b>{t("gateway.acme.zone.title", { name: cert.name }, "No DNS zone found for {name}.")}</b>{" "}
            {gate.hint ?? t("gateway.acme.zone.body", undefined, "Check the zone id, or that the token can read the zone.")}
          </p>
        )}
        {cname && <RecordLine name={cert.name} fulldomain={fulldomain} />}
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={BTN_SMALL_GHOST} disabled={busy} data-testid="gateway-acme-check-now" onClick={() => ctx.issue(source.id, cert.name)}>
            <Icon path={mdiRefresh} size={0.5} aria-hidden="true" />
            {t("gateway.tls.gate.checkNow", undefined, "Check now")}
          </button>
          {checkedAt !== null && <span className="text-[11px]">{checkedAgo(checkedAt, ctx.now, t)}</span>}
        </div>
      </div>
    </div>
  );
}

type SolverType = NonNullable<ReturnType<typeof solverTypeOf>>;

function credentialsCopy(solver: SolverType | null, rejected: boolean, vaultDown: boolean, t: Translate): { title: string; body: string } {
  if (vaultDown) {
    return {
      title: t("gateway.acme.cred.vaultTitle", undefined, "The credential vault is unavailable."),
      body: t("gateway.acme.cred.vaultBody", undefined, "Nothing is requested until the vault can be read again."),
    };
  }
  if (rejected) {
    return {
      title: t("gateway.acme.cred.rejectedTitle", undefined, "The DNS provider rejected the credentials."),
      body: t("gateway.acme.cred.rejectedBody", undefined, "Its permissions may have changed. Issuing is paused until you save new ones, then it resumes right away."),
    };
  }
  return {
    title:
      solver === "acme-dns"
        ? t("gateway.acme.cred.acmeDnsTitle", undefined, "No acme-dns credentials yet.")
        : t("gateway.acme.cred.cloudflareTitle", undefined, "No Cloudflare token yet."),
    body: t("gateway.acme.cred.missingBody", undefined, "Add them to start getting certificates."),
  };
}

/** The write-only secret field(s) of the source's solver; `action` (Save) sits beside the last one. */
function CredentialFields({
  solver,
  secrets,
  onChange,
  rejected,
  action,
}: {
  solver: SolverType;
  secrets: Secrets;
  onChange: (s: Secrets) => void;
  rejected: boolean;
  action: ReactNode;
}) {
  const { t } = useI18n();
  if (solver === "cloudflare") {
    return (
      <SecretField
        label={t("gateway.acme.cloudflare.token", undefined, "Cloudflare API token")}
        placeholder={t("gateway.acme.cloudflare.tokenPlaceholder", undefined, "Paste token")}
        value={secrets.token}
        onChange={(token) => onChange({ ...secrets, token })}
        configured={rejected}
        rejected={rejected}
        testId="gateway-acme-cloudflare-token"
        action={action}
      />
    );
  }
  const placeholder = t("gateway.acme.acmeDns.registerPlaceholder", undefined, "From the /register response");
  return (
    <div className="space-y-2">
      <SecretField
        label={t("gateway.acme.acmeDns.user", undefined, "Username")}
        placeholder={placeholder}
        value={secrets.user}
        onChange={(user) => onChange({ ...secrets, user })}
        configured={rejected}
        rejected={rejected}
        testId="gateway-acme-dns-user"
      />
      <SecretField
        label={t("gateway.acme.acmeDns.key", undefined, "Password")}
        placeholder={placeholder}
        value={secrets.key}
        onChange={(key) => onChange({ ...secrets, key })}
        configured={rejected}
        rejected={rejected}
        testId="gateway-acme-dns-key"
        action={action}
      />
    </div>
  );
}

/** Source-wide `credentials` gate: what is wrong, the error of the last save, a write-only field, Save. */
function CredentialsGate({ source, gate, ctx }: { source: TlsSourceGroupProps["source"]; gate: TlsGate; ctx: TlsGroupContext }) {
  const { t } = useI18n();
  const solver = solverTypeOf(source);
  const rejected = isRejectedCredentials(gate);
  const vaultDown = /vault/i.test(gate.hint ?? "");
  const saveError = useAcmeCredentialError(source.id);
  const [secrets, setSecrets] = useState<Secrets>(NO_SECRETS);
  const [busy, setBusy] = useState(false);
  const body = solver ? credentialsBody(solver, secrets) : null;
  const complete = solver === "acme-dns" ? secrets.user !== "" && secrets.key !== "" : body !== null;

  const save = async () => {
    if (!body || !complete || busy) return;
    setBusy(true);
    try {
      await putAcmeCredentials(source.id, body);
      clearAcmeCredentialError(source.id);
      setSecrets(NO_SECRETS);
      ctx.refresh();
    } catch (e) {
      setAcmeCredentialError(source.id, errorMessage(e, t("gateway.acme.err.credentialsFailed", undefined, "Could not save the credentials")));
      setSecrets(NO_SECRETS);
    } finally {
      setBusy(false);
    }
  };

  const { title, body: copy } = credentialsCopy(solver, rejected, vaultDown, t);
  const saveLabel = solver === "acme-dns" ? t("gateway.acme.cred.saveCredentials", undefined, "Save credentials") : t("gateway.acme.cred.saveToken", undefined, "Save token");
  const action = (
    <button type="button" className={BTN_SMALL} disabled={!complete || busy} data-testid="gateway-acme-credentials-save" onClick={() => void save()}>
      {saveLabel}
    </button>
  );

  return (
    <div className="space-y-2" data-testid="gateway-acme-gate-credentials">
      <div className={callout(rejected && !vaultDown ? "error" : "warning")} role={rejected ? "alert" : "note"}>
        <Icon path={rejected && !vaultDown ? mdiAlertCircleOutline : mdiAlert} size={0.6} className="mt-px flex-none" aria-hidden="true" />
        <div className="min-w-0">
          <b>{title}</b> {copy}
          {gate.hint && !vaultDown && !rejected && <span className="mt-1 block break-words font-mono text-[11px]">{gate.hint}</span>}
        </div>
      </div>
      {saveError && (
        <p role="alert" className="text-xs text-[var(--severity-error-fg)]" data-testid="gateway-acme-credentials-error">
          {saveError}
        </p>
      )}
      {!vaultDown && solver && <CredentialFields solver={solver} secrets={secrets} onChange={setSecrets} rejected={rejected} action={action} />}
    </div>
  );
}

function useFulldomain(source: TlsSourceGroupProps["source"], needed: boolean): string | null {
  const fromStatus = typeof source.details?.fulldomain === "string" ? source.details.fulldomain : null;
  const [loaded, setLoaded] = useState<string | null>(null);
  const known = fromStatus ?? loaded;
  useEffect(() => {
    if (!needed || known) return;
    let alive = true;
    getStoredAcmeSources()
      .then((list) => {
        const solver = findStored(list, source.id)?.solver;
        if (alive && solver?.type === "acme-dns") setLoaded(solver.fulldomain);
      })
      .catch(() => {
        /* the record line falls back to a placeholder target */
      });
    return () => {
      alive = false;
    };
  }, [needed, known, source.id]);
  return known;
}

function rowBadges(cert: TlsCertStatus, staging: boolean, t: Translate): ReactNode {
  const badges: ReactNode[] = [];
  if (staging) badges.push(<span key="st" className={severityPill("warning")}>{t("gateway.acme.badge.staging", undefined, "Staging · browsers warn")}</span>);
  if (isWildcard(cert.name)) badges.push(<span key="wc" className={severityPill("neutral")}>{t("gateway.acme.badge.wildcard", undefined, "Wildcard · served, not listed")}</span>);
  else if (!cert.advertise) badges.push(<span key="na" className={severityPill("neutral")}>{t("gateway.acme.badge.notAdvertised", undefined, "Not advertised")}</span>);
  return badges.length > 0 ? <Badges>{badges}</Badges> : undefined;
}

/** Row state when a gate (not a failed attempt) holds the name: due-for-renewal, or nothing issued yet. */
function gateDecor(cert: TlsCertStatus, own: TlsGate[], blocked: boolean, held: boolean, ctx: TlsGroupContext, t: Translate): TlsRowDecor {
  if (blocked) {
    return {
      pill: { severity: "warning", label: t("gateway.acme.row.blocked", undefined, "Renewal blocked"), icon: mdiAlert },
      facts: t("gateway.acme.row.stillServed", { date: isoDate(cert.notAfter ?? ctx.now) }, "Valid until {date}. Still served until then."),
      hideAction: true,
    };
  }
  if (held || cert.stage !== "idle" || own.length === 0) return {};
  const named = own.find((g) => g.name === cert.name);
  const label = named?.id === "dns-cname" ? t("gateway.acme.row.cnameMissing", undefined, "CNAME missing") : t("gateway.acme.row.zoneMissing", undefined, "Zone not found");
  return {
    hideAction: true,
    facts: t("gateway.tls.group.none", undefined, "No certificate yet."),
    pill: named ? { severity: "warning", label, icon: mdiAlert } : null,
  };
}

/** Everything the acme group adds to the shared certificate row of `cert`. */
function rowDecor({
  cert,
  source,
  unmet,
  fulldomain,
  ctx,
  t,
}: {
  cert: TlsCertStatus;
  source: TlsSourceGroupProps["source"];
  unmet: TlsGate[];
  fulldomain: string | null;
  ctx: TlsGroupContext;
  t: Translate;
}): TlsRowDecor {
  const held = isHeld(cert, ctx.now);
  const own = gatesFor(unmet, cert.name);
  const named = own.filter((g) => g.name === cert.name);
  const blocked = held && inRenewalWindow(cert, ctx.now) && own.length > 0;
  const shown = blocked ? [named[0] ?? own[0]] : named;
  return {
    isRequestingStage: isAcmeStage,
    badges: rowBadges(cert, isStaging(source), t),
    steps: isAcmeStage(cert.stage) ? <StageSteps stage={cert.stage} /> : undefined,
    errorNote: isCaInvalid(cert)
      ? t("gateway.acme.invalidNote", undefined, "Let's Encrypt allows only a few failed validations per hour, so fix the record before trying again now.")
      : undefined,
    ...gateDecor(cert, own, blocked, held, ctx, t),
    extra:
      shown.length > 0 ? (
        <div className="space-y-2">
          {shown.map((g) => (
            <NameGate key={g.id} gate={g} cert={cert} source={source} ctx={ctx} fulldomain={fulldomain} blocked={blocked} />
          ))}
        </div>
      ) : undefined,
  };
}

function GatewayAcmeSource({ source, certs, gates, ctx }: TlsSourceGroupProps) {
  const { t } = useI18n();
  const [editing, setEditing] = useState<{ entry: StoredAcmeEntry; direction?: "production" } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const unmet = gates.filter((g) => !g.ok);
  const fulldomain = useFulldomain(source, unmet.some((g) => g.id === "dns-cname"));
  const pill = deriveAcmeGroupPill(source, certs, gates, ctx.now, t);
  const rowNames = new Set(certs.map((c) => c.name));
  const groupGates = unmet.filter((g) => g.name === undefined || !rowNames.has(g.name));
  const staging = isStaging(source);

  const openEditor = async (direction?: "production") => {
    setLoadError(null);
    try {
      const entry = findStored(await getStoredAcmeSources(), source.id);
      if (!entry) throw new Error(t("gateway.acme.err.notStored", undefined, "This source is not in the saved settings."));
      setEditing({ entry, direction });
    } catch (e) {
      setLoadError(errorMessage(e, t("gateway.tls.err.configRead", undefined, "Could not read the current settings")));
    }
  };

  const closeEditor = () => setEditing(null);

  const renderCert = (cert: TlsCertStatus) => (
    <TlsCertRow key={cert.name} cert={cert} sourceId={source.id} ctx={ctx} decor={rowDecor({ cert, source, unmet, fulldomain, ctx, t })} />
  );

  const allHeld = certs.length > 0 && certs.every((c) => isHeld(c, ctx.now));
  const showStagingNote = allHeld && staging && unmet.length === 0 && !certs.some((c) => c.lastError || c.stage !== "idle");
  const directory = String(source.details?.directory ?? "");
  const directoryLabel =
    directory === "staging"
      ? t("gateway.acme.dir.letsEncryptStaging", undefined, "Let's Encrypt staging")
      : directory === "production"
        ? t("gateway.acme.dir.letsEncryptProduction", undefined, "Let's Encrypt production")
        : directory;
  const solver = solverTypeOf(source);
  const solverLabel = solver === "acme-dns" ? t("gateway.acme.solver.acmeDnsShort", undefined, "acme-dns") : solver === "cloudflare" ? t("gateway.acme.solver.cloudflare", undefined, "Cloudflare") : "";
  const meta = [source.id, directoryLabel, solverLabel].filter(Boolean).join(" · ");

  return (
    <>
      <GroupFrame
        testId={`gateway-tls-source-${source.id}`}
        icon={mdiWeb}
        title={t("gateway.acme.group.title", undefined, "Domain certificates")}
        meta={meta}
        pill={
          <span className={severityPill(pill.severity)} data-testid="gateway-acme-pill" data-severity={pill.severity}>
            <Icon path={pill.icon} size={0.5} spin={pill.spin} aria-hidden="true" />
            {pill.label}
          </span>
        }
        actions={
          <button type="button" className={BTN_SMALL_GHOST} aria-expanded={editing !== null} data-testid="gateway-acme-edit" onClick={() => (editing ? closeEditor() : void openEditor())}>
            <Icon path={mdiPencil} size={0.5} aria-hidden="true" />
            {t("gateway.acme.edit", undefined, "Edit")}
          </button>
        }
      >
        {loadError && (
          <p role="alert" className="text-xs text-[var(--severity-error-fg)]" data-testid="gateway-acme-load-error">
            {loadError}
          </p>
        )}
        {groupGates.map((g) =>
          g.id === "credentials" ? (
            <CredentialsGate key={`${g.id}:${g.name ?? ""}`} source={source} gate={g} ctx={ctx} />
          ) : (
            <div key={`${g.id}:${g.name ?? ""}`}>{ctx.renderGate(g)}</div>
          ),
        )}
        {certs.map(renderCert)}
        {certs.length === 0 && (
          <p className="text-xs text-[var(--text-secondary)]">
            {unmet.length > 0
              ? t("gateway.tls.group.noneFixFirst", undefined, "No certificate yet: fix the step above first.")
              : t("gateway.tls.group.none", undefined, "No certificate yet.")}
          </p>
        )}
        {showStagingNote && (
          <div className={callout("info")} role="note" data-testid="gateway-acme-staging-note">
            <div className="min-w-0 space-y-1.5">
              <p>
                <b>{t("gateway.acme.staging.title", undefined, "Staging works.")}</b>{" "}
                {t("gateway.acme.staging.body", undefined, "Browsers warn on these test certificates. Switch to production to get trusted ones.")}
              </p>
              <button type="button" className={BTN_SMALL} data-testid="gateway-acme-switch-production" onClick={() => void openEditor("production")}>
                <Icon path={mdiArrowRight} size={0.5} aria-hidden="true" />
                {t("gateway.acme.staging.switch", undefined, "Switch to production")}
              </button>
            </div>
          </div>
        )}
      </GroupFrame>
      {editing && (
        <GatewayAcmeEditor
          mode="edit"
          initial={editing.entry}
          initialDirectory={editing.direction}
          takenIds={[]}
          onSaved={() => {
            closeEditor();
            ctx.refresh();
          }}
          onCancel={closeEditor}
          onRemoved={() => {
            closeEditor();
            ctx.refresh();
          }}
        />
      )}
    </>
  );
}

/** "Add domain certificate" + the new-source editor, rendered by the shell after the groups. */
export function GatewayAcmeAdd({ sourceIds, onChanged }: { sourceIds: string[]; onChanged: () => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  if (open) {
    return (
      <GatewayAcmeEditor
        mode="new"
        takenIds={sourceIds}
        onSaved={() => {
          setOpen(false);
          onChanged();
        }}
        onCancel={() => setOpen(false)}
      />
    );
  }
  return (
    <div>
      <button type="button" className={BTN_SECONDARY} data-testid="gateway-acme-add" onClick={() => setOpen(true)}>
        <Icon path={mdiPlus} size={0.5} aria-hidden="true" />
        {t("gateway.acme.add", undefined, "Add domain certificate")}
      </button>
      <p className={`mt-1 ${META}`}>
        {t(
          "gateway.acme.addHint",
          undefined,
          "For a domain you own that points at this computer's private address. Uses Let's Encrypt; this computer doesn't need to be reachable from the internet.",
        )}
      </p>
    </div>
  );
}

registerTlsSourceGroup("acme", GatewayAcmeSource);
