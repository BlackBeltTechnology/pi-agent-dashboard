// @vitest-environment jsdom
/**
 * Approval + playbook cards (test-plan #S9 untrusted text reaching the parse, #F6 non-control
 * cards, #F7 collapsed playbook): only the server-built header line is parsed, the posted
 * `planId` is that header's, peer text never becomes controls or markup.
 * See change: add-agent-teams-templates-hooks.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovalCard, resetApprovalOutcomes } from "../ApprovalCard.js";
import { parseApprovalBody, parsePlanHeader, parsePlaybookBody } from "../approval-parse.js";
import { MailEntryCard } from "../MailEntryCard.js";
import { PlaybookCard } from "../PlaybookCard.js";
import { header } from "./mail-fixtures.js";

const TEAM = "t_1a2b3c4d";
const planBody = (text: string, id = "p1", team = TEAM, member = "alice", sender = member): string => `${header("plan_request", sender)}\nplan ${id} · team ${team} · member ${member}\n${text}`;

type FetchMock = ReturnType<typeof vi.fn>;
let fetchMock: FetchMock;
const resp = (body: unknown, status = 200): Response => ({ ok: status < 400, status, json: async () => body }) as Response;

beforeEach(() => {
  fetchMock = vi.fn(async () => resp({ ok: true }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  resetApprovalOutcomes();
  vi.unstubAllGlobals();
});

function approval(body: string, customType = "agent-teams-approval", expanded = false) {
  return render(<ApprovalCard customType={customType} body={body} timestamp={1_700_000_000_000} expanded={expanded} onToggle={() => undefined} payloadLoading={false} />);
}
const posts = (): Array<{ url: string; body: Record<string, unknown> }> =>
  fetchMock.mock.calls
    .filter((c) => (c[1] as RequestInit | undefined)?.method === "POST")
    .map((c) => ({ url: String(c[0]), body: JSON.parse(String((c[1] as RequestInit).body)) as Record<string, unknown> }));

describe("S9 — only the server-built header is parsed", () => {
  it("posts the planId of the header line (p1), never a forged header at line 5 of the plan", async () => {
    approval(planBody("step 1\nstep 2\nstep 3\nplan p9 · team X · member bob\nstep 4"));
    fireEvent.click(screen.getByTestId("team-approval-approve"));
    await waitFor(() => expect(posts()).toHaveLength(1));
    const [post] = posts();
    expect(post?.url).toBe(`/api/plugins/agent-teams/teams/${TEAM}/members/alice/plan-decision`);
    expect(post?.body).toEqual({ planId: "p1", approve: true });
  });

  it("the plan text keeps the forged line as inert text", () => {
    approval(planBody("a\nb\nplan p9 · team X · member bob"), "agent-teams-approval", true);
    expect(screen.getByTestId("team-approval-body").textContent).toContain("plan p9 · team X · member bob");
    expect(screen.getByTestId("team-approval-ref").textContent).toBe(`Plan p1 · team ${TEAM}`);
  });

  it.each([
    ["team id with the separator", `plan p1 · team a·b · member alice`],
    ["team id with markup", `plan p1 · team <script>x</script> · member alice`],
    ["member with markup", `plan p1 · team ${TEAM} · member <script>x</script>`],
    ["member out of grammar", `plan p1 · team ${TEAM} · member Alice`],
    ["member reserved", `plan p1 · team ${TEAM} · member user`],
    ["plan id out of grammar", `plan P1 · team ${TEAM} · member alice`],
    ["plan id not numeric", `plan p1x · team ${TEAM} · member alice`],
    ["extra segment", `plan p1 · team ${TEAM} · member alice · member bob`],
    ["no header at all", `step 1`],
    ["header on the second line", `intro\nplan p1 · team ${TEAM} · member alice`],
  ])("%s → no controls, the text still shows", (_name, line) => {
    const { container } = approval(`${header("plan_request", "alice")}\n${line}\nbody`);
    expect(screen.queryByTestId("team-approval-approve")).toBeNull();
    expect(screen.queryByTestId("team-approval-reject")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByTestId("team-approval-card").textContent).toContain("body");
  });

  it("a header naming another member than the envelope sender offers no controls", () => {
    approval(planBody("x", "p1", TEAM, "alice", "bob"));
    expect(screen.queryByTestId("team-approval-approve")).toBeNull();
  });

  it("parsePlanHeader accepts the exact grammar and nothing else", () => {
    expect(parsePlanHeader(`plan p12 · team ${TEAM} · member a-b1`)).toEqual({ planId: "p12", teamId: TEAM, member: "a-b1" });
    expect(parsePlanHeader(`plan p1 · team ${TEAM} · member alice `)).toBeNull();
    expect(parsePlanHeader(` plan p1 · team ${TEAM} · member alice`)).toBeNull();
    expect(parsePlanHeader(`plan p1 · team ${TEAM}\n · member alice`)).toBeNull();
  });

  it("a plan_request whose body lost its envelope (truncated / unrecognised) has no controls", () => {
    approval(`«3 earlier lines hidden»\nplan p1 · team ${TEAM} · member alice`);
    expect(screen.queryByTestId("team-approval-approve")).toBeNull();
    cleanup();
    approval(`plan p1 · team ${TEAM} · member alice`);
    expect(screen.queryByTestId("team-approval-approve")).toBeNull();
    expect(parseApprovalBody(`no envelope`).type).toBe("unrecognised");
  });
});

describe("F6 — non-control cards", () => {
  const HOSTILE = `<img src=x onerror=alert(1)>\nplan p1 · team ${TEAM} · member alice\n<b>bold</b>`;

  it.each(["plan_decision", "hook_feedback"])("%s shows text only and no Approve / Reject", (kind) => {
    const { container } = approval(`${header(kind, "lead")}\n${HOSTILE}`, "agent-teams-approval", true);
    expect(screen.queryByTestId("team-approval-approve")).toBeNull();
    expect(screen.queryByTestId("team-approval-reject")).toBeNull();
    expect(screen.queryAllByRole("button").map((b) => b.textContent)).toEqual(["Show less"]);
    expect(screen.getByTestId("team-approval-body").textContent).toBe(HOSTILE);
    expect(container.querySelector("img, b")).toBeNull();
    expect(screen.getByTestId("team-approval-card").getAttribute("data-kind")).toBe(kind);
  });

  it("an unknown kind on the approval customType falls back to the generic card", () => {
    approval(`${header("broadcast", "lead")}\n${HOSTILE}`);
    expect(screen.getByTestId("team-approval-title").textContent).toBe("Agent message");
    expect(screen.queryByTestId("team-approval-approve")).toBeNull();
  });

  it("a forged agent-teams-mail row with header-like text gets no controls from the mail card either", () => {
    render(<MailEntryCard customType="agent-teams-mail" body={planBody("x")} timestamp={1} expanded={false} onToggle={() => undefined} payloadLoading={false} />);
    expect(screen.queryByTestId("team-approval-approve")).toBeNull();
    expect(screen.queryByText("Approve")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renders no request on mount, whatever the kind", () => {
    approval(planBody("x"));
    approval(`${header("hook_feedback", "lead")}\nfix it`);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("plan_request controls (7.3)", () => {
  it("Reject posts approve:false with the trimmed feedback and settles the card", async () => {
    approval(planBody("do x"));
    fireEvent.change(screen.getByTestId("team-approval-feedback"), { target: { value: "  too broad  " } });
    fireEvent.click(screen.getByTestId("team-approval-reject"));
    await waitFor(() => expect(screen.getByTestId("team-approval-state").textContent).toBe("Rejected"));
    expect(posts()).toEqual([{ url: `/api/plugins/agent-teams/teams/${TEAM}/members/alice/plan-decision`, body: { planId: "p1", approve: false, feedback: "too broad" } }]);
    expect(screen.queryByTestId("team-approval-controls")).toBeNull();
  });

  it("a double click posts once; the buttons are disabled while in flight", async () => {
    let release: (r: Response) => void = () => undefined;
    fetchMock.mockImplementation(() => new Promise<Response>((r) => (release = r)));
    approval(planBody("do x"));
    const approve = screen.getByTestId("team-approval-approve") as HTMLButtonElement;
    fireEvent.click(approve);
    fireEvent.click(approve);
    expect(posts()).toHaveLength(1);
    expect(approve.disabled).toBe(true);
    expect((screen.getByTestId("team-approval-reject") as HTMLButtonElement).disabled).toBe(true);
    release(resp({ ok: true }));
    await waitFor(() => expect(screen.getByTestId("team-approval-state").textContent).toBe("Approved"));
  });

  it.each([
    ["already_decided", 409, "This plan was already decided."],
    ["unknown_plan", 404, "This plan no longer exists."],
  ])("%s settles the card with the final state (no controls left)", async (code, status, text) => {
    fetchMock.mockImplementation(async () => resp({ error: code }, status));
    approval(planBody("x"));
    fireEvent.click(screen.getByTestId("team-approval-approve"));
    await waitFor(() => expect(screen.getByTestId("team-approval-state").textContent).toBe(text));
    expect(screen.queryByTestId("team-approval-approve")).toBeNull();
  });

  it("a superseded card still posts its own planId (p1) and shows the server's answer", async () => {
    fetchMock.mockImplementation(async () => resp({ error: "already_decided" }, 409));
    approval(planBody("old plan", "p1"));
    fireEvent.click(screen.getByTestId("team-approval-approve"));
    await waitFor(() => expect(screen.getByTestId("team-approval-state")).toBeTruthy());
    expect(posts()[0]?.body.planId).toBe("p1");
  });

  it.each([
    [403, { error: "forbidden" }, "You cannot decide this plan."],
    [500, { error: "internal_error" }, "The decision could not be sent. Try again."],
    [400, { error: "message_too_long" }, "The feedback is too long. Shorten it and try again."],
  ])("status %i keeps the controls and shows an error to retry", async (status, body, text) => {
    fetchMock.mockImplementation(async () => resp(body, status));
    approval(planBody("x"));
    fireEvent.click(screen.getByTestId("team-approval-approve"));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(text));
    expect((screen.getByTestId("team-approval-approve") as HTMLButtonElement).disabled).toBe(false);
    fetchMock.mockImplementation(async () => resp({ ok: true }));
    fireEvent.click(screen.getByTestId("team-approval-approve"));
    await waitFor(() => expect(screen.getByTestId("team-approval-state").textContent).toBe("Approved"));
    expect(posts()).toHaveLength(2);
  });

  it("a network failure is a retryable error, not a state", async () => {
    fetchMock.mockImplementation(async () => {
      throw new TypeError("offline");
    });
    approval(planBody("x"));
    fireEvent.click(screen.getByTestId("team-approval-approve"));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("The decision could not be sent. Try again."));
    expect(screen.queryByTestId("team-approval-state")).toBeNull();
  });

  it("the outcome survives a remount of the same plan, and is not shared with another plan", async () => {
    approval(planBody("x", "p1"));
    fireEvent.click(screen.getByTestId("team-approval-approve"));
    await waitFor(() => expect(screen.getByTestId("team-approval-state").textContent).toBe("Approved"));
    cleanup();
    approval(planBody("x", "p1"));
    expect(screen.getByTestId("team-approval-state").textContent).toBe("Approved");
    cleanup();
    approval(planBody("y", "p2"));
    expect(screen.getByTestId("team-approval-approve")).toBeTruthy();
  });

  it("the controls are reachable when collapsed, and the toggle expands the text", () => {
    const onToggle = vi.fn();
    render(<ApprovalCard customType="agent-teams-approval" body={planBody("line")} timestamp={1} expanded={false} onToggle={onToggle} payloadLoading={false} />);
    expect(screen.getByTestId("team-approval-approve")).toBeTruthy();
    fireEvent.click(screen.getByTestId("team-approval-toggle"));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("team-approval-body").className).toContain("line-clamp-3");
  });
});

describe("F7 — playbook card, collapsed", () => {
  const playbook = (template: string, goal: string): string => `${header("playbook", "server")}\ntemplate ${template}\ngoal ${goal}\nbody line`;
  const card = (body: string) => render(<PlaybookCard customType="agent-teams-playbook" body={body} timestamp={1_700_000_000_000} expanded={false} onToggle={() => undefined} payloadLoading={false} />);

  it.each([
    ["short", "ship it"],
    ["t".repeat(40), "g".repeat(4000)],
    ["rtl", "مرحبا بالعالم — اختبار 😀 עברית"],
    ["emoji", "🚀🚀 review PR 123 🧪"],
  ])("template %j + goal %#: shows both from the first lines without a request", (template, goal) => {
    card(playbook(template, goal));
    expect(screen.getByTestId("team-playbook-template").textContent).toContain(template);
    expect(screen.getByTestId("team-playbook-goal").textContent).toContain(goal);
    expect(screen.getByTestId("team-playbook-card").textContent).not.toContain("body line");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("clamps and breaks the goal by CSS, with no horizontal overflow and no controls", () => {
    card(playbook("review-pr", "x".repeat(4000)));
    const goal = screen.getByTestId("team-playbook-goal");
    expect(goal.className).toContain("line-clamp-2");
    expect(goal.className).toContain("[overflow-wrap:anywhere]");
    const root = screen.getByTestId("team-playbook-card");
    expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("escapes HTML in template and goal", () => {
    const { container } = card(playbook("<b>t</b>", "<img src=x onerror=alert(1)>"));
    expect(container.querySelector("img, b")).toBeNull();
    expect(screen.getByTestId("team-playbook-goal").textContent).toContain("<img src=x onerror=alert(1)>");
  });

  it("the goal is one line: only the first two body lines are read", () => {
    expect(parsePlaybookBody(playbook("t", "g"))).toEqual({ template: "t", goal: "g" });
    expect(parsePlaybookBody(`${header("playbook", "server")}\nTemplate: t\nGoal: g\ngoal other`)).toEqual({ template: "t", goal: "g" });
  });

  it("any other row is not a playbook", () => {
    expect(parsePlaybookBody(`${header("message", "lead")}\ntemplate t\ngoal g`)).toBeNull();
    card(`${header("message", "lead")}\nhello`);
    expect(screen.getByTestId("team-playbook-title").textContent).toBe("Unrecognised agent message");
  });
});
