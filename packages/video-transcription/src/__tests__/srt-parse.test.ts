import { describe, expect, it } from "vitest";
import {
  clusterCues,
  formatCueTime,
  hasNamedLabels,
  isAnonymousLabel,
  isSoundAnnotation,
  normalizeLabel,
  parseSrt,
  renderSrt,
} from "../srt-parse.js";

const LABELED = [
  "1",
  "00:00:01,000 --> 00:00:03,000",
  "[Speaker 1] Hello there.",
  "",
  "2",
  "00:00:03,500 --> 00:00:06,000",
  "[Speaker 2] Hi, how are you?",
  "",
  "3",
  "00:00:06,500 --> 00:00:09,000",
  "[Speaker 1] Fine, thanks.",
  "",
].join("\n");

describe("parseSrt", () => {
  it("parses a 3-cue fixture with labels", () => {
    const cues = parseSrt(LABELED);
    expect(cues).toHaveLength(3);
    expect(cues[0]).toMatchObject({
      index: "1",
      start: 1,
      end: 3,
      label: "Speaker 1",
      text: "Hello there.",
    });
    expect(cues[1].label).toBe("Speaker 2");
  });

  it("accepts both ',' and '.' millisecond separators", () => {
    const dot = LABELED.replace(/,(\d{3})/g, ".$1");
    expect(parseSrt(dot)).toEqual(parseSrt(LABELED));
  });

  it("strips a leading BOM", () => {
    expect(parseSrt(`\uFEFF${LABELED}`)).toEqual(parseSrt(LABELED));
  });

  it("treats a cue with no label as unlabeled, keeping the text", () => {
    const body = "1\n00:00:01,000 --> 00:00:02,000\nJust some text.\n";
    const [cue] = parseSrt(body);
    expect(cue.label).toBeUndefined();
    expect(cue.text).toBe("Just some text.");
  });

  it("tolerates a missing index line and blank-line noise", () => {
    const body =
      "\n\n00:00:01,000 --> 00:00:02,000\n[1] First.\n\n\n00:00:03,000 --> 00:00:04,000\n[2] Second.\n\n";
    const cues = parseSrt(body);
    expect(cues).toHaveLength(2);
    expect(cues[0].index).toBe("1");
    expect(cues[0].label).toBe("1");
    expect(cues[1].index).toBe("2");
  });

  it("round-trips timestamps, indices and text", () => {
    const cues = parseSrt(LABELED);
    expect(renderSrt(cues)).toBe(LABELED);
  });

  it("groups cues by label into clusters", () => {
    const groups = clusterCues(parseSrt(LABELED));
    expect(groups.get("1")).toHaveLength(2);
    expect(groups.get("2")).toHaveLength(1);
  });

  it("maps [Speaker 2] and bare [2] to the same cluster id", () => {
    expect(normalizeLabel("Speaker 2")).toBe("2");
    expect(normalizeLabel("2")).toBe("2");
    const groups = clusterCues(
      parseSrt(
        [
          "1",
          "00:00:01,000 --> 00:00:02,000",
          "[Speaker 2] A.",
          "",
          "2",
          "00:00:03,000 --> 00:00:04,000",
          "[2] B.",
          "",
        ].join("\n"),
      ),
    );
    expect(groups.get("2")).toHaveLength(2);
  });
});

describe("label taxonomy", () => {
  it("treats a non-speaker bracket as unlabeled but keeps the bracket", () => {
    const body = [
      "1",
      "00:00:01,000 --> 00:00:02,000",
      "[Speaker 1] Speaking.",
      "",
      "2",
      "00:00:02,000 --> 00:00:03,000",
      "[music] Playing.",
      "",
    ].join("\n");
    const cues = parseSrt(body);
    expect(cues[1].label).toBeUndefined();
    expect(cues[1].text).toBe("[music] Playing.");
    // the [music] cue forms no cluster and does not make the transcript named
    expect(clusterCues(cues).size).toBe(1);
    expect(hasNamedLabels(cues)).toBe(false);
  });

  it("classifies name/role labels as already-labeled", () => {
    for (const label of ["Alice", "Interviewer"]) {
      const cues = parseSrt(
        `1\n00:00:01,000 --> 00:00:02,000\n[${label}] Hi.\n`,
      );
      expect(cues[0].label).toBe(label);
      expect(hasNamedLabels(cues)).toBe(true);
    }
  });

  it("classifies anonymous labels", () => {
    expect(isAnonymousLabel("Speaker 1")).toBe(true);
    expect(isAnonymousLabel("12")).toBe(true);
    expect(isAnonymousLabel("Alice")).toBe(false);
    expect(isSoundAnnotation("music")).toBe(true);
    expect(isSoundAnnotation("inaudible")).toBe(true);
    expect(isSoundAnnotation("Alice")).toBe(false);
  });
});

describe("formatCueTime", () => {
  it("formats to HH:MM:SS,mmm", () => {
    expect(formatCueTime(3661.5)).toBe("01:01:01,500");
    expect(formatCueTime(0)).toBe("00:00:00,000");
  });
});
