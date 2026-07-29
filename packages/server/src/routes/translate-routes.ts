/**
 * Translate REST route — POST /api/translate.
 *
 * Two execution paths, decided per-request:
 *
 *  1. Direct path — when the chosen provider has an entry in
 *     `~/.pi/agent/providers.json` (custom LLM provider with api key).
 *     Server makes the HTTP call itself via `completeWithProvider`.
 *
 *  2. Bridge path — when the provider is NOT in providers.json. This
 *     covers pi OAuth providers (opencode-go, anthropic-cli, gemini-cli,
 *     codex, copilot, antigravity) whose auth lives in `~/.pi/agent/auth.json`
 *     and is only accessible from inside a pi session via `pi.modelRegistry`.
 *     Server forwards the request to a connected bridge over the pi gateway
 *     WebSocket and awaits the bridge's `translate_response`.
 */
import type { FastifyInstance } from "fastify";
import type { NetworkGuard } from "./route-deps.js";
import { completeWithProvider } from "../provider-completion.js";
import { readProvidersFromDisk } from "../package/provider-probe.js";
import type { TranslateBridgeDispatcher } from "../translate-via-bridge.js";

// System prompt anchors a "translation engine" role so smaller chat-tuned
// models don't drift into answering the user's message instead of translating.
const TRANSLATE_SYSTEM_PROMPT = [
  "You are a translation engine. Your only job is to translate the user message to English.",
  "Rules:",
  "- Output ONLY the English translation. No preamble, no answer to the content, no commentary.",
  "- If the message is already in English, output it verbatim.",
  "- Do NOT translate code, file paths, URLs, identifiers, /commands or @mentions \u2014 keep them as-is.",
].join("\n");

const MAX_INPUT_CHARS = 20000;
const TRANSLATE_MAX_TOKENS = 1024;

function isProviderInProvidersJson(providerName: string): boolean {
  const all = readProvidersFromDisk();
  const entry = all[providerName];
  if (!entry) return false;
  // Must have a usable api key (REDACTED, $ENV, or literal). Empty string =
  // no api key configured → fall back to bridge path.
  return Boolean(entry.apiKey && entry.apiKey.trim());
}

export function registerTranslateRoutes(
  fastify: FastifyInstance,
  deps: {
    networkGuard: NetworkGuard;
    bridgeDispatcher: TranslateBridgeDispatcher;
  },
): void {
  const { networkGuard, bridgeDispatcher } = deps;

  fastify.post(
    "/api/translate",
    { preHandler: networkGuard },
    async (request, reply) => {
      const body = request.body as Record<string, any> | null;
      if (!body || typeof body !== "object") {
        return reply.code(400).send({ ok: false, error: "Invalid body" });
      }
      const text = typeof body.text === "string" ? body.text : "";
      const provider = typeof body.provider === "string" ? body.provider.trim() : "";
      const model = typeof body.model === "string" ? body.model.trim() : "";

      if (!text.trim()) {
        return reply.code(400).send({ ok: false, error: "text is required" });
      }
      if (text.length > MAX_INPUT_CHARS) {
        return reply.code(400).send({
          ok: false,
          error: `text exceeds ${MAX_INPUT_CHARS} character limit`,
        });
      }
      if (!provider) {
        return reply.code(400).send({ ok: false, error: "provider is required" });
      }
      if (!model) {
        return reply.code(400).send({ ok: false, error: "model is required" });
      }

      const useDirect = isProviderInProvidersJson(provider);

      const result = useDirect
        ? await completeWithProvider({
            providerName: provider,
            model,
            system: TRANSLATE_SYSTEM_PROMPT,
            user: text,
            maxTokens: TRANSLATE_MAX_TOKENS,
          })
        : await bridgeDispatcher.translate({
            provider,
            model,
            system: TRANSLATE_SYSTEM_PROMPT,
            user: text,
            maxTokens: TRANSLATE_MAX_TOKENS,
          });

      if (!result.ok) {
        return reply.code(502).send(result);
      }
      return { ok: true, translated: result.text };
    },
  );
}
