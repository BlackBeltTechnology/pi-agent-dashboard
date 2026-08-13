// Fixture (a): the fails-closed proof. A TypeScript cast changes the member
// expression's `object.type` from `MetaProperty` to `TSAsExpression`, so jiti's
// erasure visitor never matches and raw `import.meta` survives into the CJS
// wrapper. MUST be reported by the gate.
const r = (import.meta as unknown as { resolve?: (s: string) => string }).resolve;
export const resolve = r;
