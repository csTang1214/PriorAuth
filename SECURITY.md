# Security Policy

## Reporting a vulnerability

Please report security issues privately, not as a public GitHub issue —
use [GitHub's private security advisory flow](https://github.com/csTang1214/PriorAuth/security/advisories/new)
for this repository. You should get an initial response within a few days.

## Scope

This project's core security claim (see `README.md` and `prior-auth-assistant-spec.md` §1, §4.8)
is narrow and verifiable: **this software makes zero network calls containing patient data.**
In scope for a security report:

- Any code path that sends case/patient data off the machine it runs on.
- Any network call not to `127.0.0.1` (loopback) — see `scripts/network-audit-allowlist.json` for
  the current, complete list of network-capable call sites and why each one is safe.
- SQL injection, path traversal, or command injection in how the app handles case data, imported
  documents, or the OCR/`Command`-invoking code in `src-tauri/src/lib.rs`.
- Filesystem scope issues (`src-tauri/capabilities/default.json`) that would let the frontend read
  or write outside what the app actually needs.

## Out of scope

- **Draft/output quality.** This is a decision-support drafting tool, not a medical or legal advice
  product — every draft requires human review before use (see `prior-auth-assistant-spec.md` §1).
  A generated letter being wrong, incomplete, or not "ready to send" is a product-quality issue, not
  a security vulnerability, and should be filed as a regular issue instead.
- **HIPAA compliance claims.** This project does not and cannot claim to make a practice "HIPAA
  compliant" by itself — that depends on the practice's whole environment, not just this tool.
