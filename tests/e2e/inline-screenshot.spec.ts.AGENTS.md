# inline-screenshot.spec.ts — index

Playwright E2E for inline agent screenshot artifacts (change: inline-agent-screenshot-artifacts, automates task 4.2). `[[faux:tool-screenshot]]` runs real `bash` writing a PNG + echoing `Screenshot saved: <path>`; bridge `inlineToolResultImages` attaches `type:"image"` block at `tool_execution_end` and strips consumed path (D5). Asserts inline `data:image/png;base64,` `<img>` visible + auto-expanded, and no exact-path FileLink renders. Imports `SCREENSHOT_INLINE` from `qa/fixtures/faux-scenarios.js`.
