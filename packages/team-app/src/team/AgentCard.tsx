/**
 * Agent card (A4/A5): avatar, name, role/scope/model/unconfined chips, status
 * (shape + word), "N beszélgetés · <time>", Beszélgetés + "+ Új", stale callout,
 * dim states for retired / unavailable / unassigned. Ported from the approved
 * mockup. See change: add-team-plugin.
 */
import { useState } from "react";
import type { Agent, Target } from "../api/types.js";
import { relativeTime, useT } from "../i18n/index.js";
import { Avatar, Icon } from "../ui/icons.js";
import { ConfirmDialog } from "../ui/dialogs.js";
import { MenuButton, type MenuItem } from "../ui/menu.js";

export interface AgentCardProps {
  agent: Agent;
  target: Target;
  admin: boolean;
  maxConversations: number;
  onTalk(a: Agent): void;
  onNew(a: Agent): void;
  onOpenList(a: Agent): void;
  onRestartStale(a: Agent): void;
  onEdit(a: Agent): void;
  onFork(a: Agent): void;
  onDelete(a: Agent): void;
}

export function StatusEl({ status }: { status: Agent["status"] }) {
  const t = useT();
  return (
    <span className="status" data-status={status}>
      <span className={`shape shape-${status}`} aria-hidden="true" />
      {t(`status.${status}` as never)}
    </span>
  );
}

export function AgentCard(p: AgentCardProps) {
  const t = useT();
  const a = p.agent;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const dim = a.status === "retired" || a.status === "unavailable";
  const reason = a.retired ? "retired" : a.unassigned ? "unassigned" : "full";
  const atLimit = p.agent.activeCount >= p.maxConversations;
  const canWrite = a.scope === "private" || p.admin;

  const items: MenuItem[] = [];
  if (!a.retired) {
    if (canWrite) items.push({ id: "edit", label: <><Icon name="edit" className="ic sm" />{t("menu.edit")}</>, onSelect: () => p.onEdit(a) });
    if (a.tools !== "full") items.push({ id: "fork", label: <><Icon name="fork" className="ic sm" />{t("menu.fork")}</>, onSelect: () => p.onFork(a) });
    if (canWrite) items.push({ id: "delete", danger: true, label: <><Icon name="trash" className="ic sm" />{t("menu.delete")}</>, onSelect: () => setConfirmDelete(true) });
  }

  return (
    <article className={`card agent-card${dim ? " is-dim" : ""}`} aria-labelledby={`n-${a.key}`} data-key={a.key} data-status={a.status}>
      <div className="agent-top">
        <Avatar avatar={a.avatar} name={a.name} />
        <div className="agent-info">
          <div className="agent-name-row">
            <h3 className="agent-name" id={`n-${a.key}`} title={a.name}>
              {a.name}
            </h3>
            {a.role === "leader" ? <span className="chip pill-leader">{t("role.leader")}</span> : null}
          </div>
          <p className="agent-desc">{a.description}</p>
        </div>
      </div>
      <div className="chips">
        <StatusEl status={a.status} />
        <span className="chip model" title={a.model || t("model.default")}>
          {a.model || t("model.default")}
        </span>
        <span className="chip">
          <Icon name={a.scope === "shared" ? "people" : "person"} className="ic sm" />
          {t(a.scope === "shared" ? "scope.shared" : "scope.private")}
        </span>
        {a.unconfined ? (
          <span className="chip pill-unconfined">
            <Icon name="warning" className="ic sm" />
            {t("tools.unconfined")}
          </span>
        ) : null}
      </div>
      <p className="activity-line" data-testid="activity">
        <Icon name="chat" className="ic sm" />
        {a.activeCount > 0
          ? `${t(a.activeCount === 1 ? "card.convOne" : "card.convMany", { n: a.activeCount })}${a.latest ? ` · ${relativeTime(t, a.latest.lastActivityAt)}` : ""}`
          : t("card.noConv")}
      </p>
      {a.personaStale && !dim ? (
        <div className="callout callout-info stack">
          <Icon name="info" className="ic sm" />
          <div className="grow">
            <p>{t("card.stale")}</p>
          </div>
          <button type="button" className="btn btn-secondary" onClick={() => p.onRestartStale(a)}>
            <Icon name="refresh" className="ic sm" />
            {t("card.restart")}
          </button>
        </div>
      ) : null}
      <div className="card-actions">
        {dim ? (
          <div className="card-note-wrap">
            <p className="card-note">{t(`card.${reason}Note` as never)}</p>
            {a.activeCount > 0 ? (
              <button type="button" className="btn btn-secondary" data-testid="open-list" onClick={() => p.onOpenList(a)}>
                {t("card.openList", { n: a.activeCount })}
              </button>
            ) : null}
          </div>
        ) : (
          <>
            <button type="button" className="btn btn-primary" aria-label={t("card.talkTo", { name: a.name })} data-testid="talk" onClick={() => p.onTalk(a)}>
              <Icon name="chat" className="ic sm" />
              {t("card.talk")}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              aria-label={t("card.newTo", { name: a.name })}
              title={atLimit ? t("cv.limit", { max: p.maxConversations }) : undefined}
              disabled={atLimit}
              data-testid="new-conv"
              onClick={() => p.onNew(a)}
            >
              <Icon name="plus" className="ic sm" />
              {t("card.new")}
            </button>
          </>
        )}
        <MenuButton label={t("card.more", { name: a.name })} items={items} />
      </div>
      {confirmDelete ? (
        <ConfirmDialog
          title={t("dlg.delete.title", { name: a.name })}
          body={<p>{t("dlg.delete.body")}</p>}
          okLabel={t("dlg.delete.ok")}
          destructive
          onOk={() => p.onDelete(a)}
          onClose={() => setConfirmDelete(false)}
        />
      ) : null}
    </article>
  );
}
