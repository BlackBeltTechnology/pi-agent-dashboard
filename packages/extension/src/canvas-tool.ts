/**
 * Registers the `canvas` declare-tool in the bridge extension
 * (change: auto-canvas, Decision 5).
 *
 * Fire-and-forget UI intent: the model calls `canvas(...)` to point the
 * dashboard canvas at a deliverable it is producing (a report/doc/mockup/
 * image, or a running dev server). The tool does NOT drive the canvas — the
 * server observes the forwarded `tool_execution_start` on the same event
 * stream `detectOpenSpecActivity`/the canvas accumulator read, and does the
 * cwd-anchored normalization + broadcast there.
 *
 * `execute` only validates the raw shape (cwd-free) via
 * `validateCanvasDeclareShape` and returns an honest ack: `{ok:true}` when the
 * shape is acceptable, or `{ok:false,error}` for a malformed/traversal target
 * (never `{ok:true}` when nothing could open). It never blocks the model.
 *
 * Registered at runtime (session_start) like `ask_user` to avoid static
 * tool-name conflicts.
 */

import { validateCanvasDeclareShape } from "@blackbelt-technology/pi-dashboard-shared/canvas-declare.js";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export function registerCanvasTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "canvas",
    label: "Canvas",
    description:
      "Open the dashboard canvas on a deliverable you're producing — a report, doc, mockup, image, or a running dev server. Call it when you create or update a user-facing artifact.",
    promptSnippet:
      "Point the dashboard canvas at a deliverable you're producing (file, url, or a running dev server)",
    promptGuidelines: [
      "Call canvas() when you produce or update a user-facing deliverable — a report/doc/mockup/image (target.kind='file', path relative to the session cwd), a web page (target.kind='url'), or a dev server you started (target.kind='server', port).",
      "Paths MUST be relative to the session cwd — never absolute and never containing '..'.",
      "This is fire-and-forget: it returns immediately and never blocks. Keep working after calling it.",
      "Use mode='pin' to keep the canvas on this artifact across later writes; default 'replace' lets the newest artifact take the slot.",
    ],
    // Flat root object (type=object) for OpenAI strict-mode compatibility.
    // `target` is a nested object whose required field depends on `kind`;
    // that per-kind requirement is enforced at runtime by
    // `validateCanvasDeclareShape` (server re-validates too), not the schema.
    parameters: Type.Object(
      {
        target: Type.Object(
          {
            kind: Type.Union(
              [Type.Literal("file"), Type.Literal("url"), Type.Literal("server")],
              {
                description:
                  "'file' = a file relative to the session cwd (needs path); 'url' = a web page (needs url); 'server' = a running dev server (needs port).",
              },
            ),
            path: Type.Optional(
              Type.String({
                description:
                  "Required for kind='file'. Relative to the session cwd — no absolute paths, no '..'.",
              }),
            ),
            url: Type.Optional(
              Type.String({ description: "Required for kind='url'. A full http(s) URL." }),
            ),
            port: Type.Optional(
              Type.Number({
                description:
                  "Required for kind='server'. The loopback port your dev server listens on (1–65535).",
              }),
            ),
          },
          { description: "What to open on the canvas." },
        ),
        mode: Type.Optional(
          Type.Union(
            [Type.Literal("replace"), Type.Literal("pin"), Type.Literal("section")],
            {
              description:
                "'replace' (default) = newest artifact takes the slot; 'pin' = keep this artifact across later writes; 'section' reserved (no-op).",
            },
          ),
        ),
        title: Type.Optional(
          Type.String({ description: "Optional label for the canvas tab." }),
        ),
        section: Type.Optional(
          Type.String({ description: "Reserved for mode='section' (v2 no-op)." }),
        ),
      },
      {
        description:
          "Point the dashboard canvas at a deliverable. Fire-and-forget: returns { ok: true } when accepted, or { ok: false, error } for a bad/traversal target.",
      },
    ),
    async execute(_toolCallId: any, params: any) {
      const error = validateCanvasDeclareShape(params);
      if (error) {
        return {
          content: [{ type: "text", text: JSON.stringify({ ok: false, error }) }],
          details: { ok: false, error },
        };
      }
      return {
        content: [{ type: "text", text: JSON.stringify({ ok: true }) }],
        details: { ok: true },
      };
    },
  });
}
