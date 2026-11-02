/**
 * Vault Import tab. Two sources: known locations (listed by existence only, selected by opaque id)
 * and a file you pick in the browser (its contents are uploaded, at most 64 KiB). The proposal lists
 * key NAMES only, and the account each becomes; you confirm which to create, and may also create a
 * same-name variable for each new key. Source files are never modified, so the copies stay where
 * they were: delete them yourself after importing.
 *
 * Not atomic by design: the accounts are created first; each variable is a separate call, and the
 * done callout names the ones that were not created.
 * See change: add-credential-vault (D7); retro-ux-credential-vault (D3).
 */

import { isDeliverableEnvName, isReservedEnvName } from "@blackbelt-technology/pi-dashboard-shared/vault-delivery.js";
import { mdiAlertOutline, mdiCheckCircleOutline, mdiFileImportOutline } from "@mdi/js";
import { useId, useState } from "react";
import { t as i18nT } from "../../../lib/i18n/i18n.js";
import {
  confirmImport,
  createBinding,
  type ImportCandidate,
  type ImportProposal,
  isVaultWriteBlocked,
  proposeImport,
  type VaultOverview,
} from "../../../lib/vault/vault-api.js";
import {
  BUTTON_CLASS,
  Callout,
  ErrorLine,
  HELP_CLASS,
  INPUT_CLASS,
  INSET_CLASS,
  LABEL_CLASS,
  PRIMARY_BUTTON_CLASS,
  ROW_CLASS,
  SECTION_TITLE_CLASS,
  VIcon,
} from "./vault-ui.js";

const MAX_UPLOAD_BYTES = 64 * 1024;

interface Done {
  count: number;
  created: string[];
  failed: string[];
  source: string;
}

/** Why a name gets no variable, or undefined when it can get one. */
function noVariableReason(name: string): string | undefined {
  if (isDeliverableEnvName(name)) return undefined;
  return isReservedEnvName(name)
    ? i18nT("vault.import.noVariableReserved", undefined, "no variable: reserved name")
    : i18nT("vault.import.noVariableInvalid", undefined, "no variable: not a valid variable name");
}

/** One variable per imported key, named like the key; not atomic, so failures are reported by name. */
async function createSameNameVariables(
  selected: Set<string>,
  accounts: Array<{ id: string; label: string }>,
  overview: VaultOverview,
): Promise<{ created: string[]; failed: string[] }> {
  const created: string[] = [];
  const failed: string[] = [];
  for (const name of selected) {
    // Created accounts carry the env name as their label, unique within one import.
    const account = accounts.find((a) => a.label === name);
    if (!account || noVariableReason(name) || overview.bindings.some((b) => b.name === name)) continue;
    const made = await createBinding({ name, defaultAccountId: account.id });
    (made.ok ? created : failed).push(name);
  }
  return { created, failed };
}

function DoneCallout({ done, onGoToVariables }: { done: Done; onGoToVariables?: () => void }) {
  return (
    <Callout tone="info" icon={mdiCheckCircleOutline} role="status" testId="vault-import-done">
      <strong>{i18nT("vault.imported", { count: done.count }, "Imported {count} account(s). Remember to delete the original files.")}</strong>
      {done.created.length > 0 && (
        <p className="mt-1" data-testid="vault-import-created">
          {i18nT("vault.import.variablesCreated", { names: done.created.join(", ") }, "Variables created: {names}.")}
        </p>
      )}
      {done.failed.length > 0 && (
        <p className="mt-1" data-testid="vault-import-failed">
          <VIcon path={mdiAlertOutline} size={0.55} className="mr-1 inline" />
          {i18nT("vault.import.variablesFailed", { names: done.failed.join(", ") }, "Variables not created: {names}. Create them under Variables.")}
        </p>
      )}
      <p className="mt-1">{i18nT("vault.import.originals", { source: done.source }, "The originals are still in {source}. Delete that copy yourself.")}</p>
      {done.created.length > 0 && onGoToVariables && (
        <div className="mt-2">
          <button type="button" className={BUTTON_CLASS} onClick={onGoToVariables}>
            {i18nT("vault.import.grantThem", undefined, "Grant them to a project")}
          </button>
        </div>
      )}
    </Callout>
  );
}

function PickSource({
  ids,
  candidates,
  disabled,
  onCandidate,
  onFile,
}: {
  ids: string;
  candidates: ImportCandidate[];
  disabled: boolean;
  onCandidate: (c: ImportCandidate) => void;
  onFile: (file: File | undefined) => void;
}) {
  return (
  <>
    <p className={`${HELP_CLASS} m-0`}>
      {i18nT("vault.importHint", undefined, "Import reads only what you select and never changes the source file.")}
    </p>
    <section className="space-y-1.5">
      <h4 className={SECTION_TITLE_CLASS}>{i18nT("vault.import.found", undefined, "Key files found on this dashboard")}</h4>
      {candidates.length === 0 ? (
        <p className={HELP_CLASS}>{i18nT("vault.noCandidates", undefined, "No known key files found.")}</p>
      ) : (
        <ul className="space-y-2" data-testid="vault-import-candidates">
          {candidates.map((c) => (
            <li key={c.id} className={`${ROW_CLASS} items-center`}>
              <VIcon path={mdiFileImportOutline} size={0.8} className="text-[var(--text-secondary)]" />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--text-primary)]">{c.label}</span>
              <button
                type="button"
                data-testid="vault-import-review"
                className={BUTTON_CLASS}
                disabled={disabled}
                aria-label={i18nT("vault.reviewAria", { label: c.label }, "Review {label}")}
                onClick={() => onCandidate(c)}
              >
                {i18nT("vault.review", undefined, "Review")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
    <div>
      <label className={LABEL_CLASS} htmlFor={`${ids}-file`}>
        {i18nT("vault.uploadFile", undefined, "Or choose a .env or JSON file (up to 64 KiB)")}
      </label>
      <input
        id={`${ids}-file`}
        type="file"
        data-testid="vault-import-file"
        className={INPUT_CLASS}
        accept=".env,.json,text/plain,application/json"
        disabled={disabled}
        onChange={(e) => onFile(e.target.files?.[0])}
      />
    </div>
  </>
  );
}

function importNote(name: string, withVariables: boolean, hasBinding: boolean): string | undefined {
  const reason = noVariableReason(name);
  if (reason || !withVariables) return reason;
  return hasBinding ? i18nT("vault.import.variableExists", undefined, "variable already exists") : i18nT("vault.import.variableCreated", undefined, "variable will be created");
}

function ProposalForm({
  proposal,
  overview,
  selected,
  withVariables,
  busy,
  disabled,
  onSelected,
  onWithVariables,
  onConfirm,
  onCancel,
}: {
  proposal: ImportProposal & { source: string };
  overview: VaultOverview;
  selected: Set<string>;
  withVariables: boolean;
  busy: boolean;
  disabled: boolean;
  onSelected: (next: Set<string>) => void;
  onWithVariables: (on: boolean) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <form
      className={`${INSET_CLASS} space-y-3`}
      data-testid="vault-import-proposal"
      onSubmit={(e) => {
        e.preventDefault();
        onConfirm();
      }}
    >
      <div>
        <h4 className={SECTION_TITLE_CLASS}>{i18nT("vault.import.reviewTitle", { source: proposal.source }, "Review: {source}")}</h4>
        <p className={`${HELP_CLASS} mt-1`}>{i18nT("vault.import.namesOnly", undefined, "Only the names are shown. Values are read on the dashboard and never sent to this page.")}</p>
      </div>
      <fieldset className="m-0 min-w-0 space-y-1 border-0 p-0">
        <legend className={LABEL_CLASS}>{i18nT("vault.import.keysToImport", undefined, "Keys to import")}</legend>
        {proposal.items.map((i) => {
              const note = importNote(i.name, withVariables, overview.bindings.some((b) => b.name === i.name));
          return (
            <label key={i.name} className="flex min-h-[32px] items-start gap-2 text-xs text-[var(--text-primary)]">
              <input
                type="checkbox"
                className="focus-ring mt-0.5"
                checked={selected.has(i.name)}
                onChange={(e) => {
                  const next = new Set(selected);
                  if (e.target.checked) next.add(i.name);
                  else next.delete(i.name);
                  onSelected(next);
                }}
              />
              <span>
                <code className="font-mono">{i.name}</code> <span className={HELP_CLASS}>{i18nT("vault.import.becomesAccount", { name: i.name }, "→ account {name}")}</span>
                {note && (
                  <span className={`${HELP_CLASS} block`} data-testid={`vault-import-note-${i.name}`}>
                    {note}
                  </span>
                )}
              </span>
            </label>
          );
        })}
      </fieldset>
      {proposal.skipped.length > 0 && (
        <div>
          <h4 className={SECTION_TITLE_CLASS}>{i18nT("vault.import.skipped", { count: proposal.skipped.length }, "Skipped ({count})")}</h4>
          <ul className="mt-1 space-y-0.5">
            {proposal.skipped.map((s) => (
              <li key={s.name} className={HELP_CLASS} data-testid="vault-import-skipped">
                <code className="font-mono">{s.name}</code>: {s.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
      <label className="flex min-h-[32px] items-start gap-2 text-xs text-[var(--text-primary)]">
        <input
          type="checkbox"
          data-testid="vault-import-variable-toggle"
          className="focus-ring mt-0.5"
          checked={withVariables}
          onChange={(e) => onWithVariables(e.target.checked)}
        />
        <span>{i18nT("vault.import.alsoVariables", undefined, "Also create a variable with the same name for each new key (skipped when it already exists)")}</span>
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="submit" data-testid="vault-import-confirm" className={PRIMARY_BUTTON_CLASS} disabled={disabled || busy || selected.size === 0}>
          <VIcon path={mdiFileImportOutline} size={0.6} />
          {selected.size === 1
            ? i18nT("vault.importSelectedOne", undefined, "Import 1 key")
            : i18nT("vault.importSelectedMany", { count: selected.size }, "Import {count} keys")}
        </button>
        <button type="button" className={BUTTON_CLASS} onClick={onCancel}>
          {i18nT("common.cancel", undefined, "Cancel")}
        </button>
      </div>
    </form>
  );
}

export function VaultImportPanel({
  overview,
  candidates,
  onChanged,
  onGoToVariables,
}: {
  overview: VaultOverview;
  candidates: ImportCandidate[];
  onChanged: () => void | Promise<void>;
  /** Shown on the done callout when variables were created. */
  onGoToVariables?: () => void;
}) {
  const ids = useId();
  const [proposal, setProposal] = useState<(ImportProposal & { source: string }) | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [withVariables, setWithVariables] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const disabled = isVaultWriteBlocked(overview.status);

  const open = (p: ImportProposal, source: string) => {
    setProposal({ ...p, source });
    setSelected(new Set(p.items.map((i) => i.name)));
    setDone(null);
  };

  const fromCandidate = async (c: ImportCandidate) => {
    setError(null);
    const res = await proposeImport({ candidateId: c.id });
    if (!res.ok || !res.data) return setError(res.error ?? `HTTP ${res.status}`);
    open(res.data, c.label);
  };

  const fromFile = async (file: File | undefined) => {
    setError(null);
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) return setError(i18nT("vault.fileTooLarge", undefined, "That file is larger than 64 KiB."));
    const res = await proposeImport({ content: await file.text() });
    if (!res.ok || !res.data) return setError(res.error ?? `HTTP ${res.status}`);
    open(res.data, file.name);
  };


  const confirm = async () => {
    if (!proposal) return;
    setBusy(true);
    setError(null);
    try {
      const res = await confirmImport(proposal.id, [...selected]);
      if (!res.ok) return setError(res.error ?? `HTTP ${res.status}`);
      const accounts = res.data?.created ?? [];
      const { created, failed } = withVariables
        ? await createSameNameVariables(selected, accounts, overview)
        : { created: [] as string[], failed: [] as string[] };
      setDone({ count: accounts.length, created, failed, source: proposal.source });
      setProposal(null);
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  const existing = candidates.filter((c) => c.exists);

  return (
    <div className="space-y-3">
      <ErrorLine error={error} testId="vault-import-error" />
      {done && <DoneCallout done={done} onGoToVariables={onGoToVariables} />}

      {!proposal && (
        <PickSource ids={ids} candidates={existing} disabled={disabled} onCandidate={(c) => void fromCandidate(c)} onFile={(f) => void fromFile(f)} />
      )}

      {proposal && (
        <ProposalForm
          proposal={proposal}
          overview={overview}
          selected={selected}
          withVariables={withVariables}
          busy={busy}
          disabled={disabled}
          onSelected={setSelected}
          onWithVariables={setWithVariables}
          onConfirm={() => void confirm()}
          onCancel={() => setProposal(null)}
        />
      )}
    </div>
  );
}
