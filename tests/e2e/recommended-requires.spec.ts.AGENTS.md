# recommended-requires.spec.ts — index

Playwright E2E for recommended-extension `requires` probe (change: align-pi-080-and-publish-baseline-packages, Piece A). Opens Settings → Packages → PackageBrowser → RecommendedExtensions; asserts `recommended-requires-pi-agent-browser` badge visible + contains `agent-browser` (declared `requires.binaries`). Asserts `recommended-requires-pi-web-access` absent (no `requires` declaration). Uses `gotoDashboard`, `byTestId`. State-not-asserted: satisfied vs missing is environment-bound.
