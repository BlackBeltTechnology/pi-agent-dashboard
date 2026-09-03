/**
 * UI string dictionary contract for the component's own chrome (buttons,
 * markers, notices). Distinct from the schema's `translations`, which localizes
 * author-supplied content (labels, options, rule messages).
 */
export interface UiDictionary {
  required: string;
  optional: string;
  requiredMarker: string;
  allFieldsRequired: string;
  optionalHint: string;
  next: string;
  previous: string;
  submit: string;
  addItem: string;
  removeItem: string;
  clear: string;
  errorSummaryTitle: string;
  computedValue: string;
  computedHint: string;
  disabledHint: string;
  apiUnsupported: string;
  fileTooLarge: (limitMb: number) => string;
  fileTypeRejected: (accepted: string) => string;
  revealedAnnouncement: (label: string) => string;
  revealedReason: string;
  noOptions: string;
  matrixRowLabel: string;
  selectPlaceholder: string;
  formLevelErrors: string;
}

export const en: UiDictionary = {
  required: "Required",
  optional: "Optional",
  requiredMarker: "*",
  allFieldsRequired: "All fields on this form are required.",
  optionalHint: "Fields marked optional may be left blank.",
  next: "Next",
  previous: "Back",
  submit: "Submit",
  addItem: "Add",
  removeItem: "Remove",
  clear: "Clear",
  errorSummaryTitle: "There is a problem",
  computedValue: "Computed value",
  computedHint: "This value is calculated automatically and cannot be edited.",
  disabledHint: "This field is read-only.",
  apiUnsupported: "Remote option loading is not supported; this field is disabled.",
  fileTooLarge: (limitMb) => `File is too large. The maximum size is ${limitMb} MB.`,
  fileTypeRejected: (accepted) => `This file type is not allowed. Accepted types: ${accepted}.`,
  revealedAnnouncement: (label) => `${label} is now shown.`,
  revealedReason: "Shown because of your previous answers.",
  noOptions: "No options available.",
  matrixRowLabel: "Row",
  selectPlaceholder: "Select…",
  formLevelErrors: "Please review the following before continuing:",
};
