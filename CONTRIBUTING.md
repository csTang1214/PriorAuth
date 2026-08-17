# Contributing

Thanks for looking at this project. It's currently a single-maintainer effort — please open an
issue before starting work on a PR, especially for anything beyond a small fix, so the approach
can be agreed on first. This is the project's current stage, not a permanent stance: the
payer-policy corpus work in particular (see `development.md`, Phases 2/6) is exactly the kind of
ongoing, specialty-by-specialty work that benefits from outside contribution once there's more
than one maintainer to review it.

## Dev environment setup

- **Rust:** install via [rustup](https://rustup.rs) (stable-msvc, `x86_64-pc-windows-msvc`).
- **Node:** v24+ (matches CI, see `.github/workflows/ci.yml`).
- **MSVC Build Tools:** required by the Rust MSVC toolchain (Visual Studio 2022 Build Tools, C++
  desktop workload).
- **Known Windows quirk:** a plain terminal doesn't have the MSVC linker environment (`LIB`,
  `INCLUDE`, etc.) initialized, so `cargo build`/`cargo check`/`npm run tauri dev` will fail with a
  linker error or a missing-header error from `cl.exe` until it's sourced. Fix: run from a shell
  that has sourced `vcvars64.bat` (e.g. "x64 Native Tools Command Prompt for VS 2022" or
  "Developer PowerShell for VS 2022"). If your machine has more than one Visual Studio install,
  make sure you're sourcing a **complete** one — see `development.md`'s Environment Setup Log for
  a real case where a secondary install was missing `vcvarsall.bat` entirely and silently produced
  a different, more confusing failure than the linker error above.
- **Ollama**, with `llama3.2:3b` pulled (`ollama pull llama3.2:3b`) — needed for local LLM
  drafting (Phase 3). The app only ever talks to it at `127.0.0.1:11434`.
- **Tesseract OCR** and **Poppler** (`pdftoppm` on `PATH`) — needed for document import/OCR
  (Phase 7). See `development.md`'s Environment Setup Log for tested Windows install sources.

Once everything above is on `PATH`:

```bash
npm install
npm run tauri dev
```

## Running the test suite

```bash
npm test            # frontend — Vitest, single run
npm run build        # typecheck + production build
cargo check          # from src-tauri/ — needs the vcvars64.bat-sourced shell above
cargo test           # from src-tauri/ — same
node scripts/audit-network-calls.mjs   # from repo root — the CI network-call audit, see below
```

All of these run in CI (`.github/workflows/ci.yml`) on every PR.

## Never commit real patient data

This is a hard, enforced rule, not a norm you're trusted to remember: **no real patient
information — PHI, or anything shaped like it — is ever committed to this repository**, even in a
test fixture, even anonymized. Every clinical fixture in this codebase is synthetic
(`"Rotator cuff tendinopathy, outpatient PT referral"`-style) and that has to stay true.

This is enforced locally by a pre-commit hook that scans staged diffs for PHI-shaped patterns
(SSNs, labeled MRN/DOB fields). It is **not installed by default** — git doesn't auto-install
hooks — so run this once after cloning:

```bash
git config core.hooksPath .githooks
```

The hook's logic lives in `scripts/check-phi-patterns.mjs` (also covered by
`scripts/check-phi-patterns.test.mjs`) if you want to see exactly what it does or does not catch.
It's a heuristic, not a semantic PHI detector — it will not catch everything, but it turns the
"never commit real PHI" rule into something actually checked rather than only asked for. If it
ever produces a false positive on synthetic data, prefer rewriting the fixture so it doesn't match
a PHI-shaped pattern; `git commit --no-verify` is available for genuine edge cases, but explain why
in the PR description if you use it.

## The network-call audit

Because this app's whole pitch is "zero PHI leaves the machine" (see the root `README.md` and
`prior-auth-assistant-spec.md` §1, §4.8), every network-capable call site in the Rust code
(`reqwest::`, raw sockets, etc.) must be listed in `scripts/network-audit-allowlist.json` with a
one-line justification. CI runs `scripts/audit-network-calls.mjs` on every PR and fails the build
if it finds a network-capable call site that isn't on the allowlist, so an unreviewed outbound call
can't quietly ship. If you add one — this should be rare and deliberate — add it to the allowlist
in the same PR and explain why it's safe (loopback-only, etc.) in your PR description.

## Scope note

This project does not claim to make a practice "HIPAA compliant" — see `prior-auth-assistant-spec.md`
§1. The verifiable claim is narrower: this software makes zero network calls containing patient
data, and that claim is exactly what the network-call audit above is designed to keep true.
