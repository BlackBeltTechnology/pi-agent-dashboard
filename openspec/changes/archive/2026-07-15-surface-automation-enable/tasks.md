## 1. YAML flip helper (in-place, surgical)

- [x] 1.1 Add a helper that reads `<cwd>/.pi/automation/<name>/automation.yaml`, sets/removes ONLY the `disabled` node via the `yaml` Document API, and writes it back atomically (tmp + rename), preserving comments and all other fields.
- [x] 1.2 Add a strict automation-name validator (reject empty, path separators, `..`, NUL) and reuse the existing `badCwd` guard.
- [x] 1.3 Return the resulting `enabled` state (negation of on-disk `disabled`) from the helper.

## 2. Flip route

- [x] 2.1 Mount `POST /api/plugins/invoicebot/automation` accepting `{ cwd, name, enabled }`; validate `cwd` + `name` before any FS access.
- [x] 2.2 Reject when the named `automation.yaml` does not exist (client error, create nothing).
- [x] 2.3 On success call the flip helper and respond `{ ok, name, enabled }`.

## 3. Discovery route

- [x] 3.1 Mount `GET /api/plugins/invoicebot/automation?cwd` that scans `<cwd>/.pi/automation/` for invoicebot schedule automations.
- [x] 3.2 Respond `{ automations: [{ name, enabled }] }`, deriving `enabled` from each `disabled` field; tolerate 1 or 2 automations.

## 4. Tests (faux, zero-network)

- [x] 4.1 Flip enable then disable → assert `disabled` field toggles and every other field + inline comment are byte-preserved.
- [x] 4.2 Missing name and traversal name → client error, no file written/created.
- [x] 4.3 Invalid/absent `cwd` → client error, no FS access.
- [x] 4.4 Discovery lists correct `{ name, enabled }` for the two-automation and single-automation cases.
- [x] 4.5 After a flip, the automation-plugin scheduler arms/disarms the trigger within the watcher debounce window (integration-style, using the existing watcher + scheduler).

## 5. Docs

- [x] 5.1 Add the two new routes to the invoicebot-plugin `routes.ts` header comment and the package `server/AGENTS.md` file rows.
- [x] 5.2 Note the documented `intake_paused` contradiction limitation where the routes are described.
