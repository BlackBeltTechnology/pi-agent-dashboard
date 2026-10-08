/**
 * Add / edit / view a catalog skill (S4/S5). Add: source radio cards (installed
 * picker or path). Edit: static name + path, users/targets radios + check-lists,
 * impact preview before a narrowing save, confirm when sessions would end.
 * Config entries are read-only. See change: add-team-skill-access.
 */
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "../api/client.js";
import type { AdminSkillRow, ImpactPreview, SkillTargets, SkillUsers } from "../api/types.js";
import { WORKSPACE } from "../api/types.js";
import { useT } from "../i18n/index.js";
import { useNav } from "../shell/nav.js";
import { targetName } from "../shell/TargetSelector.js";
import { useEffectiveTarget } from "../state/effective-target.js";
import { ConfirmDialog } from "../ui/dialogs.js";
import { Icon } from "../ui/icons.js";
import { useToast } from "../ui/toast.js";

interface Draft {
  src: "pick" | "path";
  pick: string | null;
  path: string;
  name: string;
  users: "*" | "some";
  userList: string[]; // "iss|sub" keys
  targets: "*" | "some";
  targetList: string[];
}

const usersOf = (u: SkillUsers): "*" | "some" => (u === "*" ? "*" : "some");
const keysOf = (u: SkillUsers): string[] => (u === "*" ? [] : u.map((x) => `${x.iss}|${x.sub}`));
const principalsOf = (keys: string[]): { iss: string; sub: string }[] =>
  keys.map((k) => {
    const [iss, sub] = k.split("|");
    return { iss, sub };
  });

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: many small independent branches (field / state rendering); splitting would scatter one linear flow
export function SkillForm({ name }: { name?: string }) {
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
  const isNew = !name;
  const [entry, setEntry] = useState<AdminSkillRow | null | undefined>(name ? undefined : null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [taken, setTaken] = useState<Set<string>>(new Set());
  const [available, setAvailable] = useState<{ name: string; description?: string; path: string; source: string }[] | null>(null);
  const [knownUsers, setKnownUsers] = useState<{ iss: string; sub: string; label: string }[] | null>(null);
  const [query, setQuery] = useState("");
  const [impact, setImpact] = useState<ImpactPreview | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: nav/target are read at call time; their identity would re-run this effect every render
  useEffect(() => {
    if (!me) return;
    if (!canManage) {
      nav.toGrid(target);
      return;
    }
    let cancelled = false;
    api.skillsAdmin().then((r) => {
      if (cancelled) return;
      setTaken(new Set(r.skills.map((e) => e.name)));
      if (!isNew) setEntry(r.skills.find((e) => e.name === name) ?? null);
    });
    if (isNew) {
      api.availableSkills().then((s) => !cancelled && setAvailable(s));
      setEntry(null);
    }
    if (!single) {
      api.users().then((us) => !cancelled && setKnownUsers(us.map((u) => ({ ...u, label: u.name ?? u.email ?? u.sub }))));
    }
    return () => {
      cancelled = true;
    };
  }, [api, me, canManage, single, isNew, name]);

  // Initialise the draft: new mode immediately, edit once the entry is known.
  useEffect(() => {
    if (draft) return;
    if (isNew) {
      setDraft({ src: "pick", pick: null, path: "", name: "", users: "*", userList: [], targets: "*", targetList: [] });
      return;
    }
    if (!entry) return;
    setDraft({
      src: "pick",
      pick: null,
      path: entry.path,
      name: entry.name,
      users: usersOf(entry.users),
      userList: keysOf(entry.users),
      targets: entry.targets === "*" ? "*" : "some",
      targetList: entry.targets === "*" ? [] : [...entry.targets],
    });
  }, [entry, draft, isNew]);

  const readOnly = !isNew && entry?.source === "config";
  const usersValue: SkillUsers | undefined = !draft ? undefined : single ? undefined : draft.users === "*" ? "*" : principalsOf(draft.userList);
  const targetsValue: SkillTargets | undefined = !draft ? undefined : draft.targets === "*" ? "*" : draft.targetList;

  const impactKey = JSON.stringify([usersValue, targetsValue]);
  const entryKey = entry ? JSON.stringify([entry.users, entry.targets]) : "";
  useEffect(() => {
    if (isNew || readOnly || !draft || impactKey === entryKey) return;
    let cancelled = false;
    // Recompute inside: `usersValue`/`targetsValue` are fresh arrays each render.
    const users = single ? undefined : draft.users === "*" ? ("*" as const) : principalsOf(draft.userList);
    const targets = draft.targets === "*" ? ("*" as const) : draft.targetList;
    api
      .skillImpact(entry?.name as string, { users, targets })
      .then((r) => !cancelled && setImpact(r))
      .catch(() => !cancelled && setImpact(null));
    return () => {
      cancelled = true;
    };
  }, [api, isNew, readOnly, single, draft, entry, impactKey, entryKey]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (available ?? []).filter((a) => !q || `${a.name} ${a.description ?? ""}`.toLowerCase().includes(q));
  }, [available, query]);

  if (!canManage) return null;
  if ((name && entry === undefined) || (isNew && available === null)) return <p className="live" role="status">{t("grid.loading")}</p>;
  if (!isNew && entry === null) {
    return (
      <div className="page">
        <button type="button" className="back-link" onClick={() => nav.toSkills(target)}>
          <Icon name="back" className="ic sm" />
          {t("sk.backList")}
        </button>
        <div className="callout callout-warning" role="alert">
          <Icon name="warning" className="ic sm" />
          <div className="grow"><p>{t("cv.notFound")}</p></div>
        </div>
      </div>
    );
  }

  if (!draft) return null;
  const upd = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  const fieldErr = (key: string) =>
    errors[key] ? (
      <p className="field-error" id={`${key}-err`}>
        <Icon name="alert" className="ic sm" />
        {t(errors[key] as never)}
      </p>
    ) : null;

  const validate = (): Record<string, string> => {
    const e: Record<string, string> = {};
    if (isNew && draft.src === "path" && !draft.path.trim()) e.path = "sk.err.path";
    if (!single && draft.users === "some" && draft.userList.length === 0) e.users = "sk.err.users";
    if (draft.targets === "some" && draft.targetList.length === 0) e.where = "sk.err.where";
    return e;
  };

  const buildBody = (): Record<string, unknown> => ({
    ...(isNew ? { name: draft.name.trim() } : {}),
    path: draft.path.trim(),
    users: single ? ("*" as const) : usersValue,
    targets: targetsValue,
  });

  const save = async () => {
    const local = validate();
    setErrors(local);
    if (Object.keys(local).length > 0) {
      setTimeout(() => summaryRef.current?.focus(), 0);
      return;
    }
    const end = impact?.endSessions ?? 0;
    if (!isNew && end > 0) {
      setConfirming(true);
      return;
    }
    await doSave(buildBody(), end);
  };

  const doSave = async (body: Record<string, unknown>, end: number) => {
    setSaving(true);
    try {
      if (isNew) await api.createSkill(body);
      else await api.updateSkill(entry?.name as string, body);
      toast(t(end > 0 ? "toast.skillSaved" : "toast.saved", end > 0 ? { l: end } : undefined));
      nav.toSkills(target);
    } catch (e) {
      setSaving(false);
      setConfirming(false);
      if (e instanceof ApiError && (e.code === "skill_exists" || e.fields?.name)) setErrors({ name: "sk.err.name" });
      else if (e instanceof ApiError && e.fields?.path) setErrors({ path: "sk.err.path" });
      else toast(t("grid.error"));
      setTimeout(() => summaryRef.current?.focus(), 0);
    }
  };

  const summary =
    Object.keys(errors).length > 0 ? (
      <div className="error-summary" role="alert" tabIndex={-1} id="err-summary" ref={summaryRef}>
        <h2>{t("ed.errSummary")}</h2>
        <ul>
          {Object.entries(errors).map(([k, key]) => (
            <li key={k}>
              <a
                href={`#f-${k}`}
                onClick={(e) => {
                  e.preventDefault();
                  document.getElementById(`f-${k}`)?.focus();
                }}
              >
                {t(key as never)}
              </a>
            </li>
          ))}
        </ul>
      </div>
    ) : null;

  const radioCard = (groupName: string, value: string, checked: boolean, title: string, desc: string, onChange: () => void, disabled?: boolean) => (
    <label className="radio-card">
      <input type="radio" name={groupName} value={value} checked={checked} disabled={disabled} onChange={onChange} />
      <span>
        <span className="rc-title">{title}</span>
        <span className="rc-desc">{desc}</span>
      </span>
    </label>
  );

  const userListKeys = new Set(draft.userList);
  const targetIds = [WORKSPACE, ...projects.map((p) => p.id)];
  const title = isNew ? t("sk.newTitle") : readOnly ? t("sk.viewTitle", { name: entry.name }) : t("sk.editTitle", { name: entry.name });

  return (
    <div className="page form-page">
      <button type="button" className="back-link" onClick={() => nav.toSkills(target)}>
        <Icon name="back" className="ic sm" />
        {t("sk.backList")}
      </button>
      <h1 className="page-title">
        {title}{" "}
        {!isNew ? <span className={`chip src-${entry.source}`}>{t(`sk.src.${entry.source}` as never)}</span> : null}
      </h1>
      {readOnly ? (
        <div className="callout callout-info">
          <Icon name="lock" className="ic sm" />
          <div className="grow"><p>{t("sk.readonly")}</p></div>
        </div>
      ) : null}
      {summary}
      <form
        className="form"
        noValidate
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          void save();
        }}
      >
        {isNew ? (
          <fieldset className="field">
            <legend>{t("sk.source")}</legend>
            <div className="radio-cards cols-2">
              {radioCard("src", "pick", draft.src === "pick", t("sk.srcPick"), t("sk.srcPickDesc"), () => upd({ src: "pick" }))}
              {radioCard("src", "path", draft.src === "path", t("sk.srcPath"), t("sk.srcPathDesc"), () => upd({ src: "path" }))}
            </div>
            {draft.src === "pick" ? (
              <div className="form" style={{ gap: "0.5rem" }}>
                <div className="picker-search">
                  <Icon name="search" className="ic sm" />
                  <input
                    className="input"
                    type="search"
                    aria-label={t("sk.search")}
                    placeholder={t("sk.search")}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
                <div className="picker" role="radiogroup" aria-label={t("sk.srcPick")}>
                  {filtered.map((a) => {
                    const already = taken.has(a.name);
                    return (
                      <label className="pick" data-skill={a.name} key={a.name}>
                        <input
                          type="radio"
                          name="pick"
                          value={a.name}
                          checked={draft.pick === a.name}
                          disabled={already}
                          onChange={() => upd({ pick: a.name, path: a.path, name: a.name })}
                        />
                        <span className="p-text">
                          <span className="p-name">{a.name}</span>
                          <span className="p-desc">{a.description}</span>
                          <span className="p-meta">{already ? t("sk.inCatalog") : a.source}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
                {draft.pick ? <p className="path-line">{draft.path}</p> : null}
              </div>
            ) : (
              <div className={`field${errors.path ? " has-error" : ""}`}>
                <label htmlFor="f-path">{t("sk.path")}</label>
                <p className="hint" id="path-hint">{t("sk.pathHint")}</p>
                {fieldErr("path")}
                <input
                  className="input mono"
                  id="f-path"
                  value={draft.path}
                  placeholder="/opt/skills/review"
                  aria-describedby={errors.path ? "path-err path-hint" : "path-hint"}
                  aria-invalid={errors.path ? true : undefined}
                  onChange={(e) => upd({ path: e.target.value })}
                />
              </div>
            )}
            <div className={`field${errors.name ? " has-error" : ""}`}>
              <label htmlFor="f-name">{t("sk.name")}</label>
              <p className="hint" id="name-hint">{t("sk.nameHint")}</p>
              {fieldErr("name")}
              <input
                className="input mono"
                id="f-name"
                value={draft.name}
                aria-describedby={errors.name ? "name-err name-hint" : "name-hint"}
                aria-invalid={errors.name ? true : undefined}
                onChange={(e) => upd({ name: e.target.value })}
              />
            </div>
          </fieldset>
        ) : (
          <div className="field">
            <span className="cell-label" style={{ position: "static", width: "auto", height: "auto" }}>{t("sk.path")}</span>
            <p className="path-line">{entry.path}</p>
            {entry.valid ? null : (
              <div className="callout callout-warning">
                <Icon name="warning" className="ic sm" />
                <div className="grow"><p>{t("sk.invalidHint")}</p></div>
              </div>
            )}
          </div>
        )}

        {single ? (
          <div className="field">
            <span className="rc-title">{t("sk.users")}</span>
            <p className="hint">{t("sk.usersSingle")}</p>
          </div>
        ) : (
          <fieldset className={`field${errors.users ? " has-error" : ""}`}>
            <legend>{t("sk.users")}</legend>
            {fieldErr("users")}
            <div className="radio-cards">
              {radioCard("users", "*", draft.users === "*", t("sk.usersAll"), t("sk.usersAllDesc"), () => upd({ users: "*" }), readOnly)}
              {radioCard("users", "some", draft.users === "some", t("sk.usersSome"), t("sk.usersSomeDesc"), () => upd({ users: "some" }), readOnly)}
            </div>
            {draft.users === "some" && knownUsers ? (
              <div className="check-list sub-list">
                {knownUsers.map((u) => {
                  const key = `${u.iss}|${u.sub}`;
                  return (
                    <label key={key}>
                      <input
                        type="checkbox"
                        name="userList"
                        value={key}
                        disabled={readOnly}
                        checked={userListKeys.has(key)}
                        onChange={(e) => upd({ userList: e.target.checked ? [...draft.userList, key] : draft.userList.filter((x) => x !== key) })}
                      />
                      {u.label}
                    </label>
                  );
                })}
              </div>
            ) : null}
          </fieldset>
        )}

        <fieldset className={`field${errors.where ? " has-error" : ""}`}>
          <legend>{t("sk.where")}</legend>
          {fieldErr("where")}
          <div className="radio-cards">
            {radioCard("targets", "*", draft.targets === "*", t("sk.whereAll"), t("sk.whereAllDesc"), () => upd({ targets: "*" }), readOnly)}
            {radioCard("targets", "some", draft.targets === "some", t("sk.whereSome"), t("sk.whereSomeDesc"), () => upd({ targets: "some" }), readOnly)}
          </div>
          {draft.targets === "some" ? (
            <div className="check-list sub-list">
              {targetIds.map((id) => (
                <label key={id}>
                  <input
                    type="checkbox"
                    name="targetList"
                    value={id}
                    disabled={readOnly}
                    checked={draft.targetList.includes(id)}
                    onChange={(e) =>
                      upd({ targetList: e.target.checked ? [...draft.targetList, id] : draft.targetList.filter((x) => x !== id) })
                    }
                  />
                  <Icon name={id === WORKSPACE ? "home" : "folder"} className="ic sm" />
                  {targetName(id, projects, t("target.ws"))}
                </label>
              ))}
            </div>
          ) : null}
        </fieldset>

        {!isNew && !readOnly && impact ? (
          <div className="callout callout-warning impact" role="status">
            <Icon name="warning" className="ic sm" />
            <div className="grow">
              <p>
                <strong>{t("sk.impactTitle")}</strong> {t("sk.impactLive", { n: impact.endSessions })}
              </p>
              {impact.blockedPersonas.length > 0 ? <p>{t("sk.impactBlocked")}</p> : null}
              {impact.blockedPersonas.length > 0 ? (
                <ul>
                  {impact.blockedPersonas.map((b) => (
                    <li key={b.key}>
                      <strong>{b.name}</strong>
                      {" — "}
                      {b.lostTargets.map((x) => targetName(x, projects, t("target.ws"))).join(", ")}
                    </li>
                  ))}
                  {impact.otherUsersPrivate > 0 ? <li>{t("sk.impactPrivate", { n: impact.otherUsersPrivate })}</li> : null}
                </ul>
              ) : null}
            </div>
          </div>
        ) : null}

        {readOnly ? null : (
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" data-testid="skill-save" disabled={saving || (isNew && draft.src === "pick" && !draft.pick)}>
              {saving ? t("ed.saving") : t("sk.save")}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => nav.toSkills(target)}>
              {t("sk.cancel")}
            </button>
          </div>
        )}
      </form>
      {confirming ? (
        <ConfirmDialog
          title={t("dlg.save.title")}
          body={<p>{t("dlg.save.body", { l: impact?.endSessions ?? 0 })}</p>}
          okLabel={t("dlg.save.ok")}
          destructive
          onOk={() => void doSave(buildBody(), impact?.endSessions ?? 0)}
          onClose={() => setConfirming(false)}
        />
      ) : null}
    </div>
  );
}
