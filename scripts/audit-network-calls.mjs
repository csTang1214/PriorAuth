// Phase 8 — CI-enforced network-call audit (spec §4.8, development.md Phase 8).
//
// This app's entire trust pitch is "zero PHI leaves the machine." That can't
// be proven live on every PR without standing up a full Tauri app with a real
// WebView2 runtime (the Deep Test Pass sections do that by hand, on one
// machine, not in CI). What this script does instead, cheaply and reliably:
// scan the Rust source for anything capable of making a network call, and
// fail the build unless every call site is in network-audit-allowlist.json
// with a one-line justification. It can't prove a call never leaves loopback
// at runtime — it can guarantee no new network-capable code path is added
// without a human explicitly reviewing and allowlisting it, which is the
// actual failure mode this guards against (an unreviewed
// `reqwest::get("https://...")` slipping into a PR unnoticed).
//
// Deliberately NOT flagged: std::process::Command (local process execution —
// Phase 7's Tesseract/pdftoppm calls — is a different trust surface, not a
// network call; see the comment above ocr_import_document_sync in lib.rs).
//
// Usage: node scripts/audit-network-calls.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { globSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const RUST_SRC_DIR = join(REPO_ROOT, "src-tauri", "src");
const ALLOWLIST_PATH = join(__dirname, "network-audit-allowlist.json");

// Network-capable Rust APIs worth a human's eyes on every use. Substring
// match against each source line, checked in this order (first match wins).
const NETWORK_PATTERNS = [
  "reqwest::",
  "hyper::",
  "ureq::",
  "std::net::TcpStream",
  "std::net::TcpListener",
  "std::net::UdpSocket",
  "TcpStream::connect",
  "UdpSocket::bind",
];

function toPosix(p) {
  return p.split("\\").join("/");
}

function findRustFiles() {
  // node:fs's globSync landed in Node 22; this project's CI runs Node 24
  // (see ci.yml), so no extra dependency needed for a plain recursive glob.
  return globSync("**/*.rs", { cwd: RUST_SRC_DIR }).map((f) => join(RUST_SRC_DIR, f));
}

function enclosingFunctionName(lines, matchLineIndex) {
  const fnPattern = /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+(\w+)/;
  for (let i = matchLineIndex; i >= 0; i--) {
    const m = lines[i].match(fnPattern);
    if (m) return m[1];
  }
  return null;
}

function findMatches() {
  const matches = [];
  for (const absPath of findRustFiles()) {
    const relPath = toPosix(relative(join(REPO_ROOT, "src-tauri"), absPath));
    const lines = readFileSync(absPath, "utf8").split("\n");
    lines.forEach((line, idx) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("//")) return; // skip comments — see main.rs-style headers
      for (const pattern of NETWORK_PATTERNS) {
        if (line.includes(pattern)) {
          matches.push({
            file: relPath,
            line: idx + 1,
            pattern,
            function: enclosingFunctionName(lines, idx),
          });
          break;
        }
      }
    });
  }
  return matches;
}

function loadAllowlist() {
  return JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8"));
}

function keyOf(entry) {
  return `${entry.file}::${entry.function}::${entry.pattern}`;
}

function main() {
  const matches = findMatches();
  const allowlist = loadAllowlist();

  const matchKeys = new Set(matches.map(keyOf));
  const allowKeys = new Set(allowlist.map(keyOf));

  const unlisted = matches.filter((m) => !allowKeys.has(keyOf(m)));
  const stale = allowlist.filter((a) => !matchKeys.has(keyOf(a)));

  if (unlisted.length > 0) {
    console.error("Network-call audit FAILED — unlisted network-capable call site(s) found:\n");
    for (const m of unlisted) {
      console.error(
        `  ${m.file}:${m.line} — in ${m.function ?? "(top level)"}() — matched "${m.pattern}"`,
      );
    }
    console.error(
      "\nEvery network-capable call site must be reviewed and added to " +
        "scripts/network-audit-allowlist.json with a one-line justification " +
        "(see the Ollama entry for the expected shape). This check exists so " +
        "an unreviewed outbound call can't quietly ship — see development.md, Phase 8.",
    );
    process.exit(1);
  }

  if (stale.length > 0) {
    console.error("Network-call audit FAILED — stale allowlist entries found (no matching call site):\n");
    for (const a of stale) {
      console.error(`  ${a.file} — ${a.function}() — "${a.pattern}"`);
    }
    console.error(
      "\nRemove entries from scripts/network-audit-allowlist.json once the call site they " +
        "cover no longer exists, so the allowlist can't silently accumulate dead grants.",
    );
    process.exit(1);
  }

  console.log(
    `Network-call audit passed — ${matches.length} network-capable call site(s), all allowlisted:`,
  );
  for (const m of matches) {
    console.log(`  ${m.file}:${m.line} — ${m.function}() — "${m.pattern}"`);
  }
}

main();
