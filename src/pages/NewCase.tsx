import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createCase } from "../db";
import type { NewCaseInput } from "../types";

const empty: NewCaseInput = {
  patient_summary: "",
  payer: "",
  plan_type: "",
  procedure: "",
  specialty: "",
};

export default function NewCase() {
  const [form, setForm] = useState<NewCaseInput>(empty);
  const [saving, setSaving] = useState(false);
  const navigate = useNavigate();

  function update<K extends keyof NewCaseInput>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const id = await createCase(form);
      navigate(`/cases/${id}/review`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1>New Case</h1>
      </div>

      <form className="form" onSubmit={handleSubmit}>
        <label>
          Patient clinical summary
          <textarea
            required
            rows={6}
            value={form.patient_summary}
            onChange={(e) => update("patient_summary", e.target.value)}
            placeholder="Brief summary of relevant history, diagnosis, and prior treatment…"
          />
        </label>

        <div className="form-row">
          <label>
            Payer
            <input
              required
              type="text"
              value={form.payer}
              onChange={(e) => update("payer", e.target.value)}
              placeholder="e.g. Blue Cross Blue Shield"
            />
          </label>
          <label>
            Plan type
            <input
              type="text"
              value={form.plan_type}
              onChange={(e) => update("plan_type", e.target.value)}
              placeholder="e.g. PPO"
            />
          </label>
        </div>

        <div className="form-row">
          <label>
            Procedure / service requested
            <input
              required
              type="text"
              value={form.procedure}
              onChange={(e) => update("procedure", e.target.value)}
              placeholder="e.g. MRI lumbar spine"
            />
          </label>
          <label>
            Specialty
            <input
              type="text"
              value={form.specialty}
              onChange={(e) => update("specialty", e.target.value)}
              placeholder="e.g. Physical Therapy"
            />
          </label>
        </div>

        <button type="button" className="btn btn-disabled" disabled title="Document import (OCR) is not implemented yet">
          Import from document (coming soon)
        </button>

        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? "Saving…" : "Save Case"}
          </button>
        </div>
      </form>
    </div>
  );
}
