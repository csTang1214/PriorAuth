// Phase 6 ingestion script — NOT part of the shipped app.
//
// Reads the raw Cigna Coverage Policy Guideline (CPG 135 — Physical Therapy)
// archived under policy-library/cigna/, extracts the "GUIDELINES" section
// (medical necessity criteria — deliberately not the CPT coding tables or
// literature references that follow it, same scoping call Phase 2 made for
// Aetna), chunks it, and writes it into the same SQLite database the running
// app uses, so `retrievePolicy()` has something real to query for Cigna too.
//
// Usage: node scripts/ingest-policy-cigna-pt.mjs
// Re-running is safe — it inserts a new policy_documents version rather than
// overwriting (see development.md, Phase 2 design: "versioning, not
// overwriting").
//
// This is a PDF source, unlike Aetna's HTML page — the first real test of
// whether the pipeline generalizes across source formats (see development.md's
// Phase 6 design notes). Two concrete differences from the Aetna script that
// PDF extraction forces, confirmed by actually running it before writing this:
//   1. A single logical bullet/sentence wraps across multiple physical PDF
//      lines, unlike Aetna's semantic HTML — chunking has to join lines into
//      blank-line-delimited paragraphs first, not treat every non-blank line
//      as its own chunk.
//   2. Every page repeats a running header ("Physical Therapy (CPG 135)")
//      and footer ("Page N of 44") inline in the extracted text — boilerplate
//      HTML extraction never produced, and it has to be stripped before
//      paragraph-joining or it corrupts whatever paragraph it lands inside.
//
// Structure is two-level, unlike Aetna's flat heading list: a SUBSECTION
// ("Rehabilitative Physical Therapy Services" / "Habilitative Physical
// Therapy Services") each containing the same four POLARITY headings
// ("Medically Necessary" / "Not Medically Necessary" / "Experimental,
// Investigational, Unproven" / "Not Covered or Reimbursable"). This is
// exactly the kind of covered-vs-not-covered adjacency that caused the
// Phase 3 McConnell-taping grounding bug for Aetna — both heading levels are
// tracked and prefixed onto every chunk so it can't recur here.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { openDb, insertPolicyDocument } from "./lib/policyIngestion.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const RAW_PDF_PATH = join(REPO_ROOT, "policy-library", "cigna", "cpg135-physical-therapy.pdf");
const SOURCE_URL = "https://static.cigna.com/assets/chcp/pdf/coveragePolicies/medical/cpg135_physical_therapy.pdf";

const PAGE_HEADER = "Physical Therapy (CPG 135)";
const PAGE_FOOTER = /^Page \d+ of\s*44$/;

const SUBSECTIONS = new Set([
  "Rehabilitative Physical Therapy Services",
  "Habilitative Physical Therapy Services",
]);
const POLARITY_HEADINGS = new Set([
  "Medically Necessary",
  "Not Medically Necessary",
  "Experimental, Investigational, Unproven",
  "Not Covered or Reimbursable",
]);

function extractEffectiveDate(text) {
  const match = text.match(/Effective Date:\s*(\d{2}\/\d{2}\/\d{4})/);
  return match ? match[1] : null;
}

function extractGuidelinesSection(text) {
  const startIdx = text.indexOf("GUIDELINES");
  const endIdx = text.indexOf("Coding Information", startIdx);
  if (startIdx === -1 || endIdx === -1) {
    throw new Error("Could not find GUIDELINES section boundaries — document structure may have changed.");
  }
  return text.slice(startIdx + "GUIDELINES".length, endIdx);
}

function toParagraphs(sectionText) {
  const lines = sectionText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && l !== PAGE_HEADER && !PAGE_FOOTER.test(l));

  // Blank lines (already stripped above) were the paragraph delimiter in the
  // source; since they're gone, rebuild paragraph breaks by treating each
  // known heading as its own boundary and otherwise joining consecutive
  // lines — a bullet's wrapped continuation lines get pulled back together
  // instead of becoming separate, fragment-sized chunks.
  const paragraphs = [];
  let current = "";
  for (const line of lines) {
    const isHeading = SUBSECTIONS.has(line) || POLARITY_HEADINGS.has(line);
    const startsNewBullet = /^[••]/.test(line) || /^[IVX]+\.\s/.test(line);
    if (isHeading || startsNewBullet) {
      if (current) paragraphs.push(current.trim());
      current = line;
      if (isHeading) {
        paragraphs.push(current.trim());
        current = "";
      }
    } else {
      current += (current ? " " : "") + line;
    }
  }
  if (current) paragraphs.push(current.trim());
  return paragraphs;
}

function chunkWithHeadings(paragraphs) {
  let subsection = null;
  let polarity = null;
  const chunks = [];

  for (const para of paragraphs) {
    if (SUBSECTIONS.has(para)) {
      subsection = para;
      polarity = null;
      continue;
    }
    if (POLARITY_HEADINGS.has(para)) {
      polarity = para;
      continue;
    }
    if (para.length <= 40) continue; // stray short fragments, not real content

    const headingParts = [subsection, polarity].filter(Boolean);
    const heading = headingParts.length > 0 ? headingParts.join(" > ") : null;
    chunks.push({
      heading,
      text: heading ? `[${heading}] ${para}` : para,
    });
  }
  return chunks;
}

const buffer = readFileSync(RAW_PDF_PATH);
const { text } = await pdfParse(buffer);
const effectiveDate = extractEffectiveDate(text);
const guidelinesText = extractGuidelinesSection(text);
const paragraphs = toParagraphs(guidelinesText);
const chunks = chunkWithHeadings(paragraphs);

const db = openDb();
const { documentId, chunkCount } = insertPolicyDocument(db, {
  payer: "Cigna",
  specialty: "Physical Therapy",
  title: "Physical Therapy — Coverage Policy Guideline (CPG 135)",
  sourceUrl: SOURCE_URL,
  effectiveDate,
  rawPath: "policy-library/cigna/cpg135-physical-therapy.pdf",
  chunks,
});

console.log(`Inserted policy_documents.id=${documentId} (effective ${effectiveDate}) with ${chunkCount} chunks.`);
db.close();
