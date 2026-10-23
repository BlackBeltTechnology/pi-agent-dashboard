/**
 * Read-only reader for a flow's declared `inputs:` schema.
 *
 * Parses `<cwd>/.pi/flows/flows/<ns>/<name>/flow.yaml` and returns the
 * declared flow-level inputs (name + type + required). This is the source of
 * truth the automation input-wiring UI renders from. It NEVER writes a flow
 * file — the automation side only reads the flow's input contract.
 *
 * Mirrors pi-flows' `FlowInputDecl` shape (`flow-typed-io-and-run-state`)
 * without a compile dependency on the pi-flows package.
 *
 * See change: wire-flow-inputs-in-automation.
 */
import fs from "node:fs";
import path from "node:path";
import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import type { AdmitCwdOptions } from "@blackbelt-technology/pi-dashboard-shared/cwd-guard.js";
import {
  admitRouteCwdParam,
  sendRouteCwdRefusal,
} from "@blackbelt-technology/pi-dashboard-shared/plugin-route-cwd.js";
import { parse as parseYaml } from "yaml";

export type FlowInputType = "string" | "number" | "boolean" | "object" | "array";
const VALID_TYPES: readonly FlowInputType[] = ["string", "number", "boolean", "object", "array"];

export interface FlowInputField {
  name: string;
  type: FlowInputType;
  required: boolean;
}

/** A path segment that would climb or stay put (`.` / `..`) — never a flow namespace or name. */
const isDotSegment = (s: string): boolean => s === "." || s === "..";

/**
 * Whether a flow id could escape the flows dir: exactly `.` / `..`, or any path separator.
 * Only EXACT dot segments count — `team.review`, `a..b`, `...`, `.hidden`, `x.` stay valid.
 * For the `<ns>:<name>` form each segment is checked, since `..:x` would climb.
 * See change: harden-git-terminal-plugin-boundaries (S1r).
 */
export function isTraversalFlowId(flowId: string): boolean {
  if (flowId.includes("/") || flowId.includes("\\")) return true;
  return flowId.split(":").some(isDotSegment);
}

/** Resolve a `<ns>:<name>` flow id to its `flow.yaml` path under `cwd`. */
export function flowYamlPath(cwd: string, flowId: string): string | null {
  const m = /^([\w.-]+):([\w.-]+)$/.exec(flowId);
  if (!m || isDotSegment(m[1]) || isDotSegment(m[2])) return null;
  return path.join(cwd, ".pi", "flows", "flows", m[1], m[2], "flow.yaml");
}

/**
 * Read a flow's declared inputs (read-only). Returns `[]` for a missing file,
 * unparseable yaml, or a flow with no `inputs:`. Invalid input entries are
 * skipped rather than throwing (isolate bad rows, keep good ones).
 */
export function readFlowInputs(cwd: string, flowId: string): FlowInputField[] {
  const p = flowYamlPath(cwd, flowId);
  if (!p) return [];
  let doc: unknown;
  try {
    doc = parseYaml(fs.readFileSync(p, "utf-8"));
  } catch {
    return [];
  }
  const raw = (doc as Record<string, unknown> | null)?.inputs;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const out: FlowInputField[] = [];
  for (const [name, decl] of Object.entries(raw as Record<string, unknown>)) {
    const d = decl as Record<string, unknown> | null;
    const type = d?.type;
    if (typeof type !== "string" || !(VALID_TYPES as readonly string[]).includes(type)) continue;
    out.push({ name, type: type as FlowInputType, required: d?.required === true });
  }
  return out;
}

export interface FlowInputsRouteDeps {
  /** Live admit set (host known folders), read per request. Fail-closed default: nothing known. */
  knownCwds?: () => string[];
  /** `admitCwd` options (the host's throttled `onIndeterminate` logger; test seams). */
  admitOptions?: AdmitCwdOptions;
}

/**
 * `GET /api/plugins/flows/flow-inputs?cwd=&flow=` — read-only. The cwd is REQUIRED and admitted
 * (400 `invalid_cwd` / `cwd_required`, 403, 503) before any flow file is read — there is no
 * `process.cwd()` fallback — and a traversal-shaped flow id is 400 `invalid_flow_id`.
 * See change: wire-flow-inputs-in-automation; harden-git-terminal-plugin-boundaries (S1r).
 */
export function mountFlowInputsRoute(fastify: ServerPluginContext["fastify"], deps: FlowInputsRouteDeps = {}): void {
  fastify.get("/api/plugins/flows/flow-inputs", async (req, reply) => {
    const q = (req.query ?? {}) as Record<string, unknown>;
    const adm = await admitRouteCwdParam(q.cwd, {
      required: true,
      ...(deps.knownCwds ? { knownCwds: deps.knownCwds } : {}),
      ...(deps.admitOptions ? { admitOptions: deps.admitOptions } : {}),
    });
    if (!adm.ok) return sendRouteCwdRefusal(reply, adm);
    try {
      const flow = typeof q.flow === "string" ? q.flow : "";
      if (flow && isTraversalFlowId(flow)) {
        reply.code(400);
        return { error: "invalid_flow_id", message: "flow id must not contain path separators or dot segments" };
      }
      return { inputs: flow && adm.cwd ? readFlowInputs(adm.cwd, flow) : [] };
    } finally {
      adm.release();
    }
  });
}
