/**
 * Server-side dispatcher for "translate via bridge".
 *
 * When the dashboard server can't translate via providers.json (because the
 * requested model lives behind a pi OAuth provider like opencode-go), it
 * forwards the request to a connected bridge over the existing pi gateway
 * WebSocket. The bridge resolves auth via pi's modelRegistry and replies.
 *
 * This module owns the in-memory request/response correlation table
 * (Map<requestId, resolver>) and the timeout. The pi gateway's
 * `onEvent` hook routes incoming `translate_response` messages here.
 */

import { randomUUID } from "node:crypto";
import type { PiGateway } from "./pi-gateway.js";
import type {
  TranslateResponseMessage,
} from "@blackbelt-technology/pi-dashboard-shared/protocol.js";
import type { CompletionResult } from "@blackbelt-technology/pi-dashboard-shared/provider-completion-helpers.js";

const DEFAULT_TIMEOUT_MS = 35000; // a hair longer than bridge fetch timeout

interface PendingEntry {
  resolve: (r: CompletionResult) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface TranslateBridgeDispatcher {
  /** Forward a translate request to a bridge and await the response. */
  translate(input: {
    provider: string;
    model: string;
    system: string;
    user: string;
    maxTokens?: number;
    timeoutMs?: number;
  }): Promise<CompletionResult>;
  /** Server's pi-gateway onEvent hook calls this for every translate_response. */
  handleResponse(msg: TranslateResponseMessage): void;
  /** Test/teardown helper: reject all pending and clear. */
  shutdown(reason: string): void;
}

export interface CreateTranslateBridgeDispatcherInput {
  piGateway: PiGateway;
}

export function createTranslateBridgeDispatcher(
  input: CreateTranslateBridgeDispatcherInput,
): TranslateBridgeDispatcher {
  const { piGateway } = input;
  const pending = new Map<string, PendingEntry>();

  function resolveAndCleanup(requestId: string, result: CompletionResult): void {
    const entry = pending.get(requestId);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(requestId);
    entry.resolve(result);
  }

  return {
    async translate({ provider, model, system, user, maxTokens, timeoutMs }) {
      const sessionIds = piGateway.getConnectedSessionIds();
      if (sessionIds.length === 0) {
        return {
          ok: false,
          error:
            "No bridge is currently connected to translate via pi-managed providers. Open a pi session and try again, or configure the model's provider under Settings → Custom LLM Providers.",
        };
      }

      const requestId = randomUUID();
      const modelRef = `${provider}/${model}`;
      const targetSessionId = sessionIds[0]!; // any connected bridge can handle any model

      const promise = new Promise<CompletionResult>((resolve) => {
        const timer = setTimeout(() => {
          resolveAndCleanup(requestId, {
            ok: false,
            error: `Translation timed out after ${timeoutMs ?? DEFAULT_TIMEOUT_MS}ms (bridge did not reply).`,
          });
        }, timeoutMs ?? DEFAULT_TIMEOUT_MS);
        pending.set(requestId, { resolve, timer });
      });

      const sent = piGateway.sendToSession(targetSessionId, {
        type: "translate_request",
        requestId,
        modelRef,
        system,
        user,
        maxTokens,
      });
      if (!sent) {
        // Race: connection dropped between getConnectedSessionIds() and send.
        resolveAndCleanup(requestId, {
          ok: false,
          error: "Bridge connection dropped before request was delivered.",
        });
      }

      return promise;
    },

    handleResponse(msg) {
      if (msg.ok) {
        resolveAndCleanup(msg.requestId, { ok: true, text: msg.text });
      } else {
        resolveAndCleanup(msg.requestId, {
          ok: false,
          status: msg.status,
          error: msg.error,
        });
      }
    },

    shutdown(reason) {
      for (const [id, entry] of pending) {
        clearTimeout(entry.timer);
        entry.resolve({ ok: false, error: `Translate bridge shutting down: ${reason}` });
        pending.delete(id);
      }
    },
  };
}
