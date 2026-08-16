// One-off Phase 2 ingestion script — NOT part of the shipped app.
//
// Reads the raw Aetna Clinical Policy Bulletin (CPB 0325 — Physical Therapy)
// archived under policy-library/aetna/, extracts the "Policy" section (scope,
// medical necessity criteria, limitations/exclusions — deliberately not the
// CPT/HCPCS code table or the literature-review "Background" section, which
// are out of scope for this first pass), chunks it into paragraph-sized
// pieces, and writes them into the same SQLite database the running app
// uses, so `retrievePolicy()` has something real to query.
//
// Usage: node scripts/ingest-policy-aetna-pt.mjs
// Re-running is safe — it inserts a new policy_documents version rather than
// overwriting (see development.md, Phase 2 design: "versioning, not
// overwriting").
//
// Shared DB-writing plumbing lives in scripts/lib/policyIngestion.mjs as of
// Phase 6 (the first time there were two ingestion scripts to share it
// between) — everything below this point is Aetna-specific HTML parsing and
// heading detection, which stays bespoke on purpose.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { openDb, insertPolicyDocument } from "./lib/policyIngestion.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const RAW_HTML_PATH = join(REPO_ROOT, "policy-library", "aetna", "cpb-0325-physical-therapy.html");
const SOURCE_URL = "https://www.aetna.com/cpb/medical/data/300_399/0325.html";

function htmlToLines(html) {
  let text = html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "");
  text = text.replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6])\s*\/?>/gi, "\n");
  text = text.replace(/<[^>]+>/g, "");
  text = text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&rsquo;/g, "’")
    .replace(/&mdash;/g, "—");
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

function extractPolicySection(lines) {
  const startIdx = lines.findIndex((l) => l.startsWith("-->Policy"));
  const endIdx = lines.findIndex(
    (l, i) => i > startIdx && (l.startsWith("Table:") || l === "Applicable CPT / HCPCS / ICD-10 Codes"),
  );
  if (startIdx === -1 || endIdx === -1) {
    throw new Error("Could not find Policy section boundaries — page structure may have changed.");
  }
  return lines.slice(startIdx + 1, endIdx);
}

function extractEffectiveDate(lines) {
  const line = lines.find((l) => l.startsWith("Effective:"));
  const match = line && line.match(/Effective:\s*(\d{2}\/\d{2}\/\d{4})/);
  return match ? match[1] : null;
}

const html = readFileSync(RAW_HTML_PATH, "utf-8");
const lines = htmlToLines(html);
const policyLines = extractPolicySection(lines);
const effectiveDate = extractEffectiveDate(lines);

// Section headings within the Policy text — tracked, not discarded. The
// first version of this script dropped these as "too short to be real
// content," which silently stripped the covered-vs-not-covered context off
// every chunk. That's exactly how a Phase 3 generation cited "McConnell
// taping for knee pain... is covered" from a chunk that, with its heading
// intact, actually reads "Experimental, Investigational, or Unproven —
// McConnell taping for knee pain..." (Aetna does NOT consider it medically
// necessary). Prefixing every chunk with its section heading fixes the root
// cause instead of leaving it as a known limitation.
const KNOWN_HEADINGS = new Set([
  "Scope of Policy",
  "Medical Necessity",
  "Experimental, Investigational, or Unproven",
  "Policy Limitations and Exclusions",
  "Related Policies",
]);

let currentHeading = null;
const chunks = [];
for (const line of policyLines) {
  if (KNOWN_HEADINGS.has(line)) {
    currentHeading = line;
    continue;
  }
  if (line.length <= 40) continue; // stray short fragments, not real content
  chunks.push({
    heading: currentHeading,
    text: currentHeading ? `[${currentHeading}] ${line}` : line,
  });
}

const db = openDb();
const { documentId, chunkCount } = insertPolicyDocument(db, {
  payer: "Aetna",
  specialty: "Physical Therapy",
  title: "Physical Therapy — Clinical Policy Bulletin (Number: 0325)",
  sourceUrl: SOURCE_URL,
  effectiveDate,
  rawPath: "policy-library/aetna/cpb-0325-physical-therapy.html",
  chunks,
});

console.log(`Inserted policy_documents.id=${documentId} (effective ${effectiveDate}) with ${chunkCount} chunks.`);
db.close();
