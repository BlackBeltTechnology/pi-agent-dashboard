/**
 * "Grant to a project": choose from projects with a connected session and projects the hub
 * remembers, or enter a repository / folder by hand. Already-granted and refused entries are listed
 * as unavailable with their reason; a session the hub does not trust never yields a repository key.
 *
 * A manually entered repository is normalised like a session's origin before it is compared or
 * granted. A project that already has a grant for this variable sends no second one: `createGrant`
 * upserts, and an upsert without an account would drop an existing per-project account.
 * See change: retro-ux-credential-vault (D2).
 */

import { normalizeOrigin } from "@blackbelt-technology/pi-dashboard-shared/vault-origin.js";
import { mdiCheck, mdiFolderOutline, mdiInformationOutline, mdiLockOutline, mdiSourceRepository } from "@mdi/js";
import { useEffect, useId, useState } from "react";
import { t as i18nT } from "../../../lib/i18n/i18n.js";
import {
  createGrant,
  dirSubject,
  fetchVaultProjects,
  lastSegment,
  repoSubject,
  type VaultBindingView,
  type VaultOverview,
  type VaultProjects,
  type VaultProjectView,
} from "../../../lib/vault/vault-api.js";
import {
  BUTTON_CLASS,
  Callout,
  deviceName,
  ErrorLine,
  FieldError,
  HELP_CLASS,
  INPUT_CLASS,
  INSET_CLASS,
  LABEL_CLASS,
  PRIMARY_BUTTON_CLASS,
  StatusPill,
  VIcon,
} from "./vault-ui.js";

const DAY_MS = 86_400_000;

type Load = { phase: "loading" } | { phase: "ready"; projects: VaultProjects } | { phase: "unsupported" } | { phase: "error"; message: string };

/** `github.com/acme/app`, `git@github.com:acme/app.git` and `https://GitHub.com/acme/app` are one repository. */
function normalizeRepoInput(raw: string): string | undefined {
  const text = raw.trim();
  if (!text || /\s/.test(text)) return undefined;
  return normalizeOrigin(text) ?? normalizeOrigin(`https://${text}`);
}

/** The subject a project entry would be granted as; undefined for a refused or incomplete entry. */
function entrySubject(p: VaultProjectView): string | undefined {
  if (p.blocked) return undefined;
  if (p.repoKey) return repoSubject(p.repoKey);
  return p.deviceId ? dirSubject(p.deviceId, p.dir) : undefined;
}

const blockedReason = (blocked: NonNullable<VaultProjectView["blocked"]>): string =>
  blocked === "transport-insecure"
    ? i18nT("vault.blocked.transportInsecure", undefined, "This session has no proven TLS connection, so it gets no keys (transport-insecure).")
    : i18nT("vault.blocked.untrusted", undefined, "This session is not trusted, so it gets no keys.");

function whereLine(p: VaultProjectView): string {
  const parts: string[] = [];
  if (p.sessions !== undefined) {
    parts.push(p.sessions === 1 ? i18nT("vault.sessionsOne", undefined, "1 session") : i18nT("vault.sessionsMany", { count: p.sessions }, "{count} sessions"));
  }
  if (p.lastSeenAt !== undefined) {
    const days = Math.max(0, Math.floor((Date.now() - p.lastSeenAt) / DAY_MS));
    parts.push(days === 0 ? i18nT("vault.seenToday", undefined, "last seen today") : i18nT("vault.seenDays", { count: days }, "last seen {count} days ago"));
  }
  if (p.deviceId) parts.push(deviceName(p.deviceId));
  return parts.join(" · ");
}

function filterProjects(list: VaultProjectView[], search: string): VaultProjectView[] {
  const q = search.trim().toLowerCase();
  if (!q) return list;
  return list.filter((p) => `${lastSegment(p.repoKey ?? p.dir)} ${p.repoKey ?? ""} ${p.dir}`.toLowerCase().includes(q));
}

interface ManualFields {
  kind: "repo" | "dir";
  setKind: (k: "repo" | "dir") => void;
  repoText: string;
  setRepoText: (v: string) => void;
  device: string;
  setDevice: (v: string) => void;
  dirText: string;
  setDirText: (v: string) => void;
}

/** The subject a manual entry would grant, or undefined while it is incomplete or invalid. */
function manualSubject(m: ManualFields): string | undefined {
  if (m.kind === "repo") {
    const key = normalizeRepoInput(m.repoText);
    return key && repoSubject(key);
  }
  return m.device.trim() && m.dirText.trim() ? dirSubject(m.device.trim(), m.dirText.trim()) : undefined;
}

function ProjectOption({
  p,
  radioName,
  chosen,
  isGranted,
  onChoose,
}: {
  p: VaultProjectView;
  radioName: string;
  chosen: string | null;
  isGranted: boolean;
  onChoose: (subject: string) => void;
}) {
  const sub = entrySubject(p);
  const off = !sub || isGranted;
  const showKey = p.blocked ? undefined : p.repoKey;
  return (
    <label
      aria-disabled={off}
      className={`flex min-h-[44px] items-start gap-2 rounded-md px-2 py-1.5 text-xs ${off ? "cursor-not-allowed" : "cursor-pointer hover:bg-[var(--bg-hover)]"} ${chosen === sub && sub ? "shadow-[inset_2px_0_0_var(--accent-primary)]" : ""}`}
    >
      <input type="radio" name={radioName} className="focus-ring mt-0.5" disabled={off} checked={!!sub && chosen === sub} onChange={() => sub && onChoose(sub)} />
      <span className="min-w-0 flex-1">
        <span className={`flex flex-wrap items-center gap-1.5 text-sm font-semibold ${off ? "text-[var(--text-secondary)]" : "text-[var(--text-primary)]"}`}>
          <VIcon path={showKey ? mdiSourceRepository : mdiFolderOutline} size={0.65} />
          {lastSegment(showKey ?? p.dir)}
          {isGranted && <StatusPill tone="neutral" icon={mdiCheck} label={i18nT("vault.alreadyGranted", undefined, "Already granted")} />}
        </span>
        <span className="block break-all text-[var(--text-secondary)]">{showKey ?? p.dir}</span>
        <span className="block text-[var(--text-secondary)]">{whereLine(p)}</span>
        {p.blocked && (
          <span className="mt-0.5 flex items-start gap-1 text-[var(--text-secondary)]">
            <VIcon path={mdiLockOutline} size={0.55} className="mt-0.5" />
            {blockedReason(p.blocked)}
          </span>
        )}
      </span>
    </label>
  );
}

function ProjectGroup({
  testId,
  legend,
  list,
  radioName,
  chosen,
  isGranted,
  onChoose,
}: {
  testId: string;
  legend: string;
  list: VaultProjectView[];
  radioName: string;
  chosen: string | null;
  isGranted: (subject: string | undefined) => boolean;
  onChoose: (subject: string) => void;
}) {
  if (list.length === 0) return null;
  return (
    <fieldset data-testid={testId} className="m-0 min-w-0 border-0 p-0">
      <legend className="mb-1 text-xs font-semibold text-[var(--text-secondary)]">{legend}</legend>
      <div className="space-y-0.5">
        {list.map((p) => (
          <ProjectOption key={`${entrySubject(p) ?? "blocked"}|${p.dir}`} p={p} radioName={radioName} chosen={chosen} isGranted={isGranted(entrySubject(p))} onChoose={onChoose} />
        ))}
      </div>
    </fieldset>
  );
}

function ManualEntry({ ids, m, repoInvalid, canGoBack, onBack }: { ids: string; m: ManualFields; repoInvalid: boolean; canGoBack: boolean; onBack: () => void }) {
  return (
  <div className="space-y-3">
    <div>
      <span id={`${ids}-kind`} className={LABEL_CLASS}>
        {i18nT("vault.subjectKind", undefined, "Project kind")}
      </span>
      <div role="group" aria-labelledby={`${ids}-kind`} className="inline-flex overflow-hidden rounded-md border border-[var(--border-secondary)]">
        {(["repo", "dir"] as const).map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={m.kind === k}
            className={`focus-ring min-h-[32px] px-3 text-xs font-semibold ${m.kind === k ? "bg-[var(--tint-blue-bg)] text-[var(--tint-blue-fg)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"}`}
            onClick={() => m.setKind(k)}
          >
            {k === "repo" ? i18nT("vault.repo", undefined, "Repository") : i18nT("vault.folder", undefined, "Folder")}
          </button>
        ))}
      </div>
    </div>
    {m.kind === "repo" ? (
      <div>
        <label className={LABEL_CLASS} htmlFor={`${ids}-repo`}>
          {i18nT("vault.repoKey", undefined, "Repository")}
        </label>
        <input
          id={`${ids}-repo`}
          className={`${INPUT_CLASS} font-mono`}
          placeholder="github.com/acme/app"
          aria-invalid={repoInvalid}
          aria-describedby={`${ids}-repo-d`}
          value={m.repoText}
          onChange={(e) => m.setRepoText(e.target.value)}
        />
        {repoInvalid ? (
          <FieldError id={`${ids}-repo-d`}>{i18nT("vault.repoInvalid", undefined, "Enter the repository as in the git remote, for example github.com/acme/app.")}</FieldError>
        ) : (
          <p id={`${ids}-repo-d`} className={`${HELP_CLASS} mt-1`}>
            {i18nT("vault.repoHelp", undefined, "As in the git remote, without scheme or .git. SSH and HTTPS clones of the same repository match.")}
          </p>
        )}
      </div>
    ) : (
      <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
        <div>
          <label className={LABEL_CLASS} htmlFor={`${ids}-device`}>
            {i18nT("vault.device", undefined, "Device id")}
          </label>
          <input id={`${ids}-device`} className={INPUT_CLASS} value={m.device} onChange={(e) => m.setDevice(e.target.value)} />
        </div>
        <div>
          <label className={LABEL_CLASS} htmlFor={`${ids}-dir`}>
            {i18nT("vault.folderPath", undefined, "Folder path")}
          </label>
          <input id={`${ids}-dir`} className={`${INPUT_CLASS} font-mono`} placeholder="/work/project" value={m.dirText} onChange={(e) => m.setDirText(e.target.value)} />
        </div>
        <p className={`${HELP_CLASS} sm:col-span-2`}>
          {i18nT("vault.folderHelp", undefined, "This dashboard is the device hub. Enter the exact path; subfolders are not included.")}
        </p>
      </div>
    )}
    {canGoBack && (
      <button type="button" className="focus-ring min-h-[32px] text-xs font-semibold text-[var(--link)] hover:text-[var(--link-hover)] hover:underline" onClick={onBack}>
        {i18nT("vault.chooseFromList", undefined, "Choose from the list instead")}
      </button>
    )}
  </div>
  );
}

/** Short project name of a `repo:<key>` or `dir:<device>:<path>` subject. */
function subjectProjectName(subject: string): string {
  return subject.startsWith("repo:") ? lastSegment(subject.slice(5)) : lastSegment(subject.split(":").slice(2).join(":"));
}

/** Loads the project lists once; `onUnavailable` fires when they cannot be shown (manual entry only). */
function useProjectLoad(onUnavailable: () => void): Load {
  const [load, setLoad] = useState<Load>({ phase: "loading" });
  // biome-ignore lint/correctness/useExhaustiveDependencies: the fallback callback only sets state and must not re-trigger the fetch.
  useEffect(() => {
    let live = true;
    void fetchVaultProjects().then((res) => {
      if (!live) return;
      if (res.ok && res.data) return setLoad({ phase: "ready", projects: res.data });
      // An older server answers HTML, or (with the not-found fix) a JSON 404.
      if (res.code === "server_outdated" || res.code === "not_found") setLoad({ phase: "unsupported" });
      else setLoad({ phase: "error", message: res.error ?? `HTTP ${res.status}` });
      onUnavailable();
    });
    return () => {
      live = false;
    };
  }, []);
  return load;
}

export function VaultProjectPicker({
  binding,
  overview,
  onGranted,
  onCancel,
}: {
  binding: VaultBindingView;
  overview: VaultOverview;
  onGranted: () => void | Promise<void>;
  onCancel: () => void;
}) {
  const ids = useId();
  const [manual, setManual] = useState(false);
  const [search, setSearch] = useState("");
  const [chosen, setChosen] = useState<string | null>(null);
  const [accountId, setAccountId] = useState("");
  const [kind, setKind] = useState<"repo" | "dir">("repo");
  const [repoText, setRepoText] = useState("");
  const [device, setDevice] = useState("hub");
  const [dirText, setDirText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useProjectLoad(() => setManual(true));

  const keyAccounts = overview.accounts.filter((a) => a.kind === "key");
  const granted = (subject: string | undefined) => !!subject && overview.grants.some((g) => g.bindingName === binding.name && g.subject === subject);
  const defaultAccount = overview.accounts.find((a) => a.id === binding.defaultAccountId);

  // What would be granted, from the list choice or the manual fields.
  const entry: ManualFields = { kind, setKind, repoText, setRepoText, device, setDevice, dirText, setDirText };
  const repoInvalid = manual && kind === "repo" && repoText.trim() !== "" && !normalizeRepoInput(repoText);
  const subject = manual ? manualSubject(entry) : (chosen ?? undefined);
  const already = granted(subject);
  const isRepo = !!subject?.startsWith("repo:");
  const projectName = subject ? subjectProjectName(subject) : "";

  const grant = async () => {
    if (!subject || already) return;
    setBusy(true);
    setError(null);
    try {
      const res = await createGrant({ subject, bindingName: binding.name, accountId: accountId || undefined });
      if (!res.ok) return setError(res.error ?? `HTTP ${res.status}`);
      await onGranted();
    } finally {
      setBusy(false);
    }
  };

  const filtered = (list: VaultProjectView[]) => filterProjects(list, search);

  const lists = load.phase === "ready" && !manual;

  return (
    <div role="group" aria-label={i18nT("vault.grantToAria", { name: binding.name }, "Grant {name} to a project")} data-testid="vault-grant-picker" className={`${INSET_CLASS} space-y-3`}>
      {load.phase === "loading" && (
        <p aria-busy="true" className={HELP_CLASS}>
          {i18nT("vault.pickerLoading", undefined, "Looking for projects…")}
        </p>
      )}
      {load.phase === "unsupported" && (
        <Callout tone="info" icon={mdiInformationOutline} role="status" testId="vault-picker-unsupported">
          {i18nT("vault.pickerUnsupported", undefined, "This dashboard server can't list projects yet. Enter a repository or folder instead.")}
        </Callout>
      )}
      {load.phase === "error" && <ErrorLine error={load.message} testId="vault-picker-error" />}

      {lists && (
        <>
          <div>
            <label className={LABEL_CLASS} htmlFor={`${ids}-search`}>
              {i18nT("vault.project", undefined, "Project")}
            </label>
            <input
              id={`${ids}-search`}
              type="search"
              className={INPUT_CLASS}
              placeholder={i18nT("vault.searchProjects", undefined, "Search by name, repository or folder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <ProjectGroup
            testId="vault-picker-open"
            legend={i18nT("vault.openSessions", undefined, "Open sessions on this dashboard")}
            list={filtered(load.projects.open)}
            radioName={`${ids}-project`}
            chosen={chosen}
            isGranted={granted}
            onChoose={setChosen}
          />
          <ProjectGroup
            testId="vault-picker-recent"
            legend={i18nT("vault.recentProjects", undefined, "Seen recently (remembered by this dashboard)")}
            list={filtered(load.projects.recent)}
            radioName={`${ids}-project`}
            chosen={chosen}
            isGranted={granted}
            onChoose={setChosen}
          />
          <button type="button" className="focus-ring min-h-[32px] text-xs font-semibold text-[var(--link)] hover:text-[var(--link-hover)] hover:underline" onClick={() => setManual(true)}>
            {i18nT("vault.notListed", undefined, "Not listed? Enter a repository or folder")}
          </button>
        </>
      )}

      {manual && load.phase !== "loading" && (
        <ManualEntry ids={ids} m={entry} repoInvalid={repoInvalid} canGoBack={load.phase === "ready"} onBack={() => setManual(false)} />
      )}

      {already && (
        <Callout tone="info" icon={mdiInformationOutline} role="status" testId="vault-picker-already">
          {i18nT("vault.alreadyHas", undefined, "This project already has this variable. Change its account from the project row.")}
        </Callout>
      )}

      {load.phase !== "loading" && (
        <div>
          <label className={LABEL_CLASS} htmlFor={`${ids}-account`}>
            {i18nT("vault.overrideAccount", undefined, "Account for this project")}
          </label>
          <select id={`${ids}-account`} className={`${INPUT_CLASS} w-auto`} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">
              {i18nT(
                "vault.variableDefaultOption",
                { account: defaultAccount ? `${defaultAccount.provider} / ${defaultAccount.label}` : i18nT("vault.defaultNone", undefined, "none") },
                "Variable default ({account})",
              )}
            </option>
            {keyAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.provider} / {a.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {isRepo && !already && (
        <Callout tone="info" icon={mdiInformationOutline} testId="vault-picker-repo-note">
          {i18nT(
            "vault.repoNote",
            { name: projectName },
            "{name} is a repository. Its sessions get the key after you confirm each checkout from the session's Vault chip.",
          )}
        </Callout>
      )}
      <ErrorLine error={error} testId="vault-picker-grant-error" />

      <div className="flex flex-wrap gap-2">
        <button type="button" className={PRIMARY_BUTTON_CLASS} disabled={!subject || already || busy} onClick={() => void grant()}>
          <VIcon path={mdiCheck} size={0.6} />
          {i18nT("vault.grantName", { name: binding.name }, "Grant {name}")}
        </button>
        <button type="button" className={BUTTON_CLASS} onClick={onCancel}>
          {i18nT("common.cancel", undefined, "Cancel")}
        </button>
      </div>
    </div>
  );
}
