/**
 * Agent view (A6): conversation list pane + chat pane. Two panes from 1024 px
 * (the list route opens the newest conversation), two routes below.
 * See change: add-team-plugin (D10).
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { ApiError } from "../api/client.js";
import type { Agent, Conversation } from "../api/types.js";
import { relativeTime, useT } from "../i18n/index.js";
import { agentPath, useNav, withProject } from "../shell/nav.js";
import { useEffectiveTarget } from "../state/effective-target.js";
import { usePoll } from "../state/use-poll.js";
import { StatusEl } from "../team/AgentCard.js";
import { Avatar, Icon } from "../ui/icons.js";
import { useToast } from "../ui/toast.js";
import { ChatPane } from "./ChatPane.js";

const WIDE = "(min-width: 1024px)";

function useWide(): boolean {
  const sub = (cb: () => void) => {
    const m = window.matchMedia?.(WIDE);
    m?.addEventListener?.("change", cb);
    return () => m?.removeEventListener?.("change", cb);
  };
  return useSyncExternalStore(sub, () => window.matchMedia?.(WIDE).matches ?? false, () => false);
}

function readOnlyReason(a: Agent): "retired" | "unassigned" | "full" | null {
  if (a.status === "retired") return "retired";
  if (a.status === "unavailable") return a.unassigned ? "unassigned" : "full";
  return null;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: many small independent branches (field / state rendering); splitting would scatter one linear flow
export function AgentView({ agentKey, convId }: { agentKey: string; convId?: string }) {
  const t = useT();
  const nav = useNav();
  const { toast } = useToast();
  const eff = useEffectiveTarget();
  const { api, target } = eff;
  const maxConv = eff.state.me?.maxConversations ?? 50;
  const wide = useWide();
  const [agent, setAgent] = useState<Agent | null | undefined>(undefined);
  const [active, setActive] = useState<Conversation[]>([]);
  const [archived, setArchived] = useState<Conversation[]>([]);
  const [showArchived, setShowArchived] = useState(false);

  const load = useCallback(async () => {
    try {
      const [agents, a, ar] = await Promise.all([api.agents(target), api.conversations(agentKey, target), api.conversations(agentKey, target, true)]);
      setAgent(agents.find((x) => x.key === agentKey) ?? null);
      setActive(a);
      setArchived(ar);
    } catch {
      setAgent((cur) => (cur === undefined ? null : cur));
    }
  }, [api, agentKey, target]);
  usePoll(load, 5000, eff.ready);

  const sel = [...active, ...archived].find((c) => c.id === convId);
  useEffect(() => {
    if (sel?.archived) setShowArchived(true);
  }, [sel?.archived]);

  if (agent === undefined) return <p className="live" role="status">{t("grid.loading")}</p>;
  if (agent === null) {
    return (
      <div className="page">
        <button type="button" className="back-link" onClick={() => nav.toGrid(target)}>
          <Icon name="back" className="ic sm" />
          {t("ed.back")}
        </button>
        <div className="callout callout-warning" role="alert">
          <Icon name="warning" className="ic sm" />
          <div className="grow"><p>{t("cv.notFound")}</p></div>
        </div>
      </div>
    );
  }
  if (convId && !sel) {
    return (
      <div className="page">
        <button type="button" className="back-link" onClick={() => nav.toAgent(agentKey, target)}>
          <Icon name="back" className="ic sm" />
          {t("cv.back")}
        </button>
        <div className="callout callout-warning" role="alert">
          <Icon name="warning" className="ic sm" />
          <div className="grow"><p>{t("cv.convNotFound")}</p></div>
        </div>
      </div>
    );
  }

  const skillBlocked = !!agent.skillBlock && !agent.retired;
  const ro = skillBlocked ? null : readOnlyReason(agent);
  const limit = agent.activeCount >= maxConv;
  const shown = showArchived ? archived : active;
  const wideDefault = !convId && wide ? (active[0] ?? null) : null;
  const current = sel ?? wideDefault;
  const toolsKey = { chat: "cv.toolsChat", files: "cv.toolsFiles", full: "cv.toolsFull" }[agent.tools] as "cv.toolsChat";

  const create = async () => {
    try {
      const c = await api.createConversation(agentKey, target);
      await load();
      nav.toAgent(agentKey, target, c.id);
    } catch (e) {
      toast(e instanceof ApiError && e.code === "conversation_limit" ? t("cv.limit", { max: maxConv }) : t("grid.error"));
    }
  };

  const listPane = (
    <nav className="conv-list-pane" aria-label={t("cv.list")}>
      <button type="button" className="back-link" onClick={() => nav.toGrid(target)}>
        <Icon name="back" className="ic sm" />
        {t("cv.back")}
      </button>
      <div className="convo-id">
        <Avatar avatar={agent.avatar} name={agent.name} size="sm" />
        <div className="agent-info">
          <div className="agent-name-row">
            <h1 className="agent-name">{agent.name}</h1>
            {agent.role === "leader" ? <span className="chip pill-leader">{t("role.leader")}</span> : null}
          </div>
          <div className="convo-meta">
            <StatusEl status={agent.status} />
            <span className="chip" title={t("cv.workspace")}>
              <Icon name={agent.tools === "full" ? "warning" : "shield"} className="ic sm" />
              {t(toolsKey)}
            </span>
            {agent.effectiveSkills.map((s) => (
              <span className="chip skill" key={s}>
                <Icon name="spark" className="ic sm" />
                {s}
              </span>
            ))}
          </div>
        </div>
      </div>
      {ro ? (
        <p className="hint">{t(`card.${agent.retired ? "retired" : ro}Note` as never)}</p>
      ) : skillBlocked && agent.skillBlock ? (
        <p className="hint">{t(`card.blocked.${agent.skillBlock.reason}` as never, { s: agent.skillBlock.skill })}</p>
      ) : (
        <div className="new-conv">
          <button type="button" className="btn btn-primary" disabled={limit} aria-describedby={limit ? "limit-hint" : undefined} data-testid="list-new-conv" onClick={() => void create()}>
            <Icon name="plus" className="ic sm" />
            {t("cv.new")}
          </button>
          {limit ? <p className="hint" id="limit-hint">{t("cv.limit", { max: maxConv })}</p> : null}
        </div>
      )}
      <h2 className="section-title" id="conv-list-h">{showArchived ? t("cv.archivedTitle") : t("cv.list")}</h2>
      {shown.length > 0 ? (
        <ul className="conv-list" aria-labelledby="conv-list-h" data-testid="conv-list">
          {shown.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className="conv-item"
                aria-current={current?.id === c.id ? "page" : undefined}
                data-conv={c.id}
                onClick={() => nav.navigate(withProject(agentPath(agentKey, c.id), target))}
              >
                <span className={`shape shape-${c.status}`} aria-hidden="true" />
                <span className="conv-text">
                  <span className="conv-title">{c.title}</span>
                  <span className="conv-meta">
                    {`${t(`status.${c.status}` as never)} · ${relativeTime(t, c.lastActivityAt)}`}
                    {c.personaStale ? ` · ${t("cv.staleShort")}` : ""}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint">{t(showArchived ? "cv.emptyArchived" : "cv.emptyList")}</p>
      )}
      {archived.length > 0 || showArchived ? (
        <button type="button" className="btn btn-ghost" aria-pressed={showArchived} data-testid="toggle-archived" onClick={() => setShowArchived((v) => !v)}>
          <Icon name="archive" className="ic sm" />
          {showArchived ? t("cv.showActive") : t("cv.showArchived", { n: archived.length })}
        </button>
      ) : null}
    </nav>
  );

  const chatPane = current ? (
    <ChatPane key={current.id} agent={agent} conv={current} target={target} readOnlyReason={ro} skillBlock={skillBlocked ? (agent.skillBlock as NonNullable<Agent["skillBlock"]>) : null} onChanged={() => void load()} />
  ) : (
    <section className="chat-pane" aria-label={t("cv.list")}>
      <p className="hint chat-empty">{t("cv.pick")}</p>
    </section>
  );

  return (
    <div className="agent-view" data-route={convId ? "conv" : "list"}>
      {listPane}
      {chatPane}
    </div>
  );
}
