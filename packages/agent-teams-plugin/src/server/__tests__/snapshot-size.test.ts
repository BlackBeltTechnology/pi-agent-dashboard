/**
 * Snapshot size (test-plan S83): a 304 has no body; the full body at core's caps
 * (50 × 2 000-char tasks, 100 × 2 000-char mails) stays within 384 KiB (measured 332 223 B).
 * See change: add-agent-teams-ui.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createUiEnv, type UiEnv } from "../../__tests__/harness/ui-env.js";
import { SNAPSHOT_MAIL_LIMIT, SNAPSHOT_MAIL_TEXT_MAX, TASK_DESCRIPTION_MAX_CHARS } from "../../shared/constants.js";

const envs: UiEnv[] = [];
afterEach(async () => {
  await Promise.all(envs.splice(0).map((e) => e.close()));
});

async function heavy(mailChars: number) {
  const e = await createUiEnv({ epoch: "E" });
  envs.push(e);
  const team = await e.createTeam();
  for (let m = 0; m < 10; m++) e.addMember(team, `m${m}`, "busy");
  for (let i = 0; i < 50; i++) e.rt.store.addTask(team.id, { title: "t".repeat(200), description: "d".repeat(TASK_DESCRIPTION_MAX_CHARS), createdBy: "lead", owner: `m${i % 10}` });
  for (let i = 0; i < SNAPSHOT_MAIL_LIMIT + 20; i++) e.rt.store.appendMail(team.id, { from: "lead", to: "m1", kind: "message", text: "x".repeat(mailChars), wake: false });
  return { e, team };
}

describe("snapshot size (S83)", () => {
  it("a 304 body is 0 bytes", async () => {
    const { e, team } = await heavy(100);
    const full = await e.get(`/teams/${team.id}`);
    const res = await e.get(`/teams/${team.id}`, { "if-none-match": full.headers.etag as string });
    expect(res.status).toBe(304);
    expect(Buffer.byteLength(res.raw)).toBe(0);
  });

  it("≤ 384 KiB at 50 tasks × 2 000 chars + 10 members + core's max mail tail (100 × 2 000) — design A12", async () => {
    const { e, team } = await heavy(SNAPSHOT_MAIL_TEXT_MAX);
    const res = await e.get(`/teams/${team.id}`);
    expect(JSON.parse(res.raw).mail).toHaveLength(SNAPSHOT_MAIL_LIMIT);
    expect(Buffer.byteLength(res.raw)).toBeLessThanOrEqual(384 * 1024);
  });
});
