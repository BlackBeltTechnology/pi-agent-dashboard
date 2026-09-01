/**
 * Purpose-written recursive-descent parser and evaluator for calculated-field
 * `formulaExpression` values.
 *
 * SECURITY: this module NEVER uses `eval`, `new Function`, or any other runtime
 * code-construction primitive. An untrusted schema therefore cannot execute
 * code — the grammar cannot express it. Any expression outside the grammar
 * evaluates to `0` and reports an error.
 *
 * Grammar:
 *   expr        := ternary
 *   ternary     := comparison ( "?" expr ":" expr )?
 *   comparison  := additive ( (">"|"<"|">="|"<="|"=="|"!=") additive )?
 *   additive    := multiplicative ( ("+"|"-") multiplicative )*
 *   multiplic.  := unary ( ("*"|"/"|"%") unary )*
 *   unary       := "-" unary | primary
 *   primary     := number | "{" fieldKey "}" | "(" expr ")" | funcCall
 *   funcCall    := "Math" "." ("min"|"max"|"round"|"abs"|"floor"|"ceil") "(" args ")"
 */

export interface FormulaResult {
  value: number;
  error?: string;
}

type Tok =
  | { t: "num"; v: number }
  | { t: "ref"; v: string }
  | { t: "op"; v: string }
  | { t: "fn"; v: string }
  | { t: "punc"; v: string };

const ALLOWED_FUNCS = new Set(["min", "max", "round", "abs", "floor", "ceil"]);

function tokenize(input: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  const s = input;
  while (i < s.length) {
    const c = s[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
      continue;
    }
    // {fieldKey}
    if (c === "{") {
      const end = s.indexOf("}", i);
      if (end === -1) throw new Error("unterminated field reference");
      const key = s.slice(i + 1, end).trim();
      if (key.length === 0) throw new Error("empty field reference");
      toks.push({ t: "ref", v: key });
      i = end + 1;
      continue;
    }
    // number (integer or decimal)
    if ((c >= "0" && c <= "9") || (c === "." && s[i + 1] >= "0" && s[i + 1] <= "9")) {
      let j = i;
      while (j < s.length && ((s[j] >= "0" && s[j] <= "9") || s[j] === ".")) j++;
      const numStr = s.slice(i, j);
      const num = Number(numStr);
      if (!Number.isFinite(num)) throw new Error(`invalid number "${numStr}"`);
      toks.push({ t: "num", v: num });
      i = j;
      continue;
    }
    // Math.func
    if (c === "M" && s.slice(i, i + 5) === "Math.") {
      let j = i + 5;
      while (j < s.length && /[a-zA-Z]/.test(s[j])) j++;
      const fn = s.slice(i + 5, j);
      if (!ALLOWED_FUNCS.has(fn)) throw new Error(`unsupported function "Math.${fn}"`);
      toks.push({ t: "fn", v: fn });
      i = j;
      continue;
    }
    // multi-char operators
    const two = s.slice(i, i + 2);
    if (two === ">=" || two === "<=" || two === "==" || two === "!=") {
      toks.push({ t: "op", v: two });
      i += 2;
      continue;
    }
    if ("+-*/%<>?:".includes(c)) {
      toks.push({ t: "op", v: c });
      i++;
      continue;
    }
    if ("()".includes(c)) {
      toks.push({ t: "punc", v: c });
      i++;
      continue;
    }
    if (c === ",") {
      toks.push({ t: "punc", v: "," });
      i++;
      continue;
    }
    throw new Error(`unexpected character "${c}"`);
  }
  return toks;
}

class Parser {
  private pos = 0;
  constructor(
    private readonly toks: Tok[],
    private readonly refs: (key: string) => number,
  ) {}

  parse(): number {
    const v = this.expr();
    if (this.pos < this.toks.length) throw new Error("trailing tokens");
    return v;
  }

  private peek(): Tok | undefined {
    return this.toks[this.pos];
  }
  private next(): Tok {
    const t = this.toks[this.pos];
    if (!t) throw new Error("unexpected end of expression");
    this.pos++;
    return t;
  }
  private eatOp(v: string): boolean {
    const t = this.peek();
    if (t && t.t === "op" && t.v === v) {
      this.pos++;
      return true;
    }
    return false;
  }
  private eatPunc(v: string): boolean {
    const t = this.peek();
    if (t && t.t === "punc" && t.v === v) {
      this.pos++;
      return true;
    }
    return false;
  }

  private expr(): number {
    return this.ternary();
  }

  private ternary(): number {
    const cond = this.comparison();
    if (this.eatOp("?")) {
      const whenTrue = this.expr();
      if (!this.eatOp(":")) throw new Error('expected ":" in ternary');
      const whenFalse = this.expr();
      return cond !== 0 ? whenTrue : whenFalse;
    }
    return cond;
  }

  private comparison(): number {
    let left = this.additive();
    const t = this.peek();
    if (t && t.t === "op" && [">", "<", ">=", "<=", "==", "!="].includes(t.v)) {
      this.pos++;
      const right = this.additive();
      switch (t.v) {
        case ">":
          left = left > right ? 1 : 0;
          break;
        case "<":
          left = left < right ? 1 : 0;
          break;
        case ">=":
          left = left >= right ? 1 : 0;
          break;
        case "<=":
          left = left <= right ? 1 : 0;
          break;
        case "==":
          left = left === right ? 1 : 0;
          break;
        case "!=":
          left = left !== right ? 1 : 0;
          break;
      }
    }
    return left;
  }

  private additive(): number {
    let left = this.multiplicative();
    for (;;) {
      if (this.eatOp("+")) left += this.multiplicative();
      else if (this.eatOp("-")) left -= this.multiplicative();
      else break;
    }
    return left;
  }

  private multiplicative(): number {
    let left = this.unary();
    for (;;) {
      if (this.eatOp("*")) left *= this.unary();
      else if (this.eatOp("/")) {
        const d = this.unary();
        left = d === 0 ? 0 : left / d;
      } else if (this.eatOp("%")) {
        const d = this.unary();
        left = d === 0 ? 0 : left % d;
      } else break;
    }
    return left;
  }

  private unary(): number {
    if (this.eatOp("-")) return -this.unary();
    if (this.eatOp("+")) return this.unary();
    return this.primary();
  }

  private primary(): number {
    const t = this.next();
    if (t.t === "num") return t.v;
    if (t.t === "ref") {
      const v = this.refs(t.v);
      return Number.isFinite(v) ? v : 0;
    }
    if (t.t === "punc" && t.v === "(") {
      const v = this.expr();
      if (!this.eatPunc(")")) throw new Error('expected ")"');
      return v;
    }
    if (t.t === "fn") {
      if (!this.eatPunc("(")) throw new Error(`expected "(" after Math.${t.v}`);
      const args: number[] = [];
      if (!this.eatPunc(")")) {
        args.push(this.expr());
        while (this.eatPunc(",")) args.push(this.expr());
        if (!this.eatPunc(")")) throw new Error('expected ")" closing function call');
      }
      return applyFunc(t.v, args);
    }
    throw new Error("expected a value");
  }
}

function applyFunc(fn: string, args: number[]): number {
  switch (fn) {
    case "min":
      return args.length ? Math.min(...args) : 0;
    case "max":
      return args.length ? Math.max(...args) : 0;
    case "round":
      return Math.round(args[0] ?? 0);
    case "abs":
      return Math.abs(args[0] ?? 0);
    case "floor":
      return Math.floor(args[0] ?? 0);
    case "ceil":
      return Math.ceil(args[0] ?? 0);
    default:
      throw new Error(`unsupported function "${fn}"`);
  }
}

/**
 * Evaluate a formula against a resolver for `{fieldKey}` references.
 * Any grammar violation returns `{ value: 0, error }`.
 */
export function evaluateFormula(
  expression: string,
  resolveRef: (key: string) => number,
): FormulaResult {
  try {
    const toks = tokenize(expression);
    const value = new Parser(toks, resolveRef).parse();
    if (!Number.isFinite(value)) return { value: 0, error: "non-finite result" };
    return { value };
  } catch (e) {
    return { value: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Parse-only check used by diagnostics; returns an error string or null. */
export function checkFormulaParses(expression: string): string | null {
  const result = evaluateFormula(expression, () => 0);
  return result.error ?? null;
}
