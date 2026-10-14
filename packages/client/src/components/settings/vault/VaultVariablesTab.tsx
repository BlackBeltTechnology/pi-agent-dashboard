/**
 * Vault Variables tab: one card per env binding (`VaultVariableCard`), a new-variable form that
 * catches a reserved name at the field, a request row for each plugin declaration that names a
 * variable that does not exist, and the confirmed checkouts that match no grant.
 * See change: retro-ux-credential-vault (D1, D8).
 */

import { isDeliverableEnvName, isReservedEnvName } from "@blackbelt-technology/pi-dashboard-shared/vault-delivery.js";
import { mdiPlus, mdiPuzzleOutline } from "@mdi/js";
import { useId, useState } from "react";
import { t as i18nT } from "../../../lib/i18n/i18n.js";
import { createBinding, repoSubject, revokeConfirmation, type VaultOverview } from "../../../lib/vault/vault-api.js";
import { PluginApprovalRow, VaultVariableCard } from "./VaultVariableCard.js";
import {
  BUTTON_CLASS,
  Callout,
  deviceName,
  ErrorLine,
  FieldError,
  GHOST_BUTTON_CLASS,
  HELP_CLASS,
  INPUT_CLASS,
  INSET_CLASS,
  LABEL_CLASS,
  PRIMARY_BUTTON_CLASS,
  ROW_CLASS,
  runOp,
  SECTION_TITLE_CLASS,
  VIcon,
} from "./vault-ui.js";

/** An example variable name (a technical token, not copy). */
const EXAMPLE_BINDING = "GEMINI_API_KEY";
const EXAMPLE_SAFE_NAME = "MY_SERVICE_TOKEN";

export function VaultVariablesTab({ overview, onChanged }: { overview: VaultOverview; onChanged: () => void | Promise<void> }) {
  const ids = useId();
  const disabled = overview.status.state === "corrupt";
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState("");
  const [defaultId, setDefaultId] = useState("");
  const [nameError, setNameError] = useState<"reserved" | "invalid" | null>(null);

  const keyAccounts = overview.accounts.filter((a) => a.kind === "key");
  const requests = overview.plugins.flatMap((p) => p.declared.filter((n) => !overview.bindings.some((b) => b.name === n)).map((n) => ({ plugin: p, name: n })));
  const orphanCheckouts = overview.confirmations.filter((c) => !overview.grants.some((g) => g.subject === repoSubject(c.repoKey)));
  const approved = (pluginId: string, binding: string) => overview.pluginApprovals.some((a) => a.pluginId === pluginId && a.bindingName === binding);

  const create = async () => {
    const trimmed = name.trim();
    if (!isDeliverableEnvName(trimmed)) return setNameError(isReservedEnvName(trimmed) ? "reserved" : "invalid");
    if (await runOp(() => createBinding({ name: trimmed, defaultAccountId: defaultId || undefined }), setError, onChanged)) {
      setName("");
      setDefaultId("");
      setNameError(null);
      setFormOpen(false);
    }
  };

  return (
    <div className="space-y-3">
      <ErrorLine error={error} testId="vault-bindings-error" />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={`${HELP_CLASS} m-0`}>
          {i18nT("vault.bindingsHint", undefined, "A variable is the environment name a session sees, such as GEMINI_API_KEY.")}
        </p>
        <button type="button" data-testid="vault-variable-new" aria-expanded={formOpen} className={BUTTON_CLASS} disabled={disabled} onClick={() => setFormOpen((o) => !o)}>
          <VIcon path={mdiPlus} size={0.6} />
          {i18nT("vault.newVariable", undefined, "New variable")}
        </button>
      </div>

      {formOpen && (
        <form
          data-testid="vault-binding-form"
          className={`${INSET_CLASS} grid gap-3 sm:grid-cols-2`}
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <div>
            <label className={LABEL_CLASS} htmlFor={`${ids}-name`}>
              {i18nT("vault.bindingName", undefined, "Variable name")}
            </label>
            <input
              id={`${ids}-name`}
              className={`${INPUT_CLASS} font-mono`}
              placeholder={EXAMPLE_BINDING}
              aria-invalid={nameError !== null}
              aria-describedby={nameError ? `${ids}-name-e` : undefined}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setNameError(null);
              }}
            />
          </div>
          <div>
            <label className={LABEL_CLASS} htmlFor={`${ids}-default`}>
              {i18nT("vault.defaultAccount", undefined, "Default account")}
            </label>
            <select id={`${ids}-default`} className={INPUT_CLASS} value={defaultId} onChange={(e) => setDefaultId(e.target.value)}>
              <option value="">{i18nT("vault.noDefaultAccount", undefined, "No default account")}</option>
              {keyAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.provider} / {a.label}
                </option>
              ))}
            </select>
          </div>
          {nameError && (
            <div className="sm:col-span-2">
              <FieldError id={`${ids}-name-e`}>
                {nameError === "reserved"
                  ? i18nT("vault.nameReserved", { name: name.trim(), example: EXAMPLE_SAFE_NAME }, "{name} is reserved by the system, so a session can't receive it. Use a name like {example}.")
                  : i18nT("vault.nameInvalid", { name: name.trim() }, "{name} isn't a valid variable name. Use capital letters, digits and underscores, starting with a letter or underscore.")}
              </FieldError>
            </div>
          )}
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <button type="submit" data-testid="vault-variable-create" className={PRIMARY_BUTTON_CLASS} disabled={disabled || name.trim() === ""}>
              <VIcon path={mdiPlus} size={0.6} />
              {i18nT("vault.createVariableButton", undefined, "Create")}
            </button>
            <button type="button" className={BUTTON_CLASS} onClick={() => setFormOpen(false)}>
              {i18nT("common.cancel", undefined, "Cancel")}
            </button>
          </div>
        </form>
      )}

      {requests.map(({ plugin, name: requested }) => (
        <Callout key={`${plugin.pluginId}|${requested}`} tone="info" icon={mdiPuzzleOutline} testId="vault-plugin-request">
          {i18nT("vault.pluginRequest", { plugin: plugin.displayName, name: requested }, "{plugin} can read {name}, but no such variable exists yet.")}
          <PluginApprovalRow
            compact
            plugin={plugin}
            name={requested}
            approved={approved(plugin.pluginId, requested)}
            disabled={disabled}
            onChanged={onChanged}
            onError={setError}
            action={
              <button
                type="button"
                className={BUTTON_CLASS}
                disabled={disabled}
                onClick={() => void runOp(() => createBinding({ name: requested }), setError, onChanged)}
              >
                <VIcon path={mdiPlus} size={0.6} />
                {i18nT("vault.createNamed", { name: requested }, "Create {name}")}
              </button>
            }
          />
        </Callout>
      ))}

      {overview.bindings.length === 0 && (
        <p className={HELP_CLASS} data-testid="vault-variables-empty">
          {i18nT("vault.noBindings", undefined, "No variables yet. Create one to choose which key sessions see under that name.")}
        </p>
      )}
      <div data-testid="vault-bindings-list" className="space-y-3">
        <div data-testid="vault-grants-list" className="space-y-3">
          {overview.bindings.map((b) => (
            <VaultVariableCard key={b.name} binding={b} overview={overview} disabled={disabled} onChanged={onChanged} onError={setError} />
          ))}
        </div>
      </div>

      {orphanCheckouts.length > 0 && (
        <section className="space-y-1.5">
          <h4 className={SECTION_TITLE_CLASS}>{i18nT("vault.confirmations", undefined, "Other confirmed checkouts")}</h4>
          <p className={HELP_CLASS}>
            {i18nT("vault.confirmationsHint", undefined, "These checkouts are confirmed but no variable is granted to their repository. Revoking one withdraws any values it holds.")}
          </p>
          <ul className="space-y-2" data-testid="vault-confirmations-list">
            {orphanCheckouts.map((c) => (
              <li key={`${c.deviceId}|${c.dir}|${c.repoKey}`} className={`${ROW_CLASS} items-center`} data-testid="vault-confirmation-row">
                <span className="font-mono text-xs text-[var(--text-primary)]">{c.repoKey}</span>
                <span className={`${HELP_CLASS} min-w-0 flex-1 break-all`}>
                  {c.dir} · {deviceName(c.deviceId)}
                </span>
                <button
                  type="button"
                  data-testid="vault-checkout-revoke"
                  className={GHOST_BUTTON_CLASS}
                  disabled={disabled}
                  aria-label={i18nT("vault.revokeCheckoutAria", { dir: c.dir }, "Revoke checkout {dir}")}
                  onClick={() => void runOp(() => revokeConfirmation(c), setError, onChanged)}
                >
                  {i18nT("vault.revoke", undefined, "Revoke")}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
