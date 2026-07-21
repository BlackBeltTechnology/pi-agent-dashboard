# prompt-answer-encoder.ts — index

Pure helper encoding interactive renderer `result` → `answer` string for PromptBus `prompt_response`. Exports `encodePromptAnswer(result, cancelled)`. Precedence: cancellation→undefined, `answers[]`→JSON, `values[]`→JSON (multiselect), `value`→string, `confirmed`→"true"/"false", fallback `String(result)`. Empty multiselect (`"[]"`) distinct from cancellation (`undefined`). See change: fix-multiselect-auto-cancel-on-dashboard.
