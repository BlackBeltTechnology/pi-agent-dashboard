import { createInterface } from "node:readline";

/** Ask a yes/no question on the terminal. Only `y` / `yes` confirm; EOF before an answer declines. */
export function terminalConfirm(question: string, input: NodeJS.ReadableStream = process.stdin, output: NodeJS.WritableStream = process.stderr): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({ input, output });
    let answered = false;
    rl.question(question, (answer) => {
      answered = true;
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
    rl.on("close", () => {
      if (!answered) resolve(false);
    });
  });
}
