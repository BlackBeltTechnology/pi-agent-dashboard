/**
 * Model-driven team behaviour against a REAL dashboard + REAL pi, with a local fake
 * OpenAI-compatible provider that records every request (see fake-llm.ts).
 *
 *  F14   prompt round trip through the app; reload + reopen shows the earlier prompt and reply
 *  X5    the provider-bound prompt carries the persona + the bridge fragment, NOT the operator's
 *        agent-dir AGENTS.md
 *  D7    the guard really blocks: a write outside the root and a `bash` call come back as
 *        `team: …` tool errors, an in-root write succeeds
 *  X11   a project's `.pi/extensions` + `.pi/SYSTEM.md` never load (`--no-approve`); its root
 *        AGENTS.md is appended (contextFiles on)
 *  X12   a project's `.pi/settings.json` `sessionDir` cannot redirect team transcripts
 *
 * Needs the `pi` CLI on PATH. See change: add-team-plugin.
 */
import fs from "node:fs";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { type FakeLlm, startFakeLlm } from "./fake-llm.js";
import { bootTeamHarness, enc, hasPi, type TeamHarness, type User } from "./team-harness.js";

test.skip(!hasPi, "needs the pi CLI on PATH to spawn real sessions");
test.describe.configure({ mode: "serial", timeout: 180_000 });

let h: TeamHarness;
let llm: FakeLlm;
let anna: User;
let projectDir = "";

async function sendPrompt(page: Page, text: string): Promise<void> {
  const box = page.locator(".composer textarea").first();
  await expect(box).toBeEnabled({ timeout: 90_000 });
  await box.fill(text);
  await box.press("Enter");
}

const lastTurn = () => llm.requests[llm.requests.length - 1];
const waitForTurns = async (n: number) => expect.poll(() => llm.requests.length, { timeout: 60_000 }).toBeGreaterThanOrEqual(n);

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
    homeFiles: { ".pi/agent/AGENTS.md": "OPERATOR-SECRET: never visible to team agents\n" },
    team: ({ dir }) => {
      projectDir = dir("proj");
      fs.writeFileSync(path.join(projectDir, "AGENTS.md"), "PROJECT-AGENTS-MARKER\n");
      fs.mkdirSync(path.join(projectDir, ".pi", "extensions"), { recursive: true });
      fs.writeFileSync(path.join(projectDir, ".pi", "SYSTEM.md"), "PROJECT-SYSTEM override\n");
      fs.writeFileSync(path.join(projectDir, ".pi", "settings.json"), JSON.stringify({ sessionDir: "./.sessions" }));
      fs.writeFileSync(
        path.join(projectDir, ".pi", "extensions", "marker.ts"),
        'export default function (pi: any) { pi.registerTool({ name: "marker_tool", label: "m", description: "marker", parameters: { type: "object", properties: {} }, execute: async () => ({ content: [{ type: "text", text: "x" }] }) }); }\n',
      );
      return { projects: { proj: { name: "Proj", path: projectDir, users: "*", contextFiles: true } } };
    },
  });
  anna = await h.signInViaApp(browser, "anna", "/apps/team/");
  const created = await h.api(anna, "POST", "/personas", {
    slug: "llm",
    scope: "shared",
    name: "LLM",
    description: "Model-driven",
    instructions: "MARKER-PERSONA-INSTRUCTIONS",
    tools: "files",
    model: "fakellm/fake-model",
    projects: ["_ws", "proj"],
  });
  expect(created.status, JSON.stringify(created.json)).toBe(201);
});
test.afterAll(async () => {
  await h?.stop();
  await llm?.close();
});

test("F14 + X5: prompt round trip; provider prompt = persona + bridge fragment, no operator AGENTS.md; reload keeps the history", async () => {
  // Own workspace explicitly: the default start target is the first available project.
  await anna.page.goto(`${h.base}/apps/team/?project=_ws`);
  await anna.page.locator('[data-key="shared:llm"]').getByTestId("talk").click();
  await expect(anna.page).toHaveURL(/\/c\//, { timeout: 60_000 });
  await sendPrompt(anna.page, "PROMPT-ONE hello team");
  await expect(anna.page.getByText("FAKE-REPLY").first()).toBeVisible({ timeout: 60_000 });

  const turn = lastTurn();
  expect(turn.userTexts.join("\n")).toContain("PROMPT-ONE hello team");
  expect(turn.system).toContain("MARKER-PERSONA-INSTRUCTIONS");
  expect(turn.system).toMatch(/You are pi session `[^`]+`/); // bridge fragment survives (order-independent splice)
  expect(turn.system).not.toContain("OPERATOR-SECRET");

  const convId = (await h.api(anna, "GET", `/agents/${enc("shared:llm")}/conversations?project=_ws`)).json.conversations[0].id as string;
  await anna.page.reload();
  await expect(anna.page.getByText("PROMPT-ONE hello team").first()).toBeVisible({ timeout: 60_000 });
  await expect(anna.page.getByText("FAKE-REPLY").first()).toBeVisible();
  const after = (await h.api(anna, "GET", `/agents/${enc("shared:llm")}/conversations?project=_ws`)).json.conversations;
  expect(after.map((c: { id: string }) => c.id)).toEqual([convId]); // one conversation, same id
});

test("D7: the guard blocks a write outside the root and bash; an in-root write is allowed", async () => {
  const start = llm.requests.length;
  llm.script.push(
    { toolCall: { name: "write", args: { path: "/tmp/team-e2e-outside.txt", content: "evil" } } },
    { toolCall: { name: "bash", args: { command: "echo pwned" } } },
    { toolCall: { name: "write", args: { path: "inside.txt", content: "fine" } } },
    { text: "DONE-GUARD" },
  );
  await sendPrompt(anna.page, "PROMPT-GUARD do things");
  await waitForTurns(start + 4);
  const results = lastTurn().toolResults.join("\n");
  expect(results).toContain("team: path_outside_root");
  // `bash` is outside the `files` preset: pi's own `--tools` allowlist already drops it ("not found"); the
  // guard's name gate is the second wall (covers extension tools that ignore --tools). Either way it never ran.
  expect(results).toMatch(/team: tool_not_allowed|Tool bash not found/);
  expect(results).not.toContain("pwned");
  expect(fs.existsSync("/tmp/team-e2e-outside.txt")).toBe(false);
  const ws = fs.readdirSync(path.join(h.inst.home, ".pi", "dashboard", "team", "users"), { recursive: true }).map(String).find((f) => f.endsWith(path.join("workspace", "inside.txt")));
  expect(ws, "in-root write landed in the user's workspace").toBeTruthy();
});

test("D7: host-action prompts (`!cmd`, `/slash`) typed by the owner never run: the bridge refuses them in team sessions", async () => {
  const marker = "/tmp/team-e2e-bash-marker.txt";
  fs.rmSync(marker, { force: true });
  await anna.page.goto(`${h.base}/apps/team/?project=_ws`);
  await anna.page.locator('[data-key="shared:llm"]').getByTestId("talk").click();
  await expect(anna.page).toHaveURL(/\/c\//, { timeout: 60_000 });
  const turns = llm.requests.length;
  await sendPrompt(anna.page, `!echo BASH-RAN > ${marker}`);
  await new Promise((r) => setTimeout(r, 3_000));
  expect(fs.existsSync(marker)).toBe(false);
  await sendPrompt(anna.page, "/reload");
  await new Promise((r) => setTimeout(r, 2_000));
  expect(llm.requests.length).toBe(turns); // neither reached the model as a turn
  await sendPrompt(anna.page, "PROMPT-AFTER-REFUSED plain text still works");
  await waitForTurns(turns + 1);
  expect(lastTurn().userTexts.join("\n")).toContain("PROMPT-AFTER-REFUSED");
});

test("F16: after a persona edit + restart the next turn follows the new instructions and the transcript is intact", async () => {
  const convId = (await h.api(anna, "GET", `/agents/${enc("shared:llm")}/conversations?project=_ws`)).json.conversations[0].id as string;
  const upd = await h.api(anna, "PUT", `/personas/${enc("shared:llm")}`, {
    name: "LLM",
    description: "Model-driven",
    instructions: "MARKER-EDITED-INSTRUCTIONS",
    tools: "files",
    model: "fakellm/fake-model",
    projects: ["_ws", "proj"],
  });
  expect(upd.status).toBe(200);
  expect((await h.api(anna, "POST", `/agents/${enc("shared:llm")}/conversations/${convId}/restart?project=_ws`)).status).toBe(200);
  await anna.page.goto(`${h.base}/apps/team/agent/${enc("shared:llm")}/c/${convId}?project=_ws`);
  // Resumed transcript (virtualised: the newest rows render, so check a recent one; the whole history is
  // asserted below through what reaches the model).
  await expect(anna.page.getByText("PROMPT-GUARD do things").first()).toBeVisible({ timeout: 90_000 });
  const before = llm.requests.length;
  await sendPrompt(anna.page, "PROMPT-AFTER-EDIT");
  await waitForTurns(before + 1);
  expect(lastTurn().system).toContain("MARKER-EDITED-INSTRUCTIONS");
  expect(lastTurn().system).not.toContain("MARKER-PERSONA-INSTRUCTIONS");
  expect(lastTurn().userTexts.join("\n")).toContain("PROMPT-ONE hello team"); // same conversation history reaches the model
});

test("X9: a dashboard restart mid-conversation reconnects the socket without duplicating messages", async () => {
  const convId = (await h.api(anna, "GET", `/agents/${enc("shared:llm")}/conversations?project=_ws`)).json.conversations[0].id as string;
  await anna.page.goto(`${h.base}/apps/team/agent/${enc("shared:llm")}/c/${convId}?project=_ws`);
  const occurrences = (t: string) => anna.page.getByText(t, { exact: false }).count();
  await expect(anna.page.getByText("PROMPT-AFTER-EDIT").first()).toBeVisible({ timeout: 90_000 });
  const before = await occurrences("PROMPT-AFTER-EDIT");
  await h.inst.restart();
  await expect(anna.page.getByText("Újracsatlakozás").or(anna.page.getByText("PROMPT-AFTER-EDIT").first())).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => occurrences("PROMPT-AFTER-EDIT"), { timeout: 60_000 }).toBe(before);
  await expect(anna.page.locator(".composer textarea").first()).toBeEnabled({ timeout: 60_000 });
  expect(await occurrences("PROMPT-AFTER-EDIT")).toBe(before);
});

test("an ended conversation resumes after a dashboard restart (the host still vouches for the transcript's owner)", async () => {
  const convId = (await h.api(anna, "GET", `/agents/${enc("shared:llm")}/conversations?project=_ws`)).json.conversations[0].id as string;
  expect((await h.api(anna, "POST", `/agents/${enc("shared:llm")}/conversations/${convId}/restart?project=_ws`)).status).toBe(200);
  await h.inst.restart();
  const r = await h.api(anna, "POST", `/agents/${enc("shared:llm")}/conversations/${convId}/session?project=_ws`);
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  expect((await h.api(anna, "GET", `/agents/${enc("shared:llm")}/conversations?project=_ws`)).json.conversations.map((c: { id: string }) => c.id)).toEqual([convId]);
});

test("X11 + X12: project resources never load, root AGENTS.md is appended, transcripts stay in the default session folder", async () => {
  await anna.page.goto(`${h.base}/apps/team/?project=proj`);
  await anna.page.locator('[data-key="shared:llm"]').getByTestId("talk").click();
  await expect(anna.page).toHaveURL(/\/c\//, { timeout: 60_000 });
  const before = llm.requests.length;
  await sendPrompt(anna.page, "PROMPT-PROJECT hi");
  await waitForTurns(before + 1);
  const turn = lastTurn();
  expect(turn.userTexts.join("\n")).toContain("PROMPT-PROJECT hi");
  expect(turn.system).toContain("PROJECT-AGENTS-MARKER"); // contextFiles on: root AGENTS.md appended
  expect(turn.system).not.toContain("PROJECT-SYSTEM"); // .pi/SYSTEM.md not loaded
  expect(turn.toolNames).not.toContain("marker_tool"); // .pi/extensions not loaded
  const encoded = `--${projectDir.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
  await expect
    .poll(async () => (await h.sessions()).find((s) => s.cwd === projectDir)?.sessionFile ?? "", { timeout: 30_000 })
    .toContain(`${path.sep}${encoded}${path.sep}`);
  expect(fs.existsSync(path.join(projectDir, ".sessions"))).toBe(false); // project sessionDir did NOT redirect
});
