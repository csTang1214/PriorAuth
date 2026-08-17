# PriorAuth

A desktop app that drafts prior-authorization requests (and, eventually, appeal letters) for small
independent medical practices — grounded in the specific payer's own published medical-necessity
criteria, with every draft requiring human review before it's sent.

## Why this exists

AI in prior authorization currently serves two extremes: enterprise infrastructure sold to large
health plans and provider networks, and patient-facing appeal-letter generators for individuals
fighting a denial after the fact. A solo dermatologist or a five-person physical therapy clinic has
a realistic path to neither — and the *initial* prior-authorization request, not just the appeal,
is where most of a small practice's weekly administrative burden actually sits.

This project ships as open source specifically because, for a HIPAA-adjacent tool, "trust us" is a
much weaker claim than "read the code and verify it yourself." A practice's own IT or compliance
contact — or any outside security researcher — can audit exactly what does and doesn't leave the
machine, rather than taking a vendor's word for it.

## The privacy guarantee

**No patient chart, diagnosis, or case detail is ever transmitted off the machine this app runs
on.** Everything — the database, the LLM drafting engine, the payer-policy library, OCR — runs
locally. The only network call this app makes is to a local LLM server on `127.0.0.1` (loopback);
there is no cloud API, no telemetry, no analytics.

This isn't just a claim in this README — it's mechanically checked. Every network-capable call
site in the Rust code is required to be listed in `scripts/network-audit-allowlist.json` with a
justification, and CI (`scripts/audit-network-calls.mjs`) fails the build if an unreviewed one is
added. See `CONTRIBUTING.md` for details, and `SECURITY.md` if you want to report a gap in this
guarantee.

This project does **not** claim to make a practice "HIPAA compliant" by itself — that depends on a
practice's whole environment (device security, staff training, physical access), not just one
tool. The honest, narrower, verifiable claim is: this software makes zero network calls containing
patient data.

## Status

This is under active, incremental development — see `development.md` for the actual phase-by-phase
build log (including real bugs found and fixed along the way) and `prior-auth-assistant-spec.md`
for the full product specification. Currently through Phase 8 (privacy hardening + open-source
release prep); local LLM drafting, payer-policy retrieval, deadline/outcome tracking, a bandit
personalization agent, and document import/OCR are all implemented and covered by
`development.md`'s Deep Test Pass sections.

## Dev setup

See `CONTRIBUTING.md` for full environment setup (Rust/Tauri/Node, required local tools, a
documented Windows MSVC-linker quirk and its fix) and how to run the test suite. Quick start once
your environment is set up:

```bash
npm install
npm run tauri dev
```

## License

[MIT](LICENSE).

## Contributing

See `CONTRIBUTING.md` — please open an issue before starting work on a PR.
