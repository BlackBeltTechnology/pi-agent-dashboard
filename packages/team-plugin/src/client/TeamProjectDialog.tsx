/**
 * Enable / settings / disable dialogs for a folder-enabled project (D17).
 * See change: add-team-plugin.
 */
import { useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import { Dialog } from "@blackbelt-technology/pi-dashboard-client-utils/Dialog";
import { useEffect, useState } from "react";

interface KnownUser {
  iss: string;
  sub: string;
  email?: string;
  name?: string;
}

export interface ProjectDialogProps {
  mode: "enable" | "settings";
  cwd: string;
  projectId?: string;
  initialName: string;
  onClose(): void;
  onDone(): void;
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

export function TeamProjectDialog({ mode, cwd, projectId, initialName, onClose, onDone }: ProjectDialogProps) {
  const t = useT();
  const [name, setName] = useState(initialName);
  const [who, setWho] = useState<"everyone" | "selected">("everyone");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [users, setUsers] = useState<KnownUser[]>([]);
  const [multi, setMulti] = useState(false);
  const [ctx, setCtx] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; users?: string; save?: string }>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const me = await json<{ mode: "single" | "multi" }>(await fetch("/api/plugins/team/me"));
        if (cancelled || me.mode !== "multi") return;
        setMulti(true);
        const res = await fetch("/api/plugins/team/users");
        if (res.ok) setUsers((await json<{ users: KnownUser[] }>(res)).users);
      } catch {
        /* single-user or offline: keep defaults */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = async () => {
    const e: typeof errors = {};
    if (!name.trim()) e.name = t("errName", undefined, "Give the project a name.");
    if (multi && who === "selected" && picked.size === 0) e.users = t("errUsers", undefined, "Pick at least one user, or allow everyone.");
    setErrors(e);
    if (e.name || e.users) return;
    setBusy(true);
    const usersBody = !multi || who === "everyone" ? "*" : users.filter((u) => picked.has(`${u.iss}\0${u.sub}`)).map((u) => ({ iss: u.iss, sub: u.sub }));
    try {
      const res =
        mode === "enable"
          ? await fetch("/api/plugins/team/projects", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ path: cwd, name: name.trim(), users: usersBody, contextFiles: ctx }),
            })
          : await fetch(`/api/plugins/team/projects/${encodeURIComponent(projectId ?? "")}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name: name.trim(), users: usersBody, contextFiles: ctx }),
            });
      if (!res.ok) throw new Error(String(res.status));
      onDone();
      onClose();
    } catch {
      setBusy(false);
      setErrors({ save: t("errSave", undefined, "Could not save. Try again.") });
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t(mode === "enable" ? "dlgEnableTitle" : "dlgSettingsTitle", { name: initialName }, mode === "enable" ? `Enable team: ${initialName}` : `Team settings: ${initialName}`)}
      size="md"
      testId="team-project-dialog"
    >
      <form
        className="flex flex-col gap-3"
        noValidate
        onSubmit={(ev) => {
          ev.preventDefault();
          void submit();
        }}
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="team-proj-name" className="text-sm font-semibold">{t("projName", undefined, "Project name")}</label>
          <p className="text-xs text-[var(--text-tertiary)]">{t("projNameHint", undefined, "Users see this in the project selector.")}</p>
          <input
            id="team-proj-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={errors.name ? true : undefined}
            className="rounded border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-2 py-1"
          />
          {errors.name ? <p role="alert" className="text-xs text-red-400">{errors.name}</p> : null}
        </div>
        {multi ? (
          <fieldset className="flex flex-col gap-1">
            <legend className="text-sm font-semibold">{t("who", undefined, "Who may use it")}</legend>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="who" checked={who === "everyone"} onChange={() => setWho("everyone")} />
              {t("everyone", undefined, "Everyone signed in")}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="who" checked={who === "selected"} onChange={() => setWho("selected")} />
              {t("selected", undefined, "Selected users")}
            </label>
            {who === "selected" ? (
              <div className="ml-5 flex flex-col gap-1">
                <p className="text-xs text-[var(--text-tertiary)]">{t("usersHint", undefined, "Only users who already opened the team app are listed.")}</p>
                {users.map((u) => {
                  const k = `${u.iss}\0${u.sub}`;
                  return (
                    <label key={k} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={picked.has(k)}
                        onChange={(e) =>
                          setPicked((s) => {
                            const n = new Set(s);
                            if (e.target.checked) n.add(k);
                            else n.delete(k);
                            return n;
                          })
                        }
                      />
                      {u.name ?? u.email ?? u.sub}
                    </label>
                  );
                })}
              </div>
            ) : null}
            {errors.users ? <p role="alert" className="text-xs text-red-400">{errors.users}</p> : null}
          </fieldset>
        ) : null}
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={ctx} onChange={(e) => setCtx(e.target.checked)} />
          <span>
            {t("ctxFiles", undefined, "Agents also get this folder's AGENTS.md and CLAUDE.md")}
            <span className="block text-xs text-[var(--text-tertiary)]">{t("ctxHint", undefined, "Up to 64 KiB per file, treated as untrusted input.")}</span>
          </span>
        </label>
        {errors.save ? <p role="alert" className="text-xs text-red-400">{errors.save}</p> : null}
        <div className="flex justify-end gap-2">
          <button type="button" className="rounded px-3 py-1 border border-[var(--border-secondary)]" onClick={onClose}>
            {t("cancel", undefined, "Cancel")}
          </button>
          <button type="submit" disabled={busy} className="rounded px-3 py-1 bg-[var(--accent-solid)] text-white" data-testid="team-project-submit">
            {t(mode === "enable" ? "ok" : "save", undefined, mode === "enable" ? "Enable" : "Save")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function DisableTeamDialog({ name, projectId, onClose, onDone }: { name: string; projectId: string; onClose(): void; onDone(): void }) {
  const t = useT();
  return (
    <Dialog open onClose={onClose} title={t("disTitle", { name }, `Disable team: ${name}?`)} size="sm" testId="team-disable-dialog">
      <p className="text-sm text-[var(--text-secondary)]">{t("disBody", undefined, "Conversations and files are kept; enabling it again brings them back.")}</p>
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" className="rounded px-3 py-1 border border-[var(--border-secondary)]" onClick={onClose}>
          {t("cancel", undefined, "Cancel")}
        </button>
        <button
          type="button"
          className="rounded px-3 py-1 bg-red-600 text-white"
          data-testid="team-disable-confirm"
          onClick={() => {
            void fetch(`/api/plugins/team/projects/${encodeURIComponent(projectId)}`, { method: "DELETE" }).then(() => {
              onDone();
              onClose();
            });
          }}
        >
          {t("disOk", undefined, "Disable")}
        </button>
      </div>
    </Dialog>
  );
}
