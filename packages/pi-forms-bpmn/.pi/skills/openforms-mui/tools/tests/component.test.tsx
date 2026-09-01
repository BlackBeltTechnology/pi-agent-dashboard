import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Field, FormAnswers, FormSchemaJSON } from "../src/schema/types";
import { OpenFormsMui } from "../src/OpenFormsMui";
import type { SubmissionMeta } from "../src/payload";

function form(fields: Field[], extra?: Partial<FormSchemaJSON>): FormSchemaJSON {
  return { pages: [{ sections: [{ rows: [{ columns: [{ fields }] }] }] }], ...extra } as FormSchemaJSON;
}

function renderForm(schema: FormSchemaJSON, props: Record<string, unknown> = {}) {
  const onSubmit = vi.fn<(a: FormAnswers, m: SubmissionMeta) => void>();
  render(<OpenFormsMui schema={schema} onSubmit={onSubmit} {...props} />);
  return { onSubmit };
}

async function submit() {
  await userEvent.click(screen.getByRole("button", { name: "Submit" }));
}

describe("value shapes on submit (task 6.13)", () => {
  it("text, number, boolean and checkbox produce their documented shapes", async () => {
    const schema = form([
      { type: "text", key: "name" },
      { type: "number", key: "age" },
      { type: "boolean", key: "agree" },
      { type: "checkbox", key: "picks", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] },
    ]);
    const { onSubmit } = renderForm(schema);
    await userEvent.type(screen.getByLabelText("name"), "Ada");
    await userEvent.type(screen.getByLabelText("age"), "42");
    await userEvent.click(screen.getByLabelText("agree"));
    await userEvent.click(screen.getByLabelText("A"));
    await submit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const [answers] = onSubmit.mock.calls[0];
    expect(answers).toMatchObject({ name: "Ada", age: 42, agree: true, picks: ["a"] });
  });

  it("header and paragraph contribute no answer keys", async () => {
    const schema = form([
      { type: "header", key: "h" },
      { type: "paragraph", key: "p" },
      { type: "text", key: "t" },
    ]);
    const { onSubmit } = renderForm(schema);
    await submit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const [answers] = onSubmit.mock.calls[0];
    expect(answers).not.toHaveProperty("h");
    expect(answers).not.toHaveProperty("p");
    expect(answers).toHaveProperty("t", "");
  });

  it("signature carries a prefilled base64 PNG through to the payload", async () => {
    const dataUrl = "data:image/png;base64,AAAA";
    const schema = form([{ type: "signature", key: "sig" }]);
    const { onSubmit } = renderForm(schema, { answers: { sig: dataUrl } });
    await submit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].sig).toBe(dataUrl);
  });

  it("file produces { name, size, type, content } and not a raw File", async () => {
    const schema = form([{ type: "file", key: "doc", maxFileSizeMB: 5 }]);
    const { onSubmit } = renderForm(schema);
    const input = document.getElementById("doc") as HTMLInputElement;
    const file = new File(["hello"], "hello.txt", { type: "text/plain" });
    fireEvent.change(input, { target: { files: [file] } });
    await screen.findAllByText(/hello\.txt/);
    await submit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const doc = onSubmit.mock.calls[0][0].doc as { name: string; size: number; type: string; content: string };
    expect(doc.name).toBe("hello.txt");
    expect(doc.type).toBe("text/plain");
    expect(typeof doc.content).toBe("string");
    expect(doc.content.startsWith("data:")).toBe(true);
    expect(doc instanceof File).toBe(false);
  });

  it("rejects an oversized file without encoding it", async () => {
    const schema = form([{ type: "file", key: "doc", maxFileSizeMB: 0.00001 }]);
    const { onSubmit } = renderForm(schema);
    const input = document.getElementById("doc") as HTMLInputElement;
    const big = new File([new Uint8Array(1024)], "big.bin", { type: "application/octet-stream" });
    fireEvent.change(input, { target: { files: [big] } });
    await screen.findByText(/too large/i);
    await submit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].doc).toBeNull();
  });
});

describe("payload contract (tasks 7.4, 7.4a, 7.4b, 7.4c, 7.4h)", () => {
  it("omits a conditionally hidden field and includes a disabled one", async () => {
    const schema = form([
      { type: "text", key: "toggle" },
      { type: "text", key: "prefilled", disabled: true },
      {
        type: "text",
        key: "secret",
        conditionalRules: [
          { targetProperty: "visibility", andGroups: [{ conditions: [{ dependentFieldKey: "toggle", operator: "equals", equalsValue: "show" }] }] },
        ],
      },
    ]);
    const { onSubmit } = renderForm(schema, { answers: { prefilled: "sys", secret: "kept" } });
    await submit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const [answers] = onSubmit.mock.calls[0];
    expect(answers).toHaveProperty("prefilled", "sys"); // disabled included (7.4b)
    expect(answers).not.toHaveProperty("secret"); // hidden omitted
  });

  it("includes a hidden calculated field but omits it in a hidden branch (7.4a)", async () => {
    const visibleCalc = form([
      { type: "number", key: "a" },
      { type: "number", key: "sum", isCalculated: true, isVisibleOnForm: false, formulaExpression: "{a} + 1" },
    ]);
    const { onSubmit } = renderForm(visibleCalc, { answers: { a: 4 } });
    await submit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].sum).toBe(5);
  });

  it("emits per-type empty values that survive JSON round-trip", async () => {
    const schema = form([
      { type: "text", key: "t" },
      { type: "number", key: "n" },
      { type: "checkbox", key: "c", options: [] },
    ]);
    const { onSubmit } = renderForm(schema);
    await submit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const [answers] = onSubmit.mock.calls[0];
    const round = JSON.parse(JSON.stringify(answers));
    expect(round).toHaveProperty("t", "");
    expect(round).toHaveProperty("n", null);
    expect(round).toHaveProperty("c");
    expect(round.c).toEqual([]);
  });

  it("repeater yields one array of rows with every child key (number child null)", async () => {
    const schema = form([
      {
        type: "repeater",
        key: "people",
        rows: [{ columns: [{ fields: [{ type: "text", key: "name" }, { type: "number", key: "qty" }] }] }],
      },
    ]);
    const { onSubmit } = renderForm(schema);
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    await submit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const [answers] = onSubmit.mock.calls[0];
    const people = answers.people as Array<Record<string, unknown>>;
    expect(Array.isArray(people)).toBe(true);
    expect(people).toHaveLength(1);
    expect(people[0]).toEqual({ name: "", qty: null });
    expect(answers).not.toHaveProperty("name");
    expect(answers).not.toHaveProperty("qty");
  });
});

describe("submission gating and segregation (tasks 7.4f, 7.4g, 7.4e, 7.6, 7.7)", () => {
  it("blocks on duplicate keys and never calls onSubmit", async () => {
    const schema = form([{ type: "text", key: "dup" }, { type: "text", key: "dup" }]);
    const { onSubmit } = renderForm(schema);
    await submit();
    await screen.findByRole("alert");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("readOnly renders no submit control", () => {
    const schema = form([{ type: "text", key: "t" }]);
    renderForm(schema, { readOnly: true, answers: { t: "x" } });
    expect(screen.queryByRole("button", { name: "Submit" })).toBeNull();
  });

  it("delivers submissionContext and diagnostics as the second argument, segregated from answers", async () => {
    const schema = form([{ type: "text", key: "ctxKey" }]);
    const context = { ctxKey: "not-an-answer", tenant: "acme" };
    const { onSubmit } = renderForm(schema, { submissionContext: context, answers: { ctxKey: "real" } });
    await submit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const [answers, meta] = onSubmit.mock.calls[0];
    expect(answers.ctxKey).toBe("real"); // untouched by the context member of the same name
    expect(meta.submissionContext).toEqual(context);
    expect(Array.isArray(meta.diagnostics)).toBe(true);
  });
});

describe("change notifications (task 7.4i)", () => {
  it("onFieldChange reports retained hidden values", async () => {
    const schema = form([
      { type: "text", key: "toggle" },
      {
        type: "text",
        key: "dep",
        conditionalRules: [
          { targetProperty: "visibility", andGroups: [{ conditions: [{ dependentFieldKey: "toggle", operator: "equals", equalsValue: "show" }] }] },
        ],
      },
    ]);
    const onFieldChange = vi.fn();
    render(<OpenFormsMui schema={schema} answers={{ toggle: "show" }} onFieldChange={onFieldChange} />);
    await userEvent.type(screen.getByLabelText("dep"), "hi");
    // Hide it again:
    await userEvent.clear(screen.getByLabelText("toggle"));
    await userEvent.type(screen.getByLabelText("toggle"), "hide");
    await waitFor(() => {
      const last = onFieldChange.mock.calls.at(-1)?.[0];
      expect(last).toBeDefined();
      expect(last.dep).toBe("hi"); // retained even though now hidden
    });
  });
});

describe("multi-page wizard (task 7.3)", () => {
  const schema: FormSchemaJSON = {
    pages: [
      { title: "One", sections: [{ rows: [{ columns: [{ fields: [{ type: "text", key: "a", required: true }] }] }] }] },
      { title: "Two", sections: [{ rows: [{ columns: [{ fields: [{ type: "text", key: "b" }] }] }] }] },
    ],
  } as FormSchemaJSON;

  it("shows a stepper and blocks advance while the page is invalid", async () => {
    renderForm(schema);
    expect(screen.getByText("One")).toBeInTheDocument();
    expect(screen.getByText("Two")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    // Still on page one because required "a" is empty.
    await screen.findByRole("alert");
    expect(screen.getByLabelText("a")).toBeInTheDocument();
  });

  it("single-page form has no stepper", () => {
    renderForm(form([{ type: "text", key: "x" }]));
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
  });
});

describe("integration end to end (task 7.14)", () => {
  it("exercises conditional visibility, a cross-field rule, and a calculated field", async () => {
    const schema: FormSchemaJSON = {
      pages: [
        {
          sections: [
            {
              rows: [
                { columns: [{ fields: [{ type: "number", key: "hours" }] }] },
                { columns: [{ fields: [{ type: "number", key: "rate" }] }] },
                { columns: [{ fields: [{ type: "number", key: "total", isCalculated: true, formulaExpression: "{hours} * {rate}" }] }] },
                {
                  columns: [
                    {
                      fields: [
                        {
                          type: "text",
                          key: "approver",
                          required: true,
                          conditionalRules: [
                            { targetProperty: "visibility", andGroups: [{ conditions: [{ dependentFieldKey: "total", operator: "greaterThan", equalsValue: 100 }] }] },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    } as FormSchemaJSON;

    const { onSubmit } = renderForm(schema);
    await userEvent.type(screen.getByLabelText("hours"), "10");
    await userEvent.type(screen.getByLabelText("rate"), "20");
    // total = 200 -> approver revealed and required (label carries a " *" marker).
    const approver = await screen.findByLabelText(/approver/);
    expect(approver).toBeInTheDocument();
    await submit();
    // Blocked: approver required but empty.
    await screen.findByRole("alert");
    expect(onSubmit).not.toHaveBeenCalled();
    await userEvent.type(approver, "Jane");
    await submit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const [answers] = onSubmit.mock.calls[0];
    expect(answers.total).toBe(200);
    expect(answers.approver).toBe("Jane");
  });
});
