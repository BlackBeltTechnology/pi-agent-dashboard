import React from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { getInteractiveRenderer } from "../interactive-renderers/registry.js";
import type { InteractiveUiRequest } from "../../lib/chat/event-reducer.js";

/**
 * Grouped multi-ask panel: renders the set of concurrently-pending
 * free-floating asks (no `toolCallId`) as one cohesive vertical stack of
 * independently-answerable cards. Each card reuses the per-type renderer
 * (confirm / select / input / multiselect / batch) and answers ITS OWN
 * `requestId` — there is no atomic submit. A `method:"batch"` entry renders as
 * its BatchRenderer wizard occupying one slot.
 *
 * The panel reflects the current pending set each render: late arrivals append,
 * resolved/cancelled asks drop out, and when the set empties the caller stops
 * rendering the panel entirely.
 *
 * See change: surface-concurrent-ask-user-prompts.
 */
export function MultiAskPanel({ requests, onRespondToUi }: {
  requests: InteractiveUiRequest[];
  onRespondToUi?: (requestId: string, result?: unknown, cancelled?: boolean) => void;
}) {
  if (requests.length === 0) return null;
  return (
    <div
      data-testid="multi-ask-panel"
      className="mt-4 mb-4 mx-4 rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-secondary)]"
    >
      <div className="px-3 pt-2 text-[10px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]">
        {i18nT("chat.multiAsk.heading", { count: requests.length }, "Needs you")}
      </div>
      <div className="flex flex-col divide-y divide-[var(--border-secondary)]">
        {requests.map((request) => {
          const Renderer = getInteractiveRenderer(request.method);
          return (
            <div key={request.requestId} data-testid={`multi-ask-card-${request.requestId}`}>
              <Renderer
                requestId={request.requestId}
                method={request.method}
                params={request.params}
                status={request.status}
                result={request.result}
                onRespond={(result) => onRespondToUi?.(request.requestId, result)}
                onCancel={() => onRespondToUi?.(request.requestId, undefined, true)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
