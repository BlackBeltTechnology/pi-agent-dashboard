/**
 * Conversation (A7): ensure → ticketed socket → headless state → `ChatView` +
 * `CommandInput`. States: ensuring (spawn / resume), ready, busy, reconnecting,
 * stale, archived, retired / unassigned (read-only), ensure errors with Retry.
 * See change: add-team-plugin (D10).
 */
import { useAppHost } from "@blackbelt-technology/pi-dashboard-app-kit/react";
import { parseSkillCommand } from "@blackbelt-technology/pi-dashboard-shared/skill-block-parser.js";
import { ChatView, CommandInput, type ToolContext } from "@blackbelt-technology/pi-dashboard-web/chat-embed";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { ApiError } from "../api/client.js";
import type { Agent, Conversation, SkillBlockReason, Target } from "../api/types.js";
import { useT } from "../i18n/index.js";
import { agentPath, useNav, withProject } from "../shell/nav.js";
import { useEffectiveTarget } from "../state/effective-target.js";
import { StatusEl } from "../team/AgentCard.js";
import { ConfirmDialog, TextDialog } from "../ui/dialogs.js";
import { Icon } from "../ui/icons.js";
import { MenuButton, type MenuEntry } from "../ui/menu.js";
import { useToast } from "../ui/toast.js";
import { ChatProviders } from "./chat-providers.js";
import { useTeamChat } from "./chat-session.js";

type EnsureState =
  | { kind: "ensuring" }
  | { kind: "ready"; sessionId: string }
  | { kind: "error"; code: string; skill?: string; reason?: SkillBlockReason };

export interface ChatPaneProps {
  agent: Agent;
  conv: Conversation;
  target: Target;
  readOnlyReason: "retired" | "unassigned" | "full" | null;
  /** Card-known block from the agent listing; a 409 on ensure surfaces the same way. */
  skillBlock: { skill: string; reason: SkillBlockReason } | null;
  onChanged(): void;
}

function ErrorBanner({ code, onRetry }: { code: string; onRetry(): void }) {
  const t = useT();
  const known = code === "spawn_timeout" || code === "guard_unavailable";
  const title = known ? t(`cv.${code}` as never) : code === "conversation_unrecoverable" ? t("cv.unrecoverable") : t("grid.error");
  const detail = known ? t(`cv.${code}Detail` as never) : code === "conversation_unrecoverable" ? t("cv.unrecoverableDetail") : t("grid.errorDetail");
  return (
    <div className="callout callout-error" role="alert">
      <Icon name="alert" className="ic sm" />
      <div className="grow">
        <p><strong>{title}</strong></p>
        <p>{detail}</p>
      </div>
      {code === "conversation_unrecoverable" ? null : (
        <button type="button" className="btn btn-secondary" onClick={onRetry}>
          <Icon name="refresh" className="ic sm" />
          {t("cv.retry")}
        </button>
      )}
    </div>
  );
}

function ChatBody({ sessionId, agent, readOnly = false }: { sessionId: string; agent: Agent; readOnly?: boolean }) {
  const host = useAppHost();
  const t = useT();
  const chat = useTeamChat(host, sessionId);
  const toolContext: ToolContext = { sessionId, session: chat.state };
  const streaming = (chat.state as { status?: string }).status === "streaming";
  // Composer pre-check: a `/skill:<name>` outside the effective set never reaches the wire.
  // The server-side guard stays the authority (spec "Skill availability feedback").
  const effective = agent.effectiveSkills;
  const [draft, setDraft] = useState("");
  const [refused, setRefused] = useState<string | null>(null);
  const holdRef = useRef(false); // the composer's post-send clear must not wipe a refused text
  const onSend = (text: string) => {
    const cmd = parseSkillCommand(text);
    if (cmd && !effective.includes(cmd.name)) {
      holdRef.current = true;
      queueMicrotask(() => {
        holdRef.current = false;
      });
      setRefused(cmd.name);
      return;
    }
    setRefused(null);
    chat.sendPrompt(text);
  };
  return (
    <>
      {chat.status === "reconnecting" ? (
        <div className="callout callout-warning" role="status">
          <Icon name="warning" className="ic sm" />
          <div className="grow">
            <p><strong>{t("cv.reconnect")}</strong></p>
            <p>{t("cv.reconnectDetail")}</p>
          </div>
        </div>
      ) : null}
      <div className="transcript" data-testid="transcript" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <ChatView sessionId={sessionId} state={chat.state} toolContext={toolContext} onAbort={chat.abort} />
      </div>
      {/* Direct pane child: CommandInput's own max-h-[40%] must resolve against the pane, not a wrapper. */}
      {refused && !readOnly ? (
        <div className="composer-error" role="alert">
          <Icon name="alert" className="ic sm" />
          <div>
            <p>{t("cv.skillRefused", { s: refused })}</p>
            <p>{effective.length > 0 ? t("cv.skillAvail", { list: effective.map((s) => `/skill:${s}`).join(", ") }) : t("cv.skillNone")}</p>
          </div>
        </div>
      ) : null}
      {readOnly ? null : <CommandInput
        commands={[]}
        sessionId={sessionId}
        sessionStatus={streaming ? "streaming" : "idle"}
        disabled={chat.status !== "connected"}
        draft={draft}
        onDraftChange={(v) => {
          if (holdRef.current && v === "") return;
          setDraft(v);
        }}
        invalid={refused !== null}
        onSend={onSend}
        onAbort={chat.abort}
      />}
      {readOnly ? null : (
        <p className="composer-hint">
          <Icon name="shield" className="ic sm" />
          {t("cv.hint")}
        </p>
      )}
      <span className="sr-only">{agent.name}</span>
    </>
  );
}

/** Reason-specific `skill_not_allowed` banner (409 on ensure, or the card's skillBlock). */
function SkillBlockedBanner({
  skill,
  reason,
  admin,
  onFixSkill,
  onFixPersona,
}: {
  skill: string;
  reason: SkillBlockReason;
  admin: boolean;
  onFixSkill(): void;
  onFixPersona(): void;
}) {
  const t = useT();
  return (
    <div className="callout callout-error" role="alert">
      <Icon name="alert" className="ic sm" />
      <div className="grow">
        <p><strong>{t("cv.blockedTitle")}</strong></p>
        <p>{t(`cv.blockedBody.${reason}` as never, { s: skill })}</p>
        {admin ? null : <p>{t("cv.blockedMember")}</p>}
      </div>
      {admin ? (
        reason === "invalid" || reason === "missing" ? (
          <button type="button" className="btn btn-secondary" onClick={onFixSkill}>
            <Icon name="spark" className="ic sm" />
            {t("cv.blockedFixSkill")}
          </button>
        ) : (
          <button type="button" className="btn btn-secondary" onClick={onFixPersona}>
            <Icon name="edit" className="ic sm" />
            {t("cv.blockedAdmin")}
          </button>
        )
      ) : null}
    </div>
  );
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: many small independent branches (field / state rendering); splitting would scatter one linear flow
export function ChatPane({ agent, conv, target, readOnlyReason, skillBlock, onChanged }: ChatPaneProps) {
  const t = useT();
  const host = useAppHost();
  const nav = useNav();
  const { toast } = useToast();
  const eff = useEffectiveTarget();
  const { api } = eff;
  const admin = eff.state.me?.admin === true;
  const [ensure, setEnsure] = useState<EnsureState>({ kind: "ensuring" });
  const [dialog, setDialog] = useState<"rename" | "delete" | null>(null);
  const [attempt, setAttempt] = useState(0);
  const blocked = !!readOnlyReason || conv.archived || !!skillBlock;
  const wasSleeping = conv.status === "sleeping";

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is the explicit retry trigger
  useEffect(() => {
    if (blocked) return;
    let cancelled = false;
    setEnsure({ kind: "ensuring" });
    api
      .ensure(agent.key, target, conv.id)
      .then((r) => !cancelled && setEnsure({ kind: "ready", sessionId: r.sessionId }))
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof ApiError && e.code === "skill_not_allowed") {
          const d = (e.details ?? {}) as { skill?: string; reason?: SkillBlockReason };
          setEnsure({ kind: "error", code: e.code, skill: d.skill, reason: d.reason });
        } else setEnsure({ kind: "error", code: e instanceof ApiError ? e.code : "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [api, agent.key, target, conv.id, blocked, attempt]);

  const restoreConv = async () => {
    try {
      await api.patchConversation(agent.key, target, conv.id, { archived: false });
      toast(t("toast.restoredConv"));
      onChanged();
      nav.navigate(withProject(agentPath(agent.key, conv.id), target));
    } catch (e) {
      toast(e instanceof ApiError && e.code === "conversation_limit" ? t("cv.limit", { max: 50 }) : t("grid.error"));
    }
  };
  const restart = async () => {
    await api.restart(agent.key, target, conv.id);
    toast(t("toast.restarted"));
    onChanged();
    setAttempt((n) => n + 1);
  };

  const items: MenuEntry[] = [];
  if (conv.personaStale && !blocked) items.push({ id: "restart", label: <><Icon name="refresh" className="ic sm" />{t("menu.restart")}</>, onSelect: () => void restart() });
  items.push({ id: "rename", label: <><Icon name="edit" className="ic sm" />{t("menu.rename")}</>, onSelect: () => setDialog("rename") });
  if (host.capabilities.dashboard && ensure.kind === "ready") {
    const sid = ensure.sessionId;
    items.push({ id: "open-dash", label: <><Icon name="openExt" className="ic sm" />{t("menu.openDash")}</>, onSelect: () => host.openSession(sid) });
  }
  if (conv.archived) items.push({ id: "restore", label: <><Icon name="reset" className="ic sm" />{t("menu.restore")}</>, onSelect: () => void restoreConv() });
  else
    items.push({
      id: "archive",
      label: <><Icon name="archive" className="ic sm" />{t("menu.archive")}</>,
      onSelect: () => {
        void api.patchConversation(agent.key, target, conv.id, { archived: true }).then(() => {
          toast(t("toast.archived"));
          onChanged();
          nav.toAgent(agent.key, target);
        });
      },
    });
  items.push("sep", { id: "delete", danger: true, label: <><Icon name="trash" className="ic sm" />{t("menu.deleteConv")}</>, onSelect: () => setDialog("delete") });

  // The 409 from ensure and the card-known block surface the same banner + disabled composer.
  const skillBlockedState: { skill: string; reason: SkillBlockReason } | null =
    skillBlock ??
    (ensure.kind === "error" && ensure.code === "skill_not_allowed"
      ? { skill: ensure.skill ?? agent.key, reason: ensure.reason ?? "invalid" }
      : null);

  const banners: ReactNode[] = [];
  if (readOnlyReason)
    banners.push(
      <div key="ro" className="callout callout-warning" role="status">
        <Icon name="warning" className="ic sm" />
        <div className="grow"><p>{t(`cv.readOnly.${readOnlyReason}` as never)}</p></div>
      </div>,
    );
  if (conv.archived)
    banners.push(
      <div key="ar" className="callout callout-info">
        <Icon name="archive" className="ic sm" />
        <div className="grow"><p>{t("cv.archivedBanner")}</p></div>
        {readOnlyReason ? null : (
          <button type="button" className="btn btn-secondary" onClick={() => void restoreConv()}>
            <Icon name="reset" className="ic sm" />
            {t("menu.restore")}
          </button>
        )}
      </div>,
    );
  if (conv.personaStale && !blocked)
    banners.push(
      <div key="st" className="callout callout-info">
        <Icon name="info" className="ic sm" />
        <div className="grow"><p>{t("cv.stale")}</p></div>
        <button type="button" className="btn btn-secondary" onClick={() => void restart()}>
          <Icon name="refresh" className="ic sm" />
          {t("cv.restart")}
        </button>
      </div>,
    );
  if (skillBlockedState)
    banners.push(
      <SkillBlockedBanner
        key="skill"
        skill={skillBlockedState.skill}
        reason={skillBlockedState.reason}
        admin={admin}
        onFixSkill={() => nav.toSkill(target, skillBlockedState.skill)}
        onFixPersona={() => nav.toEditor(target, agent.key)}
      />,
    );
  if (ensure.kind === "error" && !blocked && ensure.code !== "skill_not_allowed")
    banners.push(<ErrorBanner key="er" code={ensure.code} onRetry={() => setAttempt((n) => n + 1)} />);

  return (
    <section className="chat-pane" aria-label={conv.title}>
      <div className="chat-head">
        <button type="button" className="back-link list-back" onClick={() => nav.toAgent(agent.key, target)}>
          <Icon name="back" className="ic sm" />
          {t("cv.backList")}
        </button>
        <div className="chat-title">
          <h2 className="conv-heading">{conv.title}</h2>
          <span className="convo-meta">
            <StatusEl status={ensure.kind === "ensuring" && !blocked ? "sleeping" : conv.status} />
            <span className="chip model hide-sm">{agent.model || t("model.default")}</span>
            {agent.effectiveSkills.map((s) => (
              <span className="chip skill" key={s}>
                <Icon name="spark" className="ic sm" />
                {s}
              </span>
            ))}
          </span>
        </div>
        <MenuButton label={t("cv.convMenu", { title: conv.title })} items={items} testId="conv-menu" />
      </div>
      <div className="convo-banners">{banners}</div>
      {/* Skill-blocked: the transcript stays mounted read-only when a session existed (the history
          must remain readable); without one there is nothing to show. */}
      {skillBlockedState && ensure.kind !== "ready" ? (
        <div className="transcript" data-testid="transcript" />
      ) : blocked && !(ensure.kind === "ready" && skillBlockedState) ? (
        <div className="transcript" data-testid="transcript"><p className="hint chat-empty">{t("cv.startHint", { name: agent.name })}</p></div>
      ) : ensure.kind === "ensuring" ? (
        <div className="transcript" data-testid="transcript">
          <p className="thinking" role="status" style={{ marginTop: "2rem" }}>
            <span className="shape shape-busy" aria-hidden="true" />
            {t(wasSleeping ? "cv.resume" : "cv.spawn")}
          </p>
        </div>
      ) : ensure.kind === "ready" ? (
        host.mode === "standalone" ? (
          <ChatProviders apiBase=""><ChatBody sessionId={ensure.sessionId} agent={agent} readOnly={!!skillBlockedState} /></ChatProviders>
        ) : (
          <ChatBody sessionId={ensure.sessionId} agent={agent} readOnly={!!skillBlockedState} />
        )
      ) : (
        <div className="transcript" data-testid="transcript" />
      )}
      {skillBlockedState ? (
        <div className="composer">
          <div className="composer-card" aria-disabled="true">
            <textarea rows={1} disabled aria-label={t("cv.placeholder", { name: agent.name })} placeholder={t("cv.placeholder", { name: agent.name })} />
            <button type="button" className="btn btn-primary btn-send" disabled aria-label={t("cv.send")}>
              <Icon name="send" />
            </button>
          </div>
        </div>
      ) : null}
      {dialog === "rename" ? (
        <TextDialog
          title={t("dlg.rename.title")}
          label={t("dlg.rename.label")}
          hint={t("dlg.rename.hint")}
          initial={conv.title}
          okLabel={t("dlg.rename.ok")}
          validate={(v) => [...v.trim()].length >= 1 && [...v].length <= 80}
          errorText={t("err.title_invalid")}
          onOk={(v) => void api.patchConversation(agent.key, target, conv.id, { title: v.trim() }).then(() => { toast(t("toast.renamed")); onChanged(); })}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === "delete" ? (
        <ConfirmDialog
          title={t("dlg.deleteConv.title", { title: conv.title })}
          body={<p>{t("dlg.deleteConv.body")}</p>}
          okLabel={t("dlg.deleteConv.ok")}
          destructive
          onOk={() => void api.deleteConversation(agent.key, target, conv.id).then(() => { toast(t("toast.deletedConv")); onChanged(); nav.toAgent(agent.key, target); })}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </section>
  );
}
