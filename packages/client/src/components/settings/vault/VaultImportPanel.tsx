/**
 * Non-destructive import. Two sources: known locations (listed by existence
 * only, selected by opaque id) and a file you pick in the browser (its contents
 * are uploaded, at most 64 KiB). The proposal lists key NAMES only; you confirm
 * which to create. Source files are never modified, so the copies stay where
 * they were: delete them yourself after importing.
 * See change: add-credential-vault (D7).
 */
import { useEffect, useState } from "react";
import { t as i18nT } from "../../../lib/i18n/i18n.js";
import {
  confirmImport,
  type ImportCandidate,
  type ImportProposal,
  listImportCandidates,
  proposeImport,
} from "../../../lib/vault/vault-api.js";
import { BUTTON_CLASS, ErrorLine, LIST_CLASS, Panel, ROW_CLASS } from "./vault-ui.js";

const MAX_UPLOAD_BYTES = 64 * 1024;

export function VaultImportPanel({ onChanged }: { onChanged: () => void | Promise<void> }) {
  const [candidates, setCandidates] = useState<ImportCandidate[]>([]);
  const [proposal, setProposal] = useState<ImportProposal | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);

  useEffect(() => {
    void listImportCandidates()
      .then((r) => {
        if (r.ok && r.data) setCandidates(r.data);
      })
      .catch(() => {});
  }, []);

  const open = (p: ImportProposal) => {
    setProposal(p);
    setSelected(new Set(p.items.map((i) => i.name)));
    setDone(null);
  };

  const fromCandidate = async (id: string) => {
    setError(null);
    const res = await proposeImport({ candidateId: id });
    if (!res.ok || !res.data) return setError(res.error ?? `HTTP ${res.status}`);
    open(res.data);
  };

  const fromFile = async (file: File | undefined) => {
    setError(null);
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) return setError(i18nT("vault.fileTooLarge", undefined, "That file is larger than 64 KiB."));
    const res = await proposeImport({ content: await file.text() });
    if (!res.ok || !res.data) return setError(res.error ?? `HTTP ${res.status}`);
    open(res.data);
  };

  const confirm = async () => {
    if (!proposal) return;
    setError(null);
    const res = await confirmImport(proposal.id, [...selected]);
    if (!res.ok) return setError(res.error ?? `HTTP ${res.status}`);
    setDone(res.data?.created.length ?? 0);
    setProposal(null);
    await onChanged();
  };

  return (
    <Panel
      id="import"
      title={i18nT("vault.import", undefined, "Import keys")}
      hint={i18nT("vault.importHint", undefined, "Reads only what you select and never changes the source file. After importing, delete the original copies yourself.")}
    >
      <ErrorLine error={error} testId="vault-import-error" />
      {done !== null && (
        <div className="text-xs text-[var(--accent-green-text)]" data-testid="vault-import-done">
          {i18nT("vault.imported", { count: done }, "Imported {count} account(s). Remember to delete the original files.")}
        </div>
      )}
      {!proposal && (
        <div className="space-y-2">
          <div className={LIST_CLASS} data-testid="vault-import-candidates">
            {candidates.filter((c) => c.exists).length === 0 && (
              <div className="px-2 py-2 text-xs text-[var(--text-tertiary)]">{i18nT("vault.noCandidates", undefined, "No known key files found.")}</div>
            )}
            {candidates
              .filter((c) => c.exists)
              .map((c) => (
                <div key={c.id} className={ROW_CLASS}>
                  <span className="text-xs text-[var(--text-secondary)] flex-1 min-w-0 truncate">{c.label}</span>
                  <button type="button" className={BUTTON_CLASS} onClick={() => void fromCandidate(c.id)}>
                    {i18nT("vault.review", undefined, "Review")}
                  </button>
                </div>
              ))}
          </div>
          <label className="text-xs text-[var(--text-secondary)] flex items-center gap-2">
            {i18nT("vault.uploadFile", undefined, "Or pick a .env / JSON file:")}
            <input type="file" data-testid="vault-import-file" onChange={(e) => void fromFile(e.target.files?.[0])} />
          </label>
        </div>
      )}
      {proposal && (
        <div className="space-y-2" data-testid="vault-import-proposal">
          <div className={LIST_CLASS}>
            {proposal.items.map((i) => (
              <label key={i.name} className={ROW_CLASS}>
                <input
                  type="checkbox"
                  checked={selected.has(i.name)}
                  onChange={(e) => {
                    const next = new Set(selected);
                    if (e.target.checked) next.add(i.name);
                    else next.delete(i.name);
                    setSelected(next);
                  }}
                />
                <span className="text-xs font-mono text-[var(--text-primary)]">{i.name}</span>
              </label>
            ))}
            {proposal.skipped.map((s) => (
              <div key={s.name} className={ROW_CLASS} data-testid="vault-import-skipped">
                <span className="text-xs font-mono text-[var(--text-tertiary)]">{s.name}</span>
                <span className="text-xs text-[var(--text-tertiary)]">{s.reason}</span>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <button type="button" className={BUTTON_CLASS} disabled={selected.size === 0} onClick={() => void confirm()}>
              {i18nT("vault.importSelected", undefined, "Import selected")}
            </button>
            <button type="button" className={BUTTON_CLASS} onClick={() => setProposal(null)}>
              {i18nT("common.cancel", undefined, "Cancel")}
            </button>
          </div>
        </div>
      )}
    </Panel>
  );
}
