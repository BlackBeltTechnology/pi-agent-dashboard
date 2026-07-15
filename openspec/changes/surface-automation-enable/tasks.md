## 1. YAML flip helper (in-place, surgical)

- [ ] 1.1 Add a helper that reads `<cwd>/.pi/automation/<name>/automation.yaml`, sets/removes ONLY the `disabled` node via the `yaml` Document API, and writes it back atomically (tmp + rename), preserving comments and all other fields.
- [ ] 1.2 Add a strict automation-name validator (reject empty, path separators, `..`, NUL) and reuse the existing `badCwd` guard.
- [ ] 1.3 Return the resulting `enabled` state (negation of on-disk `disabled`) from the helper.

## 2. Flip route

- [ ] 2.1 Mount `POST /api/plugins/invoicebot/automation` accepting `{ cwd, name, enabled }`; validate `cwd` + `name` before any FS access.
- [ ] 2.2 Reject when the named `automation.yaml` does not exist (client error, create nothing).
- [ ] 2.3 On success call the flip helper and respond `{ ok, name, enabled }`.

## 3. Discovery route

- [ ] 3.1 Mount `GET /api/plugins/invoicebot/automation?cwd` that scans `<cwd>/.pi/automation/` for invoicebot schedule automations.
- [ ] 3.2 Respond `{ automations: [{ name, enabled }] }`, deriving `enabled` from each `disabled` field; tolerate 1 or 2 automations.

## 4. Tests (faux, zero-network)

- [ ] 4.1 Flip enable then disable → assert `disabled` field toggles and every other field + inline comment are byte-preserved.
- [ ] 4.2 Missing name and traversal name → client error, no file written/created.
- [ ] 4.3 Invalid/absent `cwd` → client error, no FS access.
- [ ] 4.4 Discovery lists correct `{ name, enabled }` for the two-automation and single-automation cases.
- [ ] 4.5 After a flip, the automation-plugin scheduler arms/disarms the trigger within the watcher debounce window (integration-style, using the existing watcher + scheduler).

## 5. Docs

- [ ] 5.1 Add the two new routes to the invoicebot-plugin `routes.ts` header comment and the package `server/AGENTS.md` file rows.
- [ ] 5.2 Note the documented `intake_paused` contradiction limitation where the routes are described.
