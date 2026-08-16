use tauri_plugin_sql::{Migration, MigrationKind};

// Each migration's SQL now lives in migrations/NNNN_*.sql — a single source
// of truth both this binary (via include_str!) and the automated test suite
// (which reads the same files directly, see src/testSupport/testDb.ts) read
// from, instead of duplicating the SQL by hand in two places where it could
// drift. sqlx checksums each migration's exact text against what's recorded
// in _sqlx_migrations for that version — reformatting these files' content
// after they've been applied to a real database would break that checksum
// (the exact bug this comment used to warn about, before extraction). That's
// safe to do once, here, only because no real practice has ever run this
// app — there is no production database whose checksum history this could
// break. Once this ships, go back to treating every migration file as
// permanently frozen the moment it's released, the same rule that always
// applied to the inline strings this replaced.
fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "create_cases_table",
            sql: include_str!("../migrations/0001_create_cases_table.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "create_policy_library_tables",
            sql: include_str!("../migrations/0002_create_policy_library_tables.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "add_deadline_tracking_and_outcome_logging",
            sql: include_str!("../migrations/0003_add_deadline_tracking_and_outcome_logging.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "add_bandit_strategy_tracking",
            sql: include_str!("../migrations/0004_add_bandit_strategy_tracking.sql"),
            kind: MigrationKind::Up,
        },
    ]
}

// Phase 3 — local LLM drafting via Ollama. Hardcoded to loopback on purpose:
// this is the one piece of the app that makes a real runtime network call,
// and it must never be able to point anywhere but the local machine.
const OLLAMA_ENDPOINT: &str = "http://127.0.0.1:11434/api/generate";
const DEFAULT_MODEL: &str = "llama3.2:3b";

#[derive(serde::Serialize)]
struct OllamaGenerateRequest {
    model: &'static str,
    prompt: String,
    stream: bool,
}

#[derive(serde::Deserialize)]
struct OllamaGenerateResponse {
    response: String,
}

// Maps the Phase-5-stub `selectStrategy()` output (spec §4.4's fixed action
// space) to a one-line instruction. Always "lead_with_guideline" until the
// real bandit agent exists, so this always produces the same hint for now —
// but the wiring is real, so Phase 5 only has to change what the frontend
// passes in, not this function.
fn strategy_hint(strategy: Option<&str>) -> &'static str {
    match strategy {
        Some("lead_with_treatment_history") => {
            "Lead the necessity justification with the patient's prior treatment history and why it fell short."
        }
        Some("lead_with_cost_effectiveness") => {
            "Emphasize the cost-effectiveness of approving this request relative to alternatives."
        }
        Some("verbatim_criteria") => {
            "Quote the payer's policy criteria verbatim rather than paraphrasing them."
        }
        _ => "Lead the necessity justification with the payer's own published guideline language.",
    }
}

fn build_prompt(
    patient_summary: &str,
    payer: &str,
    procedure: &str,
    specialty: Option<&str>,
    policy_excerpt: Option<&str>,
    strategy: Option<&str>,
) -> String {
    let specialty_line = specialty
        .map(|s| format!(" ({s})"))
        .unwrap_or_default();

    let policy_block = match policy_excerpt {
        Some(excerpt) => format!(
            "Payer policy excerpt (use ONLY this text as your source of medical-necessity \
             criteria — do not invent or assume criteria that are not present here):\n\"{excerpt}\""
        ),
        None => "No payer-specific policy excerpt is on file for this payer yet. Write a \
                 general medical-necessity justification based on the clinical summary alone, \
                 and explicitly note in the letter that no payer-specific policy citation is \
                 available yet so office staff know to verify criteria manually before sending."
            .to_string(),
    };

    let hint = strategy_hint(strategy);

    format!(
        "You are drafting a prior-authorization request letter for a medical practice. This is \
         a DRAFT ONLY — it will be reviewed and edited by clinical/office staff before being \
         sent, and you must never claim it is final or ready to send.\n\n\
         Rules:\n\
         - Ground every medical-necessity claim ONLY in the policy excerpt provided below. Never \
         invent or assume criteria not present in that text.\n\
         - Write in the structure of a formal prior-authorization request letter: addressee (the \
         payer), requested procedure, clinical summary, necessity justification tied to the \
         excerpt, and a sign-off placeholder.\n\
         - {hint}\n\
         - Keep it concise — a few short paragraphs, not an exhaustive legal document.\n\n\
         Payer: {payer}\n\
         Requested procedure: {procedure}{specialty_line}\n\n\
         Clinical summary:\n\
         {patient_summary}\n\n\
         {policy_block}\n\n\
         Write the letter now."
    )
}

// Phase 4 finding: a benign clinical summary containing the literal word
// "test" caused llama3.2:3b to flatly refuse ("I can't fulfill this
// request.") — a clean HTTP 200, so nothing upstream treated it as a
// failure, and the refusal got silently saved as if it were a real draft.
// Reproduced repeatedly; the exact wording varies (sampling), but the
// refusal itself was consistent for that input. Detect it by prefix rather
// than trying to fix the model — a drafting tool has no business being
// clever about why a small local model declined, only about not pretending
// a refusal is a letter.
const REFUSAL_PREFIXES: &[&str] = &[
    "i can't",
    "i cant",
    "i can not",
    "i cannot",
    "i'm sorry",
    "i am sorry",
    "sorry, i",
    "i apologize",
    "i'm unable",
    "i am unable",
    "i'm not able",
    "i am not able",
    "i won't",
    "i will not",
    "as an ai",
];

fn looks_like_refusal(text: &str) -> bool {
    let normalized = text.trim().to_lowercase();
    REFUSAL_PREFIXES.iter().any(|p| normalized.starts_with(p))
}

async fn call_ollama(prompt: &str) -> Result<String, String> {
    let client = reqwest::Client::new();
    let response = client
        .post(OLLAMA_ENDPOINT)
        .json(&OllamaGenerateRequest {
            model: DEFAULT_MODEL,
            prompt: prompt.to_string(),
            stream: false,
        })
        .send()
        .await
        .map_err(|e| {
            format!(
                "Could not reach the local Ollama server at {OLLAMA_ENDPOINT} ({e}). Is Ollama running?"
            )
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "Ollama returned {status}: {body}. Is the '{DEFAULT_MODEL}' model pulled? Try `ollama pull {DEFAULT_MODEL}`."
        ));
    }

    let parsed: OllamaGenerateResponse = response
        .json()
        .await
        .map_err(|e| format!("Could not parse Ollama's response: {e}"))?;

    Ok(parsed.response)
}

#[tauri::command]
async fn generate_draft_text(
    patient_summary: String,
    payer: String,
    procedure: String,
    specialty: Option<String>,
    policy_excerpt: Option<String>,
    strategy: Option<String>,
) -> Result<String, String> {
    let prompt = build_prompt(
        &patient_summary,
        &payer,
        &procedure,
        specialty.as_deref(),
        policy_excerpt.as_deref(),
        strategy.as_deref(),
    );

    let first = call_ollama(&prompt).await?;
    if !looks_like_refusal(&first) {
        return Ok(first);
    }

    // One retry — the exact wording varies between calls even when the
    // model keeps refusing (confirmed by repeated testing), so it's cheap
    // insurance against a one-off rather than a fix for a determined refusal.
    let second = call_ollama(&prompt).await?;
    if !looks_like_refusal(&second) {
        return Ok(second);
    }

    Err(format!(
        "The local model declined to draft this letter twice in a row (nothing in this case looks unusual — this is a known reliability quirk of small local models, not a rule about the case itself). Try again, or write the letter below by hand. Last response: \"{}\"",
        second.trim()
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_the_actual_refusal_wordings_observed_in_dev_testing() {
        // These are the literal responses llama3.2:3b gave when it refused
        // during Phase 4 testing (see development.md's Refusal Detection
        // section) — regression tests against the real thing that triggered
        // this feature, not hypothetical phrasing.
        assert!(looks_like_refusal("I can't fulfill this request."));
        assert!(looks_like_refusal(
            "I can't assist you with this request as it involves writing a prior-authorization request letter."
        ));
        assert!(looks_like_refusal(
            "I can't assist with drafting a prior-authorization request letter that includes medical necessity criteria."
        ));
        assert!(looks_like_refusal(
            "I can't assist you with this request, but I can provide some general information."
        ));
    }

    #[test]
    fn does_not_flag_a_real_letter_as_a_refusal() {
        let real_letter = "Dear Aetna Review Team,\n\nI am submitting this prior authorization \
             request for outpatient physical therapy. The patient's condition warrants this \
             treatment per the enclosed clinical summary.";
        assert!(!looks_like_refusal(real_letter));
    }

    #[test]
    fn matches_case_insensitively_and_ignores_leading_whitespace() {
        assert!(looks_like_refusal("  I CAN'T help with that."));
        assert!(looks_like_refusal("i'm sorry, but no."));
    }

    #[test]
    fn does_not_flag_a_letter_that_merely_mentions_inability_mid_sentence() {
        // The heuristic is a prefix match — a real letter that happens to
        // discuss the patient's inability to work, say, should not trip it
        // just because the phrase appears somewhere in the body.
        let letter = "Due to this condition, the patient reports she cannot perform basic tasks \
             without significant pain, supporting the medical necessity of this request.";
        assert!(!looks_like_refusal(letter));
    }

    #[test]
    fn strategy_hint_maps_each_known_strategy_and_falls_back_for_unknown() {
        assert!(strategy_hint(Some("lead_with_treatment_history")).contains("treatment history"));
        assert!(strategy_hint(Some("lead_with_cost_effectiveness")).contains("cost-effectiveness"));
        assert!(strategy_hint(Some("verbatim_criteria")).contains("verbatim"));
        assert!(strategy_hint(Some("lead_with_guideline")).contains("guideline"));
        // Unknown/missing strategy falls back to the same default as the cold-start bandit seed.
        assert!(strategy_hint(None).contains("guideline"));
        assert!(strategy_hint(Some("something_bogus")).contains("guideline"));
    }

    #[test]
    fn build_prompt_includes_the_real_policy_excerpt_when_present() {
        let prompt = build_prompt(
            "Chronic shoulder pain.",
            "Aetna",
            "Outpatient physical therapy",
            Some("Physical Therapy"),
            Some("[Medical Necessity] Aetna considers PT medically necessary when..."),
            Some("verbatim_criteria"),
        );
        assert!(prompt.contains("Aetna considers PT medically necessary"));
        assert!(prompt.contains("Payer: Aetna"));
        assert!(prompt.contains("Outpatient physical therapy (Physical Therapy)"));
        assert!(prompt.contains("Quote the payer's policy criteria verbatim"));
        // Never claims the letter is final — the human-review gate is the UI's job (§4.6),
        // but the prompt still needs to say so to avoid the model sounding overly authoritative.
        assert!(prompt.contains("DRAFT ONLY"));
    }

    #[test]
    fn build_prompt_uses_the_no_excerpt_fallback_when_policy_is_none() {
        let prompt = build_prompt(
            "Migraine, referred to neurology.",
            "UnitedHealthcare",
            "Neurology consult",
            Some("Neurology"),
            None,
            None,
        );
        assert!(prompt.contains("No payer-specific policy excerpt is on file"));
        assert!(prompt.contains("verify criteria manually before sending"));
        // Should not claim to have an excerpt it doesn't have.
        assert!(!prompt.contains("Payer policy excerpt (use ONLY"));
    }

    #[test]
    fn build_prompt_omits_the_specialty_parenthetical_when_none() {
        let prompt = build_prompt("Summary.", "Aetna", "Some procedure", None, None, None);
        assert!(prompt.contains("Requested procedure: Some procedure\n"));
        assert!(!prompt.contains("Some procedure ("));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:priorauth.db", migrations())
                .build(),
        )
        .invoke_handler(tauri::generate_handler![generate_draft_text])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
