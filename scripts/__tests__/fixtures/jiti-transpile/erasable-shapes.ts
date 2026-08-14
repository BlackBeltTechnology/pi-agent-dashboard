// Erasable shapes: url (inlined to a literal), a called resolve and an uncalled
// resolve (both rewritten to `jitiESMResolve`). MUST NOT be reported.
export const url = import.meta.url;
export const called = import.meta.resolve("acorn");
export const uncalled = import.meta.resolve;
