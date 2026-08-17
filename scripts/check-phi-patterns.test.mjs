import { describe, expect, it } from "vitest";
import { addedLines, scanForPhiPatterns } from "./check-phi-patterns.mjs";

// Regression proof this hook actually has teeth (same discipline as the
// network-audit script's deliberately-introduced-then-reverted test) — a
// real SSN-shaped string in a real diff shape must be caught, and this
// project's own synthetic fixtures must not be flagged.

function diff(fileA, addedTextA) {
  return [
    `diff --git a/${fileA} b/${fileA}`,
    `index 000..111 100644`,
    `--- a/${fileA}`,
    `+++ b/${fileA}`,
    `@@ -0,0 +1 @@`,
    `+${addedTextA}`,
  ].join("\n");
}

describe("addedLines", () => {
  it("only returns lines that start with a single +, not the +++ file header", () => {
    const lines = addedLines(diff("src/cases.test.ts", "const patient = 'Jane Doe';"));
    expect(lines).toEqual([{ file: "src/cases.test.ts", text: "const patient = 'Jane Doe';" }]);
  });

  it("ignores removed and context lines", () => {
    const d = ["--- a/x.ts", "+++ b/x.ts", "@@ -1,1 +1,1 @@", "-old line with 123-45-6789", "+new line"].join(
      "\n",
    );
    expect(addedLines(d)).toEqual([{ file: "x.ts", text: "new line" }]);
  });
});

describe("scanForPhiPatterns", () => {
  it("blocks a commit adding an SSN-shaped string", () => {
    const findings = scanForPhiPatterns(diff("fixtures/patient.txt", "SSN on file: 123-45-6789"));
    expect(findings).toHaveLength(1);
    expect(findings[0].pattern).toBe("SSN-shaped string");
  });

  it("blocks a labeled MRN field", () => {
    const findings = scanForPhiPatterns(diff("notes.txt", "MRN: 00482913"));
    expect(findings.some((f) => f.pattern === "labeled MRN field")).toBe(true);
  });

  it("blocks a labeled DOB field", () => {
    const findings = scanForPhiPatterns(diff("notes.txt", "DOB: 04/12/1978"));
    expect(findings.some((f) => f.pattern === "labeled DOB field")).toBe(true);
  });

  it("does not flag this project's own synthetic clinical fixtures", () => {
    const findings = scanForPhiPatterns(
      diff(
        "src/cases.test.ts",
        "patientSummary: 'Rotator cuff tendinopathy, outpatient PT referral'",
      ),
    );
    expect(findings).toHaveLength(0);
  });

  it("does not flag an unrelated numeric string that isn't SSN-shaped", () => {
    const findings = scanForPhiPatterns(diff("src/db.ts", "const responseWindowDays = 14-30-2026;"));
    expect(findings).toHaveLength(0);
  });
});
