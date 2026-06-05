import React from "react";
import { Icon } from "@mdi/react";
import { mdiCheck } from "@mdi/js";

/**
 * AnsweredOption — one row in a resolved select/multiselect/confirm card.
 *
 * Collapse emphasis, not information: answered cards keep the full option
 * list. The chosen option(s) render highlighted (`picked`); the rest render
 * dimmed (`skip`). Shared by ConfirmRenderer, SelectRenderer and
 * MultiselectRenderer so the pick/skip styling stays in one place.
 *
 * See change: redesign-ask-user-question-cards.
 */
export function AnsweredOption({
  title,
  description,
  picked,
}: {
  title: string;
  description?: string;
  picked: boolean;
}) {
  return (
    <div
      className={
        picked
          ? "flex items-start gap-2 px-2.5 py-1.5 rounded-md text-xs border border-green-500/35 bg-green-500/10 text-[var(--text-primary)]"
          : "flex items-start gap-2 px-2.5 py-1.5 rounded-md text-xs border border-transparent text-[var(--text-tertiary)]"
      }
    >
      <span
        className={
          picked
            ? "mt-0.5 w-4 h-4 rounded grid place-items-center bg-green-500 text-[#06210f] shrink-0"
            : "mt-0.5 w-4 h-4 rounded border-[1.5px] border-[var(--border-secondary)] shrink-0"
        }
      >
        {picked && <Icon path={mdiCheck} size={0.5} />}
      </span>
      <span className="min-w-0">
        <span>{title}</span>
        {description && (
          <span className="block text-[var(--text-tertiary)]">{description}</span>
        )}
      </span>
    </div>
  );
}
