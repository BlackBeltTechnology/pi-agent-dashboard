/**
 * Csapat grid (A3): cards of the selected target, shared / own sections,
 * loading / error / empty states, 5 s polling while visible.
 * See change: add-team-plugin.
 */
import { useCallback, useEffect, useState } from "react";
import { ApiError } from "../api/client.js";
import type { Agent, Persona } from "../api/types.js";
import { WORKSPACE } from "../api/types.js";
import { useT } from "../i18n/index.js";
import { useNav } from "../shell/nav.js";
import { targetName } from "../shell/TargetSelector.js";
import { useEffectiveTarget } from "../state/effective-target.js";
import { usePoll } from "../state/use-poll.js";
import { ConfirmDialog } from "../ui/dialogs.js";
import { Icon } from "../ui/icons.js";
import { useToast } from "../ui/toast.js";
import { AgentCard } from "./AgentCard.js";

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: many small independent branches (field / state rendering); splitting would scatter one linear flow
export function TeamGrid() {
  const t = useT();
  const nav = useNav();
  const { toast } = useToast();
  const eff = useEffectiveTarget();
  const { api, target } = eff;
  // Keyed by the target it was loaded for: after a target switch the old target's cards must never
  // stay clickable (they would open that target's conversations under the new target).
  const [loaded, setLoaded] = useState<{ target: string; agents: Agent[] } | null>(null);
  const agents = loaded && loaded.target === target ? loaded.agents : null;
  const [error, setError] = useState(false);
  const [adding, setAdding] = useState(false);
  const admin = eff.state.me?.admin === true;
  const single = eff.state.me?.mode === "single";
  const canManage = single || admin;
  const maxConv = eff.state.me?.maxConversations ?? 50;
  const projects = eff.state.projects;

  const load = useCallback(async () => {
    try {
      const list = await api.agents(target);
      setLoaded({ target, agents: list });
      setError(false);
    } catch {
      setError(true);
    }
  }, [api, target]);
  usePoll(load, 5000, eff.ready);

  const openConversation = async (a: Agent, forceNew: boolean) => {
    try {
      if (!forceNew && a.latest) return nav.toAgent(a.key, target, a.latest.id);
      const c = await api.createConversation(a.key, target);
      nav.toAgent(a.key, target, c.id);
    } catch (e) {
      toast(e instanceof ApiError && e.code === "conversation_limit" ? t("cv.limit", { max: maxConv }) : t("grid.error"));
    }
  };

  const restartStale = async (a: Agent) => {
    const convs = await api.conversations(a.key, target);
    await Promise.all(convs.filter((c) => c.personaStale).map((c) => api.restart(a.key, target, c.id)));
    toast(t("toast.restarted"));
    void load();
  };

  const del = async (a: Agent) => {
    await api.deletePersona(a.key);
    toast(t("toast.deleted"));
    void load();
  };

  const name = targetName(target, projects, t("target.ws"));
  const head = (
    <div className="page-head">
      <div>
        <h1 className="page-title">{t("grid.title")}</h1>
        <p className="subtitle">{t("grid.subtitleTarget", { name })}</p>
      </div>
      <div className="row-actions">
        {canManage ? (
          <button type="button" className="btn btn-secondary" data-testid="open-skills" onClick={() => nav.toSkills(target)}>
            <Icon name="spark" className="ic sm" />
            {t("grid.skills")}
          </button>
        ) : null}
        <button type="button" className="btn btn-primary" data-testid="new-persona" onClick={() => nav.toEditor(target)}>
          <Icon name="plus" className="ic sm" />
          {t("grid.new")}
        </button>
      </div>
    </div>
  );

  if (error && agents === null) {
    return (
      <div className="page">
        {head}
        <div className="callout callout-error" role="alert">
          <Icon name="alert" className="ic sm" />
          <div className="grow">
            <p><strong>{t("grid.error")}</strong></p>
            <p>{t("grid.errorDetail")}</p>
          </div>
          <button type="button" className="btn btn-secondary" onClick={() => void load()}>
            <Icon name="refresh" className="ic sm" />
            {t("grid.retry")}
          </button>
        </div>
      </div>
    );
  }
  if (agents === null) {
    return (
      <div className="page">
        {head}
        <p className="live" role="status">{t("grid.loading")}</p>
        <div className="grid" aria-hidden="true">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="card skeleton"><div className="sk" style={{ height: "2.75rem" }} /></div>
          ))}
        </div>
      </div>
    );
  }
  if (agents.length === 0) {
    return (
      <div className="page">
        {head}
        <div className="card empty" data-testid="empty-target">
          <p>{t(target === WORKSPACE ? "grid.emptyWs" : "grid.emptyTarget", { name })}</p>
          {admin ? <p className="hint">{t("grid.emptyAdmin")}</p> : null}
          <div className="row-actions">
            {canManage && target !== WORKSPACE ? (
              <button type="button" className="btn btn-primary" data-testid="add-agents" onClick={() => setAdding(true)}>
                <Icon name="people" className="ic sm" />
                {t("grid.addAgents")}
              </button>
            ) : null}
            <button type="button" className="btn btn-secondary" onClick={() => nav.toEditor(target)}>
              <Icon name="plus" className="ic sm" />
              {t("grid.emptyCta")}
            </button>
          </div>
        </div>
        {adding ? <AddAgentsDialog target={target} name={name} onClose={() => { setAdding(false); void load(); }} /> : null}
      </div>
    );
  }

  const section = (titleKey: "grid.shared" | "grid.own", list: Agent[], id: string) =>
    list.length ? (
      <section className="section" aria-labelledby={id} key={id}>
        <div className="section-head">
          <h2 className="section-title" id={id}>{t(titleKey)}</h2>
          <span className="count">{t("grid.count", { n: list.length })}</span>
        </div>
        <div className="grid">
          {list.map((a) => (
            <AgentCard
              key={a.key}
              agent={a}
              target={target}
              admin={admin}
              maxConversations={maxConv}
              onTalk={(x) => void openConversation(x, false)}
              onNew={(x) => void openConversation(x, true)}
              onOpenList={(x) => nav.toAgent(x.key, target)}
              onRestartStale={(x) => void restartStale(x)}
              onEdit={(x) => nav.toEditor(target, x.key)}
              onFork={(x) => nav.toEditor(target, undefined, x.key)}
              onDelete={(x) => void del(x)}
              onFixSkill={(x) => nav.toSkill(target, x.skillBlock?.skill ?? "")}
            />
          ))}
        </div>
      </section>
    ) : null;

  return (
    <div className="page">
      {head}
      {section("grid.shared", agents.filter((a) => a.scope === "shared"), "sec-shared")}
      {section("grid.own", agents.filter((a) => a.scope === "private"), "sec-own")}
    </div>
  );
}

/** "Ügynökök hozzáadása": append this project to chosen shared personas (admin / operator). */
function AddAgentsDialog({ target, name, onClose }: { target: string; name: string; onClose(): void }) {
  const t = useT();
  const { api } = useEffectiveTarget();
  const { toast } = useToast();
  const [cands, setCands] = useState<Persona[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  useEffect(() => {
    void api.personas().then((ps) => setCands(ps.filter((p) => p.scope === "shared" && !p.projects.includes(target))));
  }, [api, target]);
  const add = async () => {
    const chosen = (cands ?? []).filter((p) => picked.has(p.key));
    await Promise.all(
      chosen.map((p) =>
        api.updatePersona(p.key, {
          name: p.name,
          description: p.description,
          avatar: p.avatar,
          role: p.role,
          model: p.model,
          instructions: p.instructions,
          tools: p.tools,
          projects: [...p.projects, target],
          skills: p.skills,
        }),
      ),
    );
    toast(t("toast.added", { n: chosen.length }));
  };
  return (
    <ConfirmDialog
      title={t("dlg.add.title", { name })}
      okLabel={t("dlg.add.ok")}
      onOk={() => void add()}
      onClose={onClose}
      body={
        cands && cands.length > 0 ? (
          <div className="check-list">
            {cands.map((p) => (
              <label className="check" key={p.key}>
                <input
                  type="checkbox"
                  checked={picked.has(p.key)}
                  onChange={(e) =>
                    setPicked((s) => {
                      const n = new Set(s);
                      if (e.target.checked) n.add(p.key);
                      else n.delete(p.key);
                      return n;
                    })
                  }
                />
                {p.name}
              </label>
            ))}
          </div>
        ) : (
          <p>{t("dlg.add.none")}</p>
        )
      }
    />
  );
}
