/**
 * A tiny OpenAI-compatible chat-completions server for the team E2E: records every request
 * (so a spec can assert on the provider-bound system prompt and tool list) and replays a
 * scripted reply — plain text or one tool call. Registered in the instance's
 * `models.json` as provider `fakellm`. See change: add-team-plugin.
 */
import http from "node:http";

export interface LlmRequest {
  system: string;
  userTexts: string[];
  toolNames: string[];
  toolResults: string[];
  raw: Record<string, unknown>;
}

export type LlmReply = { text: string } | { toolCall: { name: string; args: Record<string, unknown> } };

export interface FakeLlm {
  baseUrl: string;
  /** Agent-turn requests (those carrying a tool list), oldest first. */
  requests: LlmRequest[];
  /** Next replies, consumed in order; default `{ text: "FAKE-REPLY" }`. */
  script: LlmReply[];
  close(): Promise<void>;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((c) => (typeof c === "object" && c && "text" in c ? String((c as { text: unknown }).text) : "")).join("");
  return "";
}

export async function startFakeLlm(): Promise<FakeLlm> {
  const requests: LlmRequest[] = [];
  const script: LlmReply[] = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => {
      body += d;
    });
    req.on("end", () => {
      if (req.method !== "POST" || !req.url?.includes("/chat/completions")) {
        res.writeHead(404).end();
        return;
      }
      const parsed = JSON.parse(body || "{}") as { messages?: Array<{ role: string; content?: unknown }>; tools?: Array<{ function?: { name?: string } }> };
      const msgs = parsed.messages ?? [];
      const lr: LlmRequest = {
        system: msgs.filter((m) => m.role === "system" || m.role === "developer").map((m) => textOf(m.content)).join("\n"),
        userTexts: msgs.filter((m) => m.role === "user").map((m) => textOf(m.content)),
        toolNames: (parsed.tools ?? []).map((t) => t.function?.name ?? ""),
        toolResults: msgs.filter((m) => m.role === "tool").map((m) => textOf(m.content)),
        raw: parsed as Record<string, unknown>,
      };
      // Only turns that carry a tool list are agent turns; naming / probe calls neither
      // consume the script nor show up in `requests`.
      const isAgentTurn = lr.toolNames.length > 0;
      if (isAgentTurn) requests.push(lr);
      const reply = (isAgentTurn ? script.shift() : undefined) ?? { text: "FAKE-REPLY" };
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      const chunk = (delta: Record<string, unknown>, finish: string | null) =>
        res.write(`data: ${JSON.stringify({ id: "chatcmpl-fake", object: "chat.completion.chunk", created: 1, model: "fake-model", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
      if ("text" in reply) {
        chunk({ role: "assistant", content: reply.text }, null);
        chunk({}, "stop");
      } else {
        chunk({ role: "assistant", tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: reply.toolCall.name, arguments: JSON.stringify(reply.toolCall.args) } }] }, null);
        chunk({}, "tool_calls");
      }
      res.write(`data: ${JSON.stringify({ id: "chatcmpl-fake", object: "chat.completion.chunk", created: 1, model: "fake-model", choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}\n\n`);
      res.end("data: [DONE]\n\n");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as { port: number }).port;
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests,
    script,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
