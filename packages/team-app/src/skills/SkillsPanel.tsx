/**
 * Admin Skills panel (S3): every catalog entry with source / users / targets /
 * usage, managed rows editable + removable, config rows read-only, invalid rows
 * flagged, managed-load-error banner. Non-admins are redirected to the grid.
 * See change: add-team-skill-access.
 */
import { useCallback, useEffect, useState } from "react";
import type { AdminSkillRow } from "../api/types.js";
import { useT } from "../i18n/index.js";
import { useNav } from "../shell/nav.js";
import { targetName } from "../shell/TargetSelector.js";
import { useEffectiveTarget } from "../state/effective-target.js";
import { usePoll } from "../state/use-poll.js";
import { ConfirmDialog } from "../ui/dialogs.js";
import { Icon } from "../ui/icons.js";
import { MenuButton } from "../ui/menu.js";
import { useToast } from "../ui/toast.js";

/** User cell label: a principal list rendered as a count chip with names in the tooltip. */
function UsersCell({ entry, users }: { entry: AdminSkillRow; users: Map<string, string> }) {
  const t = useT();
  if (entry.users === "*") return <span className="chip">{t("sk.everyone")}</span>;
  const names = entry.users.map((u) => users.get(`${u.iss}|${u.sub}`) ?? u.sub);
  return (
    <span className="chip" title={names.join(", ")}>
      {t("sk.nUsers", { n: entry.users.length })}
    </span>
  );
}

function WhereCell({ entry, projects }: { entry: AdminSkillRow; projects: { id: string; name: string }[] }) {
  const t = useT();
  if (entry.targets === "*") return <span className="chip">{t("sk.everywhere")}</span>;
  return (
    <div className="chips">
      {entry.targets.map((x) => (
        <span className="chip" key={x}>
          {targetName(x, projects, t("target.ws"))}
        </span>
      ))}
    </div>
  );
}

export function SkillsPanel() {
  const t = useT();
  const nav = useNav();
  const { toast } = useToast();
  const eff = useEffectiveTarget();
  const { api, target } = eff;
  const me = eff.state.me;
  const admin = me?.admin === true;
  const single = me?.mode === "single";
  const canManage = single || admin;
  const projects = eff.state.projects;
  const [loaded, setLoaded] = useState<{ skills: AdminSkillRow[]; managedLoadError?: string } | null>(null);
  const [knownUsers, setKnownUsers] = useState<Map<string, string>>(new Map());
  const [removing, setRemoving] = useState<AdminSkillRow | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: nav/target are read at call time; re-fetching on their identity would loop
  useEffect(() => {
    if (!me) return;
    if (!canManage) {
      nav.toGrid(target);
      return;
    }
    let cancelled = false;
    api.skillsAdmin().then((r) => !cancelled && setLoaded(r));
    if (!single) api.users().then((us) => !cancelled && setKnownUsers(new Map(us.map((u) => [`${u.iss}|${u.sub}`, u.name ?? u.email ?? u.sub]))));
    return () => {
      cancelled = true;
    };
  }, [api, me, canManage, single]);

  const load = useCallback(async () => {
    try {
      setLoaded(await api.skillsAdmin());
    } catch {
      /* the poll keeps the last listing; the retry is the next tick */
    }
  }, [api]);
  usePoll(load, 5000, eff.ready && canManage);

  if (!canManage) return null;
  const skills = loaded?.skills;

  const remove = async () => {
    if (!removing) return;
    await api.deleteSkill(removing.name);
    toast(t("toast.removed"));
    setRemoving(null);
    void load();
  };

  const head = (
    <div className="page-head">
      <div>
        <button type="button" className="back-link" onClick={() => nav.toGrid(target)}>
          <Icon name="back" className="ic sm" />
          {t("sk.back")}
        </button>
        <h1 className="page-title">{t("sk.title")}</h1>
        <p className="subtitle">{t("sk.subtitle")}</p>
      </div>
      {skills && skills.length > 0 ? (
        <button type="button" className="btn btn-primary" data-testid="add-skill" onClick={() => nav.toSkill(target, "new")}>
          <Icon name="plus" className="ic sm" />
          {t("sk.add")}
        </button>
      ) : null}
    </div>
  );

  if (skills === undefined) {
    return (
      <div className="page">
        {head}
        <p className="live" role="status">{t("grid.loading")}</p>
      </div>
    );
  }

  const invalidLabel = (e: AdminSkillRow) =>
    e.invalidReason === "name_mismatch" ? t("sk.invalidName") : e.invalidReason === "shadowed_by_config" ? t("sk.shadowed") : t("sk.invalid");

  return (
    <div className="page">
      {head}
      {loaded?.managedLoadError ? (
        <div className="callout callout-warning" role="status">
          <Icon name="warning" className="ic sm" />
          <div className="grow"><p>{t("sk.loadError")}</p></div>
        </div>
      ) : null}
      {skills.length === 0 ? (
        <div className="card empty" data-testid="empty-skills">
          <p>{t("sk.empty")}</p>
          <button type="button" className="btn btn-primary" data-testid="add-skill" onClick={() => nav.toSkill(target, "new")}>
            <Icon name="plus" className="ic sm" />
            {t("sk.emptyCta")}
          </button>
        </div>
      ) : (
        <>
          <div className="list-head" aria-hidden="true">
            <span>{t("sk.col.skill")}</span>
            <span>{t("sk.col.users")}</span>
            <span>{t("sk.col.where")}</span>
            <span />
          </div>
          <ul className="skill-list" aria-label={t("sk.title")}>
            {
              /* biome-ignore lint/complexity/noExcessiveCognitiveComplexity: many small independent branches (row rendering); splitting would scatter one linear flow */
              skills.map((e) => (
              <li className={`card skill-row${e.valid ? "" : " is-invalid"}`} data-skill={e.name} key={`${e.source}-${e.name}`}>
                <div className="skill-id">
                  <div className="chips">
                    <button type="button" className="skill-name skill-link" data-testid={`skill-${e.name}`} onClick={() => nav.toSkill(target, e.name)}>
                      {e.name}
                    </button>
                    <span className={`chip src-${e.source}`}>{t(`sk.src.${e.source}` as never)}</span>
                    {e.valid ? null : (
                      <span className="chip warn">
                        <Icon name="warning" className="ic sm" />
                        {invalidLabel(e)}
                      </span>
                    )}
                  </div>
                  {e.description ? <p className="skill-desc">{e.description}</p> : null}
                  {e.valid ? null : <p className="skill-desc">{t("sk.invalidHint")}</p>}
                  <p className="skill-desc">{t("sk.usage", { p: e.usage.personas, l: e.usage.liveSessions })}</p>
                </div>
                <div className="skill-cell">
                  <span className="cell-label">{t("sk.col.users")}</span>
                  {single ? <span className="chip">{t("sk.notApplicable")}</span> : <UsersCell entry={e} users={knownUsers} />}
                </div>
                <div className="skill-cell">
                  <span className="cell-label">{t("sk.col.where")}</span>
                  <WhereCell entry={e} projects={projects} />
                </div>
                <div className="row-actions">
                  {e.source === "config" ? (
                    <span className="lock-note" title={t("sk.readonly")}>
                      <Icon name="lock" className="ic sm" />
                      <span className="sr-only">{t("sk.readonly")}</span>
                    </span>
                  ) : (
                    <MenuButton
                      label={t("sk.rowMenu", { name: e.name })}
                      items={[
                        { id: "edit", label: <><Icon name="edit" className="ic sm" />{t("sk.edit")}</>, onSelect: () => nav.toSkill(target, e.name) },
                        { id: "remove", danger: true, label: <><Icon name="trash" className="ic sm" />{t("sk.remove")}</>, onSelect: () => setRemoving(e) },
                      ]}
                    />
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      {removing ? (
        <ConfirmDialog
          title={t("dlg.remove.title", { name: removing.name })}
          body={<p>{t("dlg.remove.body", { p: removing.usage.personas, l: removing.usage.liveSessions })}</p>}
          okLabel={t("dlg.remove.ok")}
          destructive
          onOk={() => void remove()}
          onClose={() => setRemoving(null)}
        />
      ) : null}
    </div>
  );
}
