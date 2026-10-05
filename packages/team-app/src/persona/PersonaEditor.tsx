/**
 * Persona editor (A9): create / edit / fork. Single column, field errors with a
 * summary, project assignment (at least one), `full` only for shared +
 * single-user. Server is the validator; the client mirrors the bounds so a bad
 * form never hits the wire. See change: add-team-plugin.
 */
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "../api/client.js";
import type { AvatarSpec, Persona, PersonaInput, ToolsPreset } from "../api/types.js";
import { WORKSPACE } from "../api/types.js";
import { GALLERY } from "../i18n/catalog.js";
import { useT } from "../i18n/index.js";
import { useNav } from "../shell/nav.js";
import { useEffectiveTarget } from "../state/effective-target.js";
import { ConfirmDialog } from "../ui/dialogs.js";
import { Avatar, Icon } from "../ui/icons.js";
import { useToast } from "../ui/toast.js";

const cp = (s: string) => [...s].length;
const utf8 = (s: string) => new TextEncoder().encode(s).length;

interface Draft {
  scope: "shared" | "private";
  name: string;
  description: string;
  avatar: AvatarSpec;
  role: "leader" | "member";
  model: string;
  tools: ToolsPreset;
  skills: string[];
  instructions: string;
  projects: string[];
  forkedFrom?: string;
}

/** Map a server field error code to an i18n key. */
function errKey(field: string, code: string, value: string): string {
  if (field === "name") return value.trim() ? "err.name_too_long" : "err.name_required";
  if (field === "description") return "err.description_too_long";
  if (field === "instructions") return "err.instructions_too_large";
  if (field === "projects") return "err.projects_required";
  return code;
}

export function slugFromName(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/, "") || "persona"
  );
}

export function PersonaEditor({ editKey, forkKey }: { editKey?: string; forkKey?: string }) {
  const t = useT();
  const nav = useNav();
  const { toast } = useToast();
  const eff = useEffectiveTarget();
  const { api, target } = eff;
  const me = eff.state.me;
  const admin = me?.admin === true;
  const single = me?.mode === "single";
  const projects = eff.state.projects;
  const [personas, setPersonas] = useState<Persona[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const editing = !!editKey;

  useEffect(() => {
    void api.personas().then(setPersonas);
  }, [api]);

  const usable = useMemo(() => new Set([WORKSPACE, ...projects.filter((p) => p.available).map((p) => p.id)]), [projects]);

  useEffect(() => {
    if (personas === null || draft) return;
    const src = personas.find((p) => p.key === (forkKey ?? editKey));
    if (src) {
      const d: Draft = {
        scope: src.scope,
        name: src.name,
        description: src.description,
        avatar: src.avatar,
        role: src.role,
        model: src.model ?? "",
        tools: src.tools,
        skills: src.skills ?? [],
        instructions: src.instructions,
        projects: src.projects,
      };
      if (forkKey) {
        d.forkedFrom = forkKey;
        d.scope = "private";
        if (d.tools === "full") d.tools = "files";
        d.projects = d.projects.filter((x) => usable.has(x));
        if (d.projects.length === 0) d.projects = [WORKSPACE];
      }
      if (!admin) d.scope = "private";
      setDraft(d);
    } else if (!editKey && !forkKey) {
      setDraft({
        scope: "private",
        name: "",
        description: "",
        avatar: { kind: "gallery", id: "hex" },
        role: "member",
        model: "",
        tools: "chat",
        skills: [],
        instructions: "",
        projects: [WORKSPACE, ...(target !== WORKSPACE && usable.has(target) ? [target] : [])],
      });
    }
  }, [personas, draft, forkKey, editKey, admin, usable, target]);

  if (personas === null || me === undefined) return <p className="live" role="status">{t("grid.loading")}</p>;
  if (!draft) {
    return (
      <div className="page">
        <p className="empty">{t("cv.notFound")}</p>
        <button type="button" className="btn btn-secondary" onClick={() => nav.toGrid(target)}>{t("ed.back")}</button>
      </div>
    );
  }

  const upd = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const fullAllowed = draft.scope === "shared" && single;
  const assignable = [
    WORKSPACE,
    ...projects.filter((p) => (draft.scope === "shared" && admin ? true : p.available) && p.available).map((p) => p.id),
  ];
  const srcForFork = forkKey ? personas.find((p) => p.key === forkKey) : undefined;

  const validate = (): Record<string, string> => {
    const e: Record<string, string> = {};
    if (!draft.name.trim()) e.name = "err.name_required";
    else if (cp(draft.name) > 60) e.name = "err.name_too_long";
    if (cp(draft.description) > 280) e.description = "err.description_too_long";
    if (utf8(draft.instructions) > 32768) e.instructions = "err.instructions_too_large";
    if (draft.projects.length === 0) e.projects = "err.projects_required";
    return e;
  };

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    const local = validate();
    setErrors(local);
    if (Object.keys(local).length > 0) {
      setTimeout(() => summaryRef.current?.focus(), 0);
      return;
    }
    setSaving(true);
    const body = {
      name: draft.name.trim(),
      description: draft.description,
      avatar: draft.avatar,
      role: draft.role,
      ...(draft.model ? { model: draft.model } : {}),
      instructions: draft.instructions,
      tools: draft.tools,
      projects: draft.projects,
      ...(draft.skills.length ? { skills: draft.skills } : {}),
    };
    try {
      if (editing) await api.updatePersona(editKey as string, body);
      else {
        const base = slugFromName(draft.name);
        let created = false;
        for (let n = 1; n <= 20 && !created; n++) {
          const suffix = n === 1 ? "" : `-${n}`;
          const slug = `${base.slice(0, 40 - suffix.length)}${suffix}`;
          try {
            await api.createPersona({ ...body, slug, scope: draft.scope } as PersonaInput);
            created = true;
          } catch (e) {
            if (!(e instanceof ApiError && e.code === "slug_taken")) throw e;
          }
        }
      }
      toast(t(draft.forkedFrom && !editing ? "toast.forked" : "toast.saved"));
      nav.toGrid(target);
    } catch (e) {
      setSaving(false);
      if (e instanceof ApiError && e.fields) {
        const mapped: Record<string, string> = {};
        for (const [f, code] of Object.entries(e.fields)) {
          const value = f === "name" ? draft.name : "";
          mapped[f] = errKey(f, code, value);
        }
        setErrors(mapped);
        setTimeout(() => summaryRef.current?.focus(), 0);
      } else toast(t("grid.error"));
    }
  };

  const fieldErr = (name: string) =>
    errors[name] ? (
      <p className="field-error" id={`${name}-err`}>
        <Icon name="alert" className="ic sm" />
        {t(errors[name] as never)}
      </p>
    ) : null;
  const toolOpts: Array<[ToolsPreset, string, string]> = [
    ["chat", "ed.toolsChat", "ed.toolsChatDesc"],
    ["files", "ed.toolsFiles", "ed.toolsFilesDesc"],
  ];
  if (fullAllowed) toolOpts.push(["full", "ed.toolsFull", "ed.toolsFullDesc"]);

  return (
    <div className="page form-page">
      <button type="button" className="back-link" onClick={() => nav.toGrid(target)}>
        <Icon name="back" className="ic sm" />
        {t("ed.back")}
      </button>
      <h1 className="page-title">{editing ? t("ed.edit") : t("ed.new")}</h1>
      <form className="form" noValidate onSubmit={(e) => void submit(e)} data-testid="persona-form">
        {Object.keys(errors).length > 0 ? (
          <div className="error-summary" role="alert" tabIndex={-1} id="err-summary" ref={summaryRef}>
            <h2>{t("ed.errSummary")}</h2>
            <ul>
              {Object.entries(errors).map(([f, k]) => (
                <li key={f}>
                  <a
                    href={`#f-${f}`}
                    onClick={(e) => {
                      e.preventDefault();
                      document.getElementById(`f-${f}`)?.focus();
                    }}
                  >
                    {t(k as never)}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {srcForFork ? (
          <div className="callout callout-info">
            <Icon name="fork" className="ic sm" />
            <div className="grow"><p>{t("ed.forkFrom", { name: srcForFork.name })}</p></div>
          </div>
        ) : null}

        {editing || !admin ? (
          <div className="field">
            <span className="hint">{t("ed.scope")}: <strong>{draft.scope === "shared" ? t("ed.scopeShared") : t("ed.scopeFixed")}</strong></span>
          </div>
        ) : (
          <fieldset className="field">
            <legend>{t("ed.scope")}</legend>
            <div className="radio-cards cols-2">
              {(
                [
                  ["shared", "ed.scopeShared", "ed.scopeSharedDesc"],
                  ["private", "ed.scopePrivate", "ed.scopePrivateDesc"],
                ] as const
              ).map(([v, a, b]) => (
                <label className="radio-card" key={v}>
                  <input
                    type="radio"
                    name="scope"
                    value={v}
                    checked={draft.scope === v}
                    onChange={() => upd({ scope: v, tools: v === "shared" && single ? draft.tools : draft.tools === "full" ? "files" : draft.tools })}
                  />
                  <span><span className="rc-title">{t(a)}</span><span className="rc-desc">{t(b)}</span></span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <div className={`field${errors.name ? " has-error" : ""}`}>
          <label htmlFor="f-name">{t("ed.name")}</label>
          <div className="hint-row">
            <span className="hint" id="name-hint">{t("ed.nameHint")}</span>
            <span className="hint" id="name-count" aria-live="polite">{t("ed.counter", { n: cp(draft.name), max: 60 })}</span>
          </div>
          {fieldErr("name")}
          <input
            className="input"
            id="f-name"
            name="name"
            value={draft.name}
            autoComplete="off"
            aria-describedby={["name-hint", "name-count", errors.name ? "name-err" : ""].filter(Boolean).join(" ")}
            aria-invalid={errors.name ? true : undefined}
            onChange={(e) => upd({ name: e.target.value })}
          />
        </div>

        <div className={`field${errors.description ? " has-error" : ""}`}>
          <label htmlFor="f-description">{t("ed.desc")}</label>
          <div className="hint-row">
            <span className="hint" id="desc-hint">{t("ed.descHint")}</span>
            <span className="hint" id="desc-count" aria-live="polite">{t("ed.counter", { n: cp(draft.description), max: 280 })}</span>
          </div>
          {fieldErr("description")}
          <textarea className="textarea" id="f-description" name="description" rows={2} value={draft.description} onChange={(e) => upd({ description: e.target.value })} />
        </div>

        <fieldset className={`field${errors.projects ? " has-error" : ""}`} data-testid="projects-field">
          <legend>{t("ed.projects")}</legend>
          <p className="hint" id="projects-hint">{t("ed.projectsHint")}</p>
          {fieldErr("projects")}
          <div className="check-list">
            {assignable.map((id, i) => (
              <label key={id}>
                <input
                  type="checkbox"
                  name="projects"
                  value={id}
                  id={i === 0 ? "f-projects" : undefined}
                  checked={draft.projects.includes(id)}
                  onChange={(e) => upd({ projects: e.target.checked ? [...draft.projects, id] : draft.projects.filter((x) => x !== id) })}
                />
                <Icon name={id === WORKSPACE ? "home" : "folder"} className="ic sm" />
                <span>{id === WORKSPACE ? t("target.ws") : (projects.find((p) => p.id === id)?.name ?? id)}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="field">
          <legend>{t("ed.avatar")}</legend>
          <div className="avatar-grid">
            {Object.keys(GALLERY).map((id) => (
              <label className="avatar-opt" key={id}>
                <input type="radio" name="avatar" value={id} aria-label={t(`av.${id}` as never)} checked={draft.avatar.kind === "gallery" && draft.avatar.id === id} onChange={() => upd({ avatar: { kind: "gallery", id } })} />
                <Avatar avatar={{ kind: "gallery", id }} name="" />
              </label>
            ))}
            <label className="avatar-opt">
              <input type="radio" name="avatar" value="initials" aria-label={t("ed.avatarInitials")} checked={draft.avatar.kind === "initials"} onChange={() => upd({ avatar: { kind: "initials" } })} />
              <Avatar avatar={{ kind: "initials" }} name={draft.name || "A B"} />
            </label>
          </div>
        </fieldset>

        <fieldset className="field">
          <legend>{t("ed.role")}</legend>
          <div className="radio-cards cols-2">
            {(
              [
                ["member", "ed.roleMember", "ed.roleMemberDesc"],
                ["leader", "ed.roleLeader", "ed.roleLeaderDesc"],
              ] as const
            ).map(([v, a, b]) => (
              <label className="radio-card" key={v}>
                <input type="radio" name="role" value={v} checked={draft.role === v} onChange={() => upd({ role: v })} />
                <span><span className="rc-title">{t(a)}</span><span className="rc-desc">{t(b)}</span></span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="field">
          <label htmlFor="f-model">{t("ed.model")}</label>
          <input className="input mono" id="f-model" name="model" value={draft.model} placeholder={t("ed.modelDefault")} autoComplete="off" onChange={(e) => upd({ model: e.target.value })} />
        </div>

        <fieldset className="field">
          <legend>{t("ed.tools")}</legend>
          <div className={`radio-cards ${toolOpts.length === 3 ? "cols-3" : "cols-2"}`}>
            {toolOpts.map(([v, a, b]) => (
              <label className="radio-card" key={v} data-tool={v}>
                <input type="radio" name="tools" value={v} checked={draft.tools === v} onChange={() => upd({ tools: v })} />
                <span>
                  <span className="rc-title">
                    {t(a as never)}
                    {v === "full" ? (
                      <span className="chip pill-unconfined" style={{ marginLeft: "0.375rem" }}>
                        <Icon name="warning" className="ic sm" />
                        {t("tools.unconfined")}
                      </span>
                    ) : null}
                  </span>
                  <span className="rc-desc">{t(b as never)}</span>
                </span>
              </label>
            ))}
          </div>
          {!fullAllowed ? <p className="hint">{t(draft.scope === "shared" ? "ed.toolsFullAbsentMulti" : "ed.toolsFullAbsentPrivate")}</p> : null}
        </fieldset>

        {(me.skills ?? []).length > 0 ? (
          <fieldset className="field">
            <legend>{t("ed.skills")}</legend>
            <p className="hint">{t("ed.skillsHint")}</p>
            <div className="check-list">
              {(me.skills ?? []).map((s) => (
                <label key={s}>
                  <input type="checkbox" name="skills" value={s} checked={draft.skills.includes(s)} onChange={(e) => upd({ skills: e.target.checked ? [...draft.skills, s] : draft.skills.filter((x) => x !== s) })} />
                  <span className="mono">{s}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}

        <div className={`field${errors.instructions ? " has-error" : ""}`}>
          <label htmlFor="f-instructions">{t("ed.instr")}</label>
          <div className="hint-row">
            <span className="hint" id="instr-hint">{t("ed.instrHint")}</span>
            <span className="hint" id="instr-count" aria-live="polite">{t("ed.bytes", { n: utf8(draft.instructions).toLocaleString(), max: (32768).toLocaleString() })}</span>
          </div>
          {fieldErr("instructions")}
          <textarea className="textarea tall" id="f-instructions" name="instructions" value={draft.instructions} onChange={(e) => upd({ instructions: e.target.value })} />
        </div>

        <div className="callout callout-info">
          <Icon name="info" className="ic sm" />
          <div className="grow"><p>{t("ed.applyNote")}</p></div>
        </div>
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" id="saveBtn" data-testid="save" disabled={saving}>
            {saving ? t("ed.saving") : t("ed.save")}
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => nav.toGrid(target)}>{t("ed.cancel")}</button>
          <span className="spacer" />
          {editing ? (
            <button type="button" className="btn btn-danger" onClick={() => setConfirmDel(true)}>
              <Icon name="trash" className="ic sm" />
              {t("ed.delete")}
            </button>
          ) : null}
        </div>
      </form>
      {confirmDel ? (
        <ConfirmDialog
          title={t("dlg.delete.title", { name: draft.name })}
          body={<p>{t("dlg.delete.body")}</p>}
          okLabel={t("dlg.delete.ok")}
          destructive
          onOk={() => void api.deletePersona(editKey as string).then(() => { toast(t("toast.deleted")); nav.toGrid(target); })}
          onClose={() => setConfirmDel(false)}
        />
      ) : null}
    </div>
  );
}
