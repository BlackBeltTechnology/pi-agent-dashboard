import { describe, it, expect, beforeEach, vi } from "vitest";
import { setGlobalApiBase } from "../api/api-context.js";
import {
  fetchGroups,
  createGroup,
  updateGroup,
  deleteGroup,
  setAssignment,
} from "../openspec/openspec-groups-api.js";

const mockFetch = vi.fn();
globalThis.fetch = mockFetch as any;

function ok(data: unknown) {
  return { ok: true, status: 200, json: () => Promise.resolve({ success: true, data }) };
}
function fail(status: number, error: string) {
  return { ok: false, status, json: () => Promise.resolve({ success: false, error }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  setGlobalApiBase("");
});

describe("fetchGroups", () => {
  it("returns groups data on success", async () => {
    const payload = { schemaVersion: 1, groups: [], assignments: {} };
    mockFetch.mockResolvedValueOnce(ok(payload));
    const result = await fetchGroups("/project");
    expect(result).toEqual(payload);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/openspec/groups?cwd=%2Fproject"),
      expect.objectContaining({}),
    );
  });

  it("throws on non-200", async () => {
    mockFetch.mockResolvedValueOnce(fail(400, "Missing cwd"));
    await expect(fetchGroups("/x")).rejects.toThrow("Missing cwd");
  });

  it("throws on success:false", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: false, error: "bad" }),
    });
    await expect(fetchGroups("/x")).rejects.toThrow("bad");
  });
});

describe("createGroup", () => {
  it("returns new group on success", async () => {
    const group = { id: "ui", name: "UI", color: "#3b82f6", order: 0 };
    mockFetch.mockResolvedValueOnce(ok(group));
    const result = await createGroup("/project", { name: "UI", color: "#3b82f6" });
    expect(result).toEqual(group);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/openspec/groups?cwd="),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("throws on error", async () => {
    mockFetch.mockResolvedValueOnce(fail(422, "bad name"));
    await expect(createGroup("/x", { name: "" })).rejects.toThrow("bad name");
  });
});

describe("updateGroup", () => {
  it("returns updated group", async () => {
    const group = { id: "ui", name: "Frontend", order: 0 };
    mockFetch.mockResolvedValueOnce(ok(group));
    const result = await updateGroup("/project", "ui", { name: "Frontend" });
    expect(result).toEqual(group);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/openspec/groups/ui?cwd="),
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  it("throws 404 on unknown id", async () => {
    mockFetch.mockResolvedValueOnce(fail(404, "Group not found"));
    await expect(updateGroup("/x", "nope", { name: "X" })).rejects.toThrow("Group not found");
  });
});

describe("deleteGroup", () => {
  it("resolves on success", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true }),
    });
    await expect(deleteGroup("/project", "ui")).resolves.toBeUndefined();
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/openspec/groups/ui?cwd="),
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("throws on 404", async () => {
    mockFetch.mockResolvedValueOnce(fail(404, "Group not found"));
    await expect(deleteGroup("/x", "nope")).rejects.toThrow("Group not found");
  });
});

describe("setAssignment", () => {
  it("resolves on success", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true }),
    });
    await expect(
      setAssignment("/project", { changeName: "add-foo", groupId: "ui" }),
    ).resolves.toBeUndefined();
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/openspec/groups/assignments?cwd="),
      expect.objectContaining({ method: "PUT" }),
    );
  });

  it("throws 422 on unknown groupId", async () => {
    mockFetch.mockResolvedValueOnce(fail(422, "Unknown groupId"));
    await expect(
      setAssignment("/x", { changeName: "c", groupId: "nope" }),
    ).rejects.toThrow("Unknown groupId");
  });
});
