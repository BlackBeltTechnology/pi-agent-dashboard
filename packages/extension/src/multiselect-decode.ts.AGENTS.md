# multiselect-decode.ts — index

Pure helper decoding `PromptResponse` into `string[] | undefined`. Exports `decodeMultiselectAnswer`, `DecodableResponse`. Cancelled → undefined; empty answer → `[]`; unparseable JSON → `[]` (never throws). Separated from bridge for unit testing.
