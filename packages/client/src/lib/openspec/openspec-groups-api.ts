/**
 * Client fetch helpers for the `/api/openspec/groups` endpoints.
 *
 * See change: add-openspec-change-grouping (tasks 5.1–5.2).
 */
import type {
  OpenSpecGroup,
  OpenSpecGroupsFile,
} from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type {
  CreateOpenSpecGroupRequest,
  UpdateOpenSpecGroupRequest,
  SetOpenSpecGroupAssignmentRequest,
  SetOpenSpecChangeOrderRequest,
} from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { getApiBase } from "../api/api-context.js";

function groupsUrl(cwd: string, suffix = ""): string {
  return `${getApiBase()}/api/openspec/groups${suffix}?cwd=${encodeURIComponent(cwd)}`;
}

async function parseErrorBody(res: Response): Promise<string> {
  try {
    const json = await res.json();
    return json?.error ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

/** GET /api/openspec/groups?cwd= */
export async function fetchGroups(cwd: string, signal?: AbortSignal): Promise<OpenSpecGroupsFile> {
  const res = await fetch(groupsUrl(cwd), { signal });
  if (!res.ok) throw new Error(await parseErrorBody(res));
  const json = await res.json();
  if (!json.success) throw new Error(json.error ?? "fetch groups failed");
  return json.data as OpenSpecGroupsFile;
}

/** POST /api/openspec/groups?cwd= */
export async function createGroup(
  cwd: string,
  body: CreateOpenSpecGroupRequest,
): Promise<OpenSpecGroup> {
  const res = await fetch(groupsUrl(cwd), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await parseErrorBody(res));
  const json = await res.json();
  if (!json.success) throw new Error(json.error ?? "create group failed");
  return json.data as OpenSpecGroup;
}

/** PATCH /api/openspec/groups/:id?cwd= */
export async function updateGroup(
  cwd: string,
  id: string,
  body: UpdateOpenSpecGroupRequest,
): Promise<OpenSpecGroup> {
  const res = await fetch(groupsUrl(cwd, `/${encodeURIComponent(id)}`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await parseErrorBody(res));
  const json = await res.json();
  if (!json.success) throw new Error(json.error ?? "update group failed");
  return json.data as OpenSpecGroup;
}

/** DELETE /api/openspec/groups/:id?cwd= */
export async function deleteGroup(cwd: string, id: string): Promise<void> {
  const res = await fetch(groupsUrl(cwd, `/${encodeURIComponent(id)}`), {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(await parseErrorBody(res));
  const json = await res.json();
  if (!json.success) throw new Error(json.error ?? "delete group failed");
}

/** PUT /api/openspec/groups/assignments?cwd= */
export async function setAssignment(
  cwd: string,
  body: SetOpenSpecGroupAssignmentRequest,
): Promise<void> {
  const res = await fetch(groupsUrl(cwd, "/assignments"), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await parseErrorBody(res));
  const json = await res.json();
  if (!json.success) throw new Error(json.error ?? "set assignment failed");
}

/** PUT /api/openspec/groups/change-order?cwd= */
export async function setChangeOrder(
  cwd: string,
  body: SetOpenSpecChangeOrderRequest,
): Promise<void> {
  const res = await fetch(groupsUrl(cwd, "/change-order"), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await parseErrorBody(res));
  const json = await res.json();
  if (!json.success) throw new Error(json.error ?? "set change order failed");
}
