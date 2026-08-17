// Phase 8 — PHI pre-commit hook (development.md, spec §11: "a hard, enforced
// rule... rather than a norm people are trusted to remember").
//
// This is a heuristic, not a semantic PHI detector — same honest framing as
// looks_like_refusal() in src-tauri/src/lib.rs: it will not catch every real
// PHI leak, but it catches the obvious, common-shaped cases (SSNs, labeled
// MRN/DOB fields) and blocks the commit with a clear message, which is
// meaningfully better than the current state (a norm nobody's checking).
// Every fixture in this repo today is synthetic on purpose — this hook is
// what keeps that true once someone other than the original author is
// committing.
//
// Wired via .githooks/pre-commit (see CONTRIBUTING.md for the one-time
// `git config core.hooksPath .githooks` setup — git does not track or
// install hooks automatically).

import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";

// Only flags patterns shaped like real PHI markers — deliberately narrow to
// avoid false-positiving on this project's own synthetic clinical fixtures
// (e.g. "Rotator cuff tendinopathy, outpatient PT referral" contains no
// digits-as-identifiers shape at all).
const PHI_PATTERNS = [
  { name: "SSN-shaped string", regex: /\b\d{3}-\d{2}-\d{4}\b/ },
  { name: "labeled MRN field", regex: /\bMRN\s*[:#]\s*\S+/i },
  {
    name: "labeled DOB field",
    regex: /\b(?:DOB|Date of Birth)\s*[:#]\s*\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/i,
  },
  { name: "labeled SSN field", regex: /\b(?:SSN|Social Security(?:\s+Number)?)\s*[:#]?\s*\d{3}/i },
];

// Parses a unified diff (`git diff --cached -U0`) and returns only the
// added lines, tagged with their source file — a removed or context line
// containing a PHI-shaped pattern isn't new content this commit is
// introducing, so it shouldn't block the commit.
export function addedLines(diffText) {
  const result = [];
  let currentFile = null;
  for (const line of diffText.split("\n")) {
    if (line.startsWith("+++ ")) {
      currentFile = line.slice(4).replace(/^b\//, "");
      continue;
    }
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) {
      result.push({ file: currentFile ?? "(unknown file)", text: line.slice(1) });
    }
  }
  return result;
}

export function scanForPhiPatterns(diffText) {
  const findings = [];
  for (const { file, text } of addedLines(diffText)) {
    for (const pattern of PHI_PATTERNS) {
      const match = text.match(pattern.regex);
      if (match) {
        findings.push({ file, pattern: pattern.name, snippet: match[0] });
      }
    }
  }
  return findings;
}

function main() {
  const diff = execSync("git diff --cached -U0 --no-color", { encoding: "utf8" });
  const findings = scanForPhiPatterns(diff);

  if (findings.length === 0) {
    process.exit(0);
  }

  console.error("Commit blocked — PHI-shaped pattern(s) found in staged changes:\n");
  for (const f of findings) {
    console.error(`  ${f.file} — ${f.pattern}: "${f.snippet}"`);
  }
  console.error(
    "\nThis repo never commits real patient/PHI data — every fixture must be synthetic " +
      "(see CONTRIBUTING.md). If this is a false positive (e.g. a synthetic test value that " +
      "happens to match one of these shapes), rework the fixture so it doesn't look like real " +
      "PHI, or in a genuine edge case, skip this hook deliberately with `git commit --no-verify` " +
      "and say why in the PR description.",
  );
  process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
