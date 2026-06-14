# Tasks

## 1. Stepper rendering
- [ ] 1.1 In `OpenSpecStepper.tsx` `renderContent`, gate the `mdiCheck` branch for letter-bearing nodes on `!isCompact`: a done node renders the check only when it has no letter, OR it has a letter and the variant is `sidebar`. A done letter node in `compact` falls through to the existing letter branch (already green via `colorClass`).
- [ ] 1.2 Remove the false "per design.md §6" attribution from the `renderContent` comment; replace with a one-line note that compact-done artifact nodes keep their letter for identity.

## 2. Tests
- [ ] 2.1 `OpenSpecStepper.test.tsx`: sidebar done artifact node renders mdi-check (svg, no letter span).
- [ ] 2.2 `OpenSpecStepper.test.tsx`: compact done artifact nodes (`P`/`D`/`S`) render their letter span, not the check.
- [ ] 2.3 `OpenSpecStepper.test.tsx`: compact done non-artifact nodes (`Explore`, `Apply`) render the mdi-check.

## 3. Verify
- [ ] 3.1 `npm test 2>&1 | tee /tmp/pi-test.log` — stepper suite green.
- [ ] 3.2 `npm run build` + restart; open the OpenSpec board, confirm done artifact nodes show letters and the sidebar card stepper still shows checks.
