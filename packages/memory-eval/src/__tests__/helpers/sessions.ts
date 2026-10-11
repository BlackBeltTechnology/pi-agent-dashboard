/** Synthetic pi session builder: invented sessions, no real text. */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type Step =
  | { user: string }
  | { tool: string; args: Record<string, unknown>; out: string; isError?: boolean; noIsErrorField?: boolean };

export const bash = (command: string, out: string, isError = false): Step => ({ tool: "bash", args: { command }, out, isError });
export const user = (text: string): Step => ({ user: text });

export interface SessionSpec {
  id: string;
  /** ISO start; each step advances 1 s. */
  start: string;
  steps: Step[];
  fileName?: string;
}

let counter = 0;

export function sessionText(spec: SessionSpec): string {
  const lines: string[] = [JSON.stringify({ type: "session", version: 3, id: spec.id, timestamp: spec.start, cwd: "/synthetic/project" })];
  let ms = Date.parse(spec.start);
  const tick = () => new Date((ms += 1000)).toISOString();
  for (const s of spec.steps) {
    if ("user" in s) {
      lines.push(JSON.stringify({ type: "message", id: `m${counter++}`, timestamp: tick(), message: { role: "user", content: [{ type: "text", text: s.user }] } }));
    } else {
      const id = `call_${counter++}`;
      lines.push(JSON.stringify({ type: "message", id: `m${counter++}`, timestamp: tick(), message: { role: "assistant", content: [{ type: "toolCall", id, name: s.tool, arguments: s.args }] } }));
      const msg: Record<string, unknown> = { role: "toolResult", toolCallId: id, toolName: s.tool, content: [{ type: "text", text: s.out }] };
      if (!s.noIsErrorField) msg.isError = s.isError === true;
      lines.push(JSON.stringify({ type: "message", id: `m${counter++}`, timestamp: tick(), message: msg }));
    }
  }
  return `${lines.join("\n")}\n`;
}

export function writeSession(dir: string, spec: SessionSpec): string {
  mkdirSync(dir, { recursive: true });
  const name = spec.fileName ?? `${spec.start.replace(/[:.]/g, "-")}_${spec.id}.jsonl`;
  writeFileSync(join(dir, name), sessionText(spec));
  return name;
}

export const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
