/**
 * Write-only secret entry. A store-backed secret gets a password input and a
 * Save that sends `PUT /api/services/:id/secrets/:name`; the input clears on
 * submit and no value is kept in state afterwards. The UI never displays,
 * retains or requests a secret value. Non-store secrets show their reference
 * read-only.
 * See change: add-services-settings-ui (D12).
 */
import type { ServiceStatus } from "@blackbelt-technology/pi-dashboard-shared/services/status.js";
import { useId, useState } from "react";
import { t as i18nT } from "../../../lib/i18n/i18n.js";
import { type ServicesResult, setSecret } from "../../../lib/services/services-api.js";
import { BUTTON_CLASS, HELP_CLASS, INPUT_CLASS, LABEL_CLASS } from "../vault/vault-ui.js";
import { ActionFailure, Chip, SectionTitle } from "./services-ui.js";

export const secretInputId = (serviceId: string, name: string) => `service-secret-${serviceId}-${name}`;

function SecretRow({ service, name, disabled, onSaved }: { service: ServiceStatus; name: string; disabled: boolean; onSaved: () => void }) {
  const ref = service.secretRefs?.[name] ?? `store:${service.id}/${name}`;
  const storeBacked = ref.startsWith("store:");
  const configured = service.secrets[name]?.configured === true;
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ServicesResult<unknown> | null>(null);
  const [saved, setSaved] = useState(false);
  const labelId = useId();

  const save = async () => {
    const submitted = value;
    // Cleared at submit: no secret value outlives the request in component state.
    setValue("");
    setBusy(true);
    setFailure(null);
    setSaved(false);
    const res = await setSecret(service.id, name, submitted);
    setBusy(false);
    if (!res.ok) return setFailure(res);
    setSaved(true);
    onSaved();
  };

  return (
    <li data-testid={`service-secret-${name}`} className="space-y-1 rounded border border-[var(--border-subtle)] p-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <strong className="font-mono text-[var(--text-primary)]">{name}</strong>
        <code className={`${HELP_CLASS} font-mono`} data-testid={`service-secret-ref-${name}`}>
          {ref}
        </code>
        <Chip tone={configured ? "neutral" : "orange"} testId={`service-secret-badge-${name}`}>
          {configured ? i18nT("services.secret.set", undefined, "Set") : i18nT("services.secret.notSet", undefined, "Not set")}
        </Chip>
      </div>
      {storeBacked ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1">
            <label id={labelId} htmlFor={secretInputId(service.id, name)} className={LABEL_CLASS}>
              {configured
                ? i18nT("services.secret.replace", { name }, "New value for {name}")
                : i18nT("services.secret.enter", { name }, "Value for {name}")}
            </label>
            <input
              id={secretInputId(service.id, name)}
              type="password"
              autoComplete="new-password"
              className={INPUT_CLASS}
              value={value}
              disabled={disabled || busy}
              onChange={(e) => setValue(e.target.value)}
              data-testid={`service-secret-input-${name}`}
            />
          </div>
          <button type="button" className={BUTTON_CLASS} disabled={disabled || busy || value.length === 0} onClick={save} data-testid={`service-secret-save-${name}`}>
            {i18nT("common.save", undefined, "Save")}
          </button>
        </div>
      ) : (
        <p className={HELP_CLASS}>{i18nT("services.secret.readOnly", undefined, "Resolved from outside the dashboard — change it there.")}</p>
      )}
      {saved && (
        <p role="status" className={HELP_CLASS}>
          {i18nT("services.secret.saved", undefined, "Saved. A running service picks the new value up at its next start.")}
        </p>
      )}
      <ActionFailure failure={failure} testId={`service-secret-error-${name}`} />
    </li>
  );
}

export function ServiceSecretsSection({ service, disabled, onSaved }: { service: ServiceStatus; disabled: boolean; onSaved: () => void }) {
  const names = Object.keys(service.secrets);
  if (names.length === 0) return null;
  return (
    <section aria-labelledby="service-secrets-title" data-testid="service-secrets">
      <SectionTitle id="service-secrets-title">{i18nT("services.secrets.title", undefined, "Secrets")}</SectionTitle>
      <ul className="m-0 list-none space-y-2 p-0">
        {names.map((n) => (
          <SecretRow key={n} service={service} name={n} disabled={disabled} onSaved={onSaved} />
        ))}
      </ul>
    </section>
  );
}
