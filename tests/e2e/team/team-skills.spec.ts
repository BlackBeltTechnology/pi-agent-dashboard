/**
 * Model-driven skill-access behaviour against a REAL dashboard + REAL pi, with the fake
 * OpenAI-compatible provider (see fake-llm.ts). Covers test-plan #F1–#F6 of
 * add-team-skill-access.
 *
 *  F1  a global agent-dir skill (`release-cut`) and an extension-discovered skill (`memory-x`,
 *      via `resources_discover`) never reach the provider prompt; the granted `review` skill
 *      does; the persona and the bridge fragment survive
 *  F2  a read inside the granted root succeeds; a sibling skill read comes back as
 *      `team: path_outside_root`
 *  F3  a granted `/skill:` reaches the model as the bridge-built envelope; an ungranted one
 *      never sends and the chat says so
 *  F5  a widening managed edit ends nothing; the live session keeps answering
 *  F4  a narrowing managed edit ends the streaming session within 5 s, keeps the record,
 *      refuses the reopen with `reason:"targets"` and shows the reason-specific banner with
 *      the history still readable
 *  F6  a persona whose skill's path went invalid shows a blocked card; "Fix skill" opens the
 *      Skills-panel entry
 *
 * Needs the `pi` CLI on PATH. See change: add-team-skill-access.
 */
import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { type FakeLlm, startFakeLlm } from "./fake-llm.js";
import { installLeakyExtension } from "./leaky-extension.js";
import { bootTeamHarness, enc, hasPi, type TeamHarness, type User } from "./team-harness.js";

test.skip(!hasPi, "needs the pi CLI on PATH to spawn real sessions");
test.describe.configure({ mode: "serial", timeout: 180_000 });

let h: TeamHarness;
let llm: FakeLlm;
let anna: User;
let billingDir = "";
let reviewDir = "";
let f4ConvId = "";

async function openConversation(key: string, convId: string): Promise<void> {
  await anna.page.goto(`${h.base}/apps/team/agent/${enc(key)}/c/${convId}?project=billing`);
  await expect(anna.page.locator('[data-testid="composer-input-row"] textarea')).toBeEnabled({ timeout: 90_000 });
}

async function sendPrompt(text: string): Promise<void> {
  const box = anna.page.locator('[data-testid="composer-input-row"] textarea');
  await expect(box).toBeEnabled({ timeout: 90_000 });
  await box.fill(text);
  await box.press("Enter");
}

const lastTurn = () => llm.requests[llm.requests.length - 1];
const waitForTurns = async (n: number) => expect.poll(() => llm.requests.length, { timeout: 60_000 }).toBeGreaterThanOrEqual(n);

/** Every session anna owns in the billing project, whatever the status. */
const billingSessions = async () => (await h.sessions()).filter((s) => s.cwd === billingDir && s.principalOwner?.sub === "sub-anna");

const newConversation = async (key: string): Promise<string> => {
  const r = await h.api(anna, "POST", `/agents/${enc(key)}/conversations?project=billing`);
  expect(r.status, JSON.stringify(r.json)).toBe(201);
  return r.json.id as string;
};

test.beforeAll(async ({ browser }) => {
  llm = await startFakeLlm();
  h = await bootTeamHarness({
    modelsJson: {
      fakellm: {
        baseUrl: llm.baseUrl,
        api: "openai-completions",
        apiKey: "fake-key",
        models: [{ id: "fake-model", name: "Fake", input: ["text"], contextWindow: 32000, maxTokens: 4096 }],
      },
    },
    homeFiles: {
      // F1: a skill in the instance's agent dir — `--no-skills` must keep it out of the prompt.
      ".pi/agent/skills/release-cut/SKILL.md": "---\nname: release-cut\ndescription: RELEASE-CUT-DESC-MK3 operator release notes\n---\nRelease cut body.\n",
    },
    team: ({ dir }) => {
      billingDir = dir("billing");
      const skills = dir("skills");
      reviewDir = path.join(skills, "review");
      fs.mkdirSync(path.join(reviewDir, "references"), { recursive: true });
      fs.writeFileSync(path.join(reviewDir, "SKILL.md"), "---\nname: review\ndescription: REVIEW-SKILL-DESC-MK1 team code review\n---\nReview body.\n");
      fs.writeFileSync(path.join(reviewDir, "references", "x.md"), "X-REF-CONTENT-MK2\n");
      fs.mkdirSync(path.join(skills, "release-cut"), { recursive: true });
      fs.writeFileSync(path.join(skills, "release-cut", "SKILL.md"), "---\nname: release-cut\ndescription: SIBLING-RELEASE-CUT-DESC\n---\nSibling body.\n");
      return { projects: { billing: { name: "Billing", path: billingDir, users: "*", contextFiles: false } } };
    },
  });
  // F1 leak vector: the stub `resources_discover` extension + the skill it leaks.
  const memoryDir = path.join(h.work, "memory-x");
  fs.mkdirSync(memoryDir, { recursive: true });
  fs.writeFileSync(path.join(memoryDir, "SKILL.md"), "---\nname: memory-x\ndescription: MEMORY-X-LEAK-DESC never granted\n---\nMemory body.\n");
  installLeakyExtension(h.inst.home, path.join(memoryDir, "SKILL.md"));

  anna = await h.signInViaApp(browser, "anna", "/apps/team/");
  // Managed catalog: review is allowed only in billing (widened by F5, narrowed by F4).
  const review = await h.api(anna, "POST", "/skills", { name: "review", path: reviewDir, users: "*", targets: ["billing"] });
  expect(review.status, JSON.stringify(review.json)).toBe(201);
  const chat = await h.api(anna, "POST", "/personas", {
    slug: "chat",
    scope: "shared",
    name: "Chat",
    description: "Skill access",
    instructions: "MARKER-PERSONA-SKILLS",
    tools: "files",
    model: "fakellm/fake-model",
    projects: ["billing"],
    skills: ["review"],
  });
  expect(chat.status, JSON.stringify(chat.json)).toBe(201);
});
test.afterAll(async () => {
  await h?.stop();
  await llm?.close();
});

test("F1: the provider prompt carries the granted skill only — no agent-dir skill, no extension-discovered skill", async () => {
  const convId = await newConversation("shared:chat");
  await openConversation("shared:chat", convId);
  await sendPrompt("PROMPT-SKILL-SET hi");
  await waitForTurns(1);
  const system = lastTurn().system;
  expect(system).toContain("REVIEW-SKILL-DESC-MK1"); // the granted skill's description is bound
  expect(system).not.toContain("RELEASE-CUT-DESC-MK3"); // agent-dir skill: excluded by --no-skills
  expect(system).not.toContain("MEMORY-X-LEAK-DESC"); // extension-discovered: the guard filter (D10)
  expect(system).toContain("MARKER-PERSONA-SKILLS"); // persona contribution survives
  expect(system).toMatch(/You are pi session `[^`]+`/); // bridge fragment survives
});

test("F2: a read inside the granted root works; a sibling skill read is refused with path_outside_root", async () => {
  const convId = await newConversation("shared:chat");
  await openConversation("shared:chat", convId);
  llm.script.push(
    { toolCall: { name: "read", args: { path: path.join(reviewDir, "references", "x.md") } } },
    { toolCall: { name: "read", args: { path: path.join(reviewDir, "..", "release-cut", "SKILL.md") } } },
    { text: "DONE-F2" },
  );
  await sendPrompt("PROMPT-F2 read things");
  await waitForTurns(3);
  const results = lastTurn().toolResults;
  expect(results[0]).toContain("X-REF-CONTENT-MK2"); // in-root read: real content
  expect(results.join("\n")).toContain("team: path_outside_root"); // sibling skill: refused
});

test("F3: a granted /skill: reaches the model as an envelope; an ungranted one never sends and the chat says so", async () => {
  const convId = await newConversation("shared:chat");
  await openConversation("shared:chat", convId);
  await sendPrompt("/skill:review check");
  await expect(anna.page.getByText("FAKE-REPLY").first()).toBeVisible({ timeout: 60_000 });
  await waitForTurns(1);
  expect(lastTurn().userTexts.some((t) => t.startsWith('<skill name="review"'))).toBe(true);

  const turns = llm.requests.length;
  const box = anna.page.locator('[data-testid="composer-input-row"] textarea');
  await box.fill("/skill:memory-x\nsummarise");
  await box.press("Enter");
  await expect(anna.page.getByText(/nem érhető el ennek az ügynöknek|not available to this agent/).first()).toBeVisible({ timeout: 10_000 });
  await expect(box).toHaveValue("/skill:memory-x\nsummarise"); // text kept
  await expect(box).toBeEnabled(); // settled — no 30 s spinner
  await new Promise((r) => setTimeout(r, 3_000));
  expect(llm.requests.length).toBe(turns); // no new model request
});

test("F5: widening the managed targets keeps every live session answering", async () => {
  f4ConvId = await newConversation("shared:chat");
  await openConversation("shared:chat", f4ConvId);
  const start = llm.requests.length;
  await sendPrompt("PROMPT-WIDEN-1");
  await waitForTurns(start + 1);
  await expect(anna.page.getByText("FAKE-REPLY").first()).toBeVisible({ timeout: 60_000 });

  const upd = await h.api(anna, "PATCH", "/skills/review", { targets: ["billing", "crm"] });
  expect(upd.status, JSON.stringify(upd.json)).toBe(200);
  await new Promise((r) => setTimeout(r, 6_000));
  expect((await billingSessions()).some((s) => s.status === "ended")).toBe(false); // widening ends nothing

  const replies = await anna.page.getByText("FAKE-REPLY").count();
  await sendPrompt("PROMPT-WIDEN-2");
  await waitForTurns(start + 2);
  await expect.poll(async () => anna.page.getByText("FAKE-REPLY").count(), { timeout: 60_000 }).toBeGreaterThan(replies);
});

test("F4: narrowing the targets ends the streaming session within 5 s; reopen is refused; the banner keeps the history readable", async () => {
  // Same live conversation (F5): hold the turn in the streaming state with a delayed reply.
  llm.script.push({ text: "SLOW-REPLY", delayMs: 30_000 });
  const before = llm.requests.length;
  await sendPrompt("PROMPT-REVOKED");
  await waitForTurns(before + 1); // the request is recorded on arrival, while the reply is held

  const upd = await h.api(anna, "PATCH", "/skills/review", { targets: ["crm"] });
  expect(upd.status, JSON.stringify(upd.json)).toBe(200);
  // Every session of the affected persona is ended within 5 s of the 2xx (decision C1).
  await expect.poll(async () => (await billingSessions()).every((s) => s.status === "ended"), { timeout: 5_000 }).toBe(true);

  // The record is kept: the conversation is still listed.
  const convs = (await h.api(anna, "GET", `/agents/${enc("shared:chat")}/conversations?project=billing`)).json.conversations;
  expect(convs.map((c: { id: string }) => c.id)).toContain(f4ConvId);
  // Reopening is refused with the reason.
  const reopen = await h.api(anna, "POST", `/agents/${enc("shared:chat")}/conversations/${f4ConvId}/session?project=billing`);
  expect(reopen.status, JSON.stringify(reopen.json)).toBe(409);
  expect(reopen.json).toMatchObject({ error: "skill_not_allowed", skill: "review", reason: "targets" });

  // UI: the reason-specific banner, and the history is still readable above the disabled composer.
  await expect(anna.page.getByText(/nem indítható|cannot start/i).first()).toBeVisible({ timeout: 15_000 });
  await expect(anna.page.getByText(/már nem engedélyezett|no longer allowed/i).first()).toBeVisible();
  await expect(anna.page.getByText("PROMPT-REVOKED").first()).toBeVisible();

  // Fresh page load (no mounted session, nothing spawned): the read-only history handle replays the transcript.
  const spawnedBefore = (await billingSessions()).length;
  await anna.page.goto(`${h.base}/apps/team/agent/${enc("shared:chat")}/c/${f4ConvId}?project=billing`);
  await expect(anna.page.getByText(/nem indítható|cannot start/i).first()).toBeVisible({ timeout: 30_000 });
  await expect(anna.page.getByText("PROMPT-REVOKED").first()).toBeVisible({ timeout: 15_000 });
  expect((await billingSessions()).length).toBe(spawnedBefore);
});

test("F6: an invalid skill path blocks the card before open; Fix skill opens the Skills-panel entry", async () => {
  // Valid at create, then the SKILL.md disappears → the path goes invalid.
  const legacyDir = path.join(path.dirname(reviewDir), "legacy");
  fs.mkdirSync(legacyDir, { recursive: true });
  fs.writeFileSync(path.join(legacyDir, "SKILL.md"), "---\nname: legacy\ndescription: LEGACY-DESC\n---\nLegacy body.\n");
  const created = await h.api(anna, "POST", "/skills", { name: "legacy", path: legacyDir, users: "*", targets: ["billing"] });
  expect(created.status, JSON.stringify(created.json)).toBe(201);
  const persona = await h.api(anna, "POST", "/personas", {
    slug: "blocked",
    scope: "shared",
    name: "Blocked",
    description: "Invalid path",
    instructions: "MARKER-BLOCKED",
    tools: "chat",
    model: "fakellm/fake-model",
    projects: ["billing"],
    skills: ["legacy"],
  });
  expect(persona.status, JSON.stringify(persona.json)).toBe(201);
  fs.rmSync(path.join(legacyDir, "SKILL.md"));

  await anna.page.goto(`${h.base}/apps/team/?project=billing`);
  const card = anna.page.locator('[data-key="shared:blocked"]');
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card.getByText(/útvonala érvénytelen|path of skill/i)).toBeVisible({ timeout: 15_000 });
  await expect(card.getByTestId("talk")).toHaveCount(0); // no chat button while blocked
  await card.getByTestId("fix-skill").click();
  await expect(anna.page).toHaveURL(/\/skills\/legacy/);
  await expect(anna.page.getByText("legacy").first()).toBeVisible();
});
