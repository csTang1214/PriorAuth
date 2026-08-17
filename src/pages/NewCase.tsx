import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { open } from "@tauri-apps/plugin-dialog";
import { createCase } from "../db";
import { importDocument } from "../ocr";
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
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
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

  async function handleImport() {
    setImportError(null);
    const path = await open({
      title: "Import from document",
      multiple: false,
      filters: [
        { name: "Documents", extensions: ["pdf", "png", "jpg", "jpeg", "tif", "tiff", "bmp"] },
      ],
    });
    if (!path || Array.isArray(path)) return;

    setImporting(true);
    try {
      const extracted = await importDocument(path);
      // Extracted text is OCR'd/parsed output, not something to trust
      // blindly — it lands in the same editable field manual entry uses,
      // appended rather than overwriting so a partially-typed summary
      // never gets silently discarded.
      setForm((f) => ({
        ...f,
        patient_summary: f.patient_summary
          ? `${f.patient_summary}\n\n${extracted}`
          : extracted,
      }));
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
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

        <button type="button" className="btn" onClick={handleImport} disabled={importing}>
          {importing ? "Extracting text…" : "Import from document"}
        </button>
        {importError && (
          <p className="error-hint">
            Could not import this document: {importError}
          </p>
        )}

        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? "Saving…" : "Save Case"}
          </button>
        </div>
      </form>
    </div>
  );
}
