/**
 * Grammar/spell-check REST routes: `POST /api/grammar/check` and
 * `GET /api/grammar/health`. Both are auth-gated by the shared `networkGuard`
 * preHandler. The check route is a thin mapper over `checkGrammar`; it emits
 * one structured log line per invocation with NO draft text.
 *
 * Config is re-read per request (`getGrammarConfig`) so a settings backend
 * switch takes effect without a server restart.
 * See change: add-composer-grammar-check.
 */

import type { GrammarConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import type {
  GrammarCheckResult,
  GrammarErrorCode,
  GrammarHealth,
} from "@blackbelt-technology/pi-dashboard-shared/grammar-types.js";
import type { ApiResponse } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { FastifyInstance } from "fastify";
import {
  checkGrammar as defaultCheckGrammar,
  getGrammarHealth as defaultGetGrammarHealth,
  type GrammarCheckOutcome,
} from "../grammar/grammar-service.js";
import type { NetworkGuard } from "./route-deps.js";

const STATUS_BY_CODE: Record<GrammarErrorCode, number> = {
  grammar_disabled: 409,
  empty_text: 400,
  backend_unconfigured: 400,
  backend_unreachable: 502,
  backend_timeout: 504,
  backend_bad_response: 502,
};

export interface GrammarRouteDeps {
  networkGuard: NetworkGuard;
  /** Re-reads the resolved grammar config per request. */
  getGrammarConfig: () => GrammarConfig;
  /** Injectable for tests; defaults to the real service. */
  check?: typeof defaultCheckGrammar;
  health?: typeof defaultGetGrammarHealth;
}

export function registerGrammarRoutes(fastify: FastifyInstance, deps: GrammarRouteDeps): void {
  const { networkGuard, getGrammarConfig } = deps;
  const check = deps.check ?? defaultCheckGrammar;
  const health = deps.health ?? defaultGetGrammarHealth;

  fastify.post<{ Body: { text?: unknown; language?: unknown } }>(
    "/api/grammar/check",
    { preHandler: networkGuard },
    async (request, reply) => {
      const config = getGrammarConfig();
      const text = typeof request.body?.text === "string" ? request.body.text : "";
      const language =
        typeof request.body?.language === "string" ? request.body.language : undefined;
      const started = Date.now();

      let outcome: GrammarCheckOutcome;
      try {
        outcome = await check({ text, language, config });
      } catch {
        // checkGrammar never throws, but guard defensively.
        outcome = { ok: false, code: "backend_unreachable", message: "grammar backend failed" };
      }

      const ms = Date.now() - started;
      if (outcome.ok) {
        console.log(
          "[grammar]",
          JSON.stringify({
            backend: outcome.result.backend,
            language: outcome.result.language,
            length: text.length,
            ms,
            suggestions: outcome.result.suggestions.length,
            truncated: outcome.result.truncated,
          }),
        );
        return { success: true, data: outcome.result } satisfies ApiResponse<GrammarCheckResult>;
      }

      console.warn(
        "[grammar]",
        JSON.stringify({ backend: config.backend, length: text.length, ms, code: outcome.code }),
      );
      reply.code(STATUS_BY_CODE[outcome.code] ?? 500);
      return { success: false, error: outcome.message, code: outcome.code } satisfies ApiResponse;
    },
  );

  fastify.get(
    "/api/grammar/health",
    { preHandler: networkGuard },
    async (): Promise<ApiResponse<GrammarHealth>> => {
      const data = await health(getGrammarConfig());
      return { success: true, data };
    },
  );
}
