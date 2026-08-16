import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getCase, saveDraft, approveCase } from "../db";
import { generateDraft, type GeneratedDraft } from "../llm";
import { retrievePolicy, type PolicyRecord } from "../policy";
import { lookupResponseWindow } from "../deadlines";
import { STRATEGY_LABELS } from "../bandit";
import type { Case } from "../types";
import type { DraftStrategy } from "../stubs";

// Module-scoped (not component state) on purpose — this needs to survive
// React StrictMode's dev-only double-invocation of effects, which otherwise
// fires generateDraft() twice per case: two real Ollama calls (doubling
// generation time) whose results race to write the case's draft, strategy,
// and edit-distance baseline. Deduping the promise itself means both
// invocations' callbacks resolve with the *same* result instead of two
// different LLM outputs — caught during the Phase 1–5 deep test pass via a
// mismatched edit_distance that made no sense until this was traced back to
// two concurrent generations.
const inFlightGenerations = new Map<string, Promise<GeneratedDraft>>();

function getOrStartGeneration(caseId: string, caseRecord: Case): Promise<GeneratedDraft> {
  let promise = inFlightGenerations.get(caseId);
  if (!promise) {
    promise = generateDraft(caseRecord).finally(() => inFlightGenerations.delete(caseId));
    inFlightGenerations.set(caseId, promise);
  }
  return promise;
}

export default function DraftReview() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [caseRecord, setCaseRecord] = useState<Case | null>(null);
  const [draftText, setDraftText] = useState("");
  const [generatedDraftText, setGeneratedDraftText] = useState<string | null>(null);
  const [strategy, setStrategy] = useState<DraftStrategy | null>(null);
  const [strategyReasoning, setStrategyReasoning] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [policy, setPolicy] = useState<PolicyRecord | null | undefined>(undefined);
  const [generating, setGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    getCase(Number(id)).then((c) => {
      if (!c) return;
      setCaseRecord(c);
      retrievePolicy(c.payer, c.procedure, c.specialty).then(setPolicy);

      if (c.draft_text) {
        setDraftText(c.draft_text);
        setGeneratedDraftText(c.generated_draft_text);
        setStrategy(c.draft_strategy);
        return;
      }

      setGenerating(true);
      getOrStartGeneration(id, c)
        .then((result) => {
          setDraftText(result.text);
          setGeneratedDraftText(result.text);
          setStrategy(result.strategy);
          setStrategyReasoning(result.reasoning);
          // Persist immediately, not just on explicit Save/Approve — otherwise
          // navigating away before either one loses the strategy attribution
          // and edit-distance baseline even though generation succeeded.
          return saveDraft(c.id, result.text, result.text, result.strategy);
        })
        .catch((err) =>
          setGenerationError(
            `Could not generate a draft automatically (${String(err)}). Make sure Ollama is ` +
              `running and the "llama3.2:3b" model is pulled, or just write the letter below ` +
              `by hand.`,
          ),
        )
        .finally(() => setGenerating(false));
    });
  }, [id]);

  if (!caseRecord) return <p>Loading…</p>;

  async function handleApprove() {
    if (!caseRecord) return;
    setApproving(true);
    try {
      const { days } = await lookupResponseWindow(caseRecord.payer, caseRecord.plan_type);
      await approveCase(
        caseRecord.id,
        draftText,
        generatedDraftText,
        days,
        strategy,
        caseRecord.payer,
        caseRecord.specialty,
      );
      navigate("/tracking");
    } finally {
      setApproving(false);
    }
  }

  async function handleSaveDraft() {
    if (!caseRecord) return;
    await saveDraft(caseRecord.id, draftText, generatedDraftText, strategy);
  }

  return (
    <div>
      <div className="page-header">
        <h1>Draft Review</h1>
        <span className={`status-badge status-${caseRecord.status}`}>{caseRecord.status}</span>
      </div>

      <div className="review-layout">
        <div className="review-main">
          {generating && <p className="hint">Generating draft with the local model…</p>}
          {generationError && <p className="hint error-hint">{generationError}</p>}

          <textarea
            className="draft-textarea"
            rows={18}
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            disabled={generating}
            placeholder={generating ? "" : "Write the draft letter here…"}
          />

          <div className="form-actions">
            <button className="btn" onClick={handleSaveDraft} disabled={generating}>
              Save without approving
            </button>
            <button
              className="btn btn-primary"
              onClick={handleApprove}
              disabled={approving || generating}
            >
              {approving ? "Approving…" : "Approve"}
            </button>
          </div>
        </div>

        <aside className="review-sidebar">
          {strategy && (
            <>
              <h3>Strategy</h3>
              <p className="hint">
                <strong>{STRATEGY_LABELS[strategy]}</strong>
                {strategyReasoning ? ` — ${strategyReasoning}` : ""}
              </p>
            </>
          )}

          <h3>Citation</h3>

          {policy === undefined && <p className="hint">Looking up policy…</p>}

          {policy === null && (
            <p className="hint">
              No policy on file for "{caseRecord.payer}" yet — the local library only covers
              Aetna / Physical Therapy so far (Phase 2). Coverage grows payer by payer in
              Phase 6.
            </p>
          )}

          {policy && (
            <>
              <p className="citation-box">
                {policy.excerpt}
                <br />
                <span className="citation-meta">
                  {policy.title} · effective {policy.effectiveDate ?? "unknown"} · fetched{" "}
                  {new Date(policy.fetchedAt).toLocaleDateString()}
                </span>
              </p>
              <p className="hint">
                <a href={policy.sourceUrl} target="_blank" rel="noreferrer">
                  View source
                </a>
              </p>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
