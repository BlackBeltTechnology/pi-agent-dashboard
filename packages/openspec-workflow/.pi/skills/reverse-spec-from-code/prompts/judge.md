# Judge prompt (spec-vs-spec fitness)

The oracle is an EXISTING ground-truth spec, not the code. Use to score prompt or
model changes against a held-out set of real specs. Fill {PLACEHOLDERS}. Model: @research.

NOT part of the normal generate flow — `auditor.md` is the code-grounded runtime gate.
This is the offline fitness function behind `docs/research/reverse-spec-from-code.md`.

---

Compare a GENERATED OpenSpec spec against the REAL (ground-truth) spec for the
same capability. Both describe the same code. Judge by MEANING, not wording.

REAL spec:      {REAL_PATH}
GENERATED spec: {GEN_PATH}

Read both files. Then score how well the generated spec captures the same
behavioral contract as the real one.

Output STRICT JSON ONLY (no prose, no code fence), exactly these keys:
{
  "capability": "{CAPABILITY}",
  "requirement_coverage": <int 0-100, % of REAL requirements semantically present in GENERATED>,
  "scenario_coverage": <int 0-100, % of REAL scenarios' behaviors covered in GENERATED>,
  "hallucinated_requirements": ["<generated requirements with no basis in the real spec / not supported by code>"],
  "missing_requirements": ["<real requirements absent from generated>"],
  "format_compliance": <int 0-100, adherence to ## Purpose / ## Requirements / ### Requirement / #### Scenario + WHEN/THEN/AND>,
  "notes": "<2-3 sentence diagnosis of the single biggest gap>"
}
